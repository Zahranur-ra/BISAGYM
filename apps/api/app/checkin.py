from dataclasses import dataclass
from datetime import timedelta
from time import perf_counter
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.biometrics import (
    FaceRecognitionEngine,
    RecognitionResult,
    cosine_similarity,
    create_face_engine,
)
from app.config import Settings
from app.database import utcnow
from app.errors import APIError
from app.memberships import evaluate_memberships
from app.models import (
    AccessEvent,
    Branch,
    CheckinAttempt,
    Decision,
    Device,
    FaceProfile,
    Member,
    Membership,
    MemberStatus,
    SystemSetting,
)


@dataclass
class CheckinOutcome:
    attempt: CheckinAttempt
    member: Member | None
    membership: Membership | None


class CheckinStateMachine:
    transitions_allowed = {
        "IDLE": {"CAMERA_READY"},
        "CAMERA_READY": {"FACE_DETECTED", "ACCESS_DENIED", "ERROR"},
        "FACE_DETECTED": {"QUALITY_VALIDATED", "ACCESS_DENIED", "ERROR"},
        "QUALITY_VALIDATED": {
            "LIVENESS_VALIDATED",
            "EMBEDDING_EXTRACTED",
            "ACCESS_DENIED",
            "ERROR",
        },
        "LIVENESS_VALIDATED": {"EMBEDDING_EXTRACTED", "ACCESS_DENIED", "ERROR"},
        "EMBEDDING_EXTRACTED": {"IDENTITY_MATCHED", "ACCESS_DENIED", "ERROR"},
        "IDENTITY_MATCHED": {"MEMBERSHIP_VALIDATED", "ACCESS_DENIED", "ERROR"},
        "MEMBERSHIP_VALIDATED": {"ACCESS_GRANTED", "ACCESS_DENIED", "ERROR"},
        "ACCESS_GRANTED": {"COOLDOWN"},
        "ACCESS_DENIED": {"COOLDOWN"},
        "ERROR": {"COOLDOWN"},
        "COOLDOWN": {"IDLE"},
    }

    def __init__(
        self,
        db: Session,
        settings: Settings,
        device: Device,
        correlation_id: str,
        engine: FaceRecognitionEngine | None = None,
    ):
        self.db = db
        self.device = device
        self.correlation_id = correlation_id
        self.engine = engine or create_face_engine(settings)
        self.liveness_mode = settings.liveness_mode
        overrides = {item.key: item.value for item in db.scalars(select(SystemSetting)).all()}
        self.match_threshold = float(
            overrides.get("face_match_threshold", settings.face_match_threshold)
        )
        self.min_quality_score = float(
            overrides.get("face_min_quality_score", settings.face_min_quality_score)
        )
        self.min_liveness_score = float(
            overrides.get("liveness_min_score", settings.liveness_min_score)
        )
        self.ambiguity_margin = settings.face_match_ambiguity_margin
        self.cooldown_seconds = int(
            overrides.get("checkin_cooldown_seconds", settings.checkin_cooldown_seconds)
        )
        self.transitions: list[dict[str, Any]] = []
        self.started = perf_counter()
        self.state = "IDLE"

    def transition(self, target: str, result: str = "OK") -> None:
        if target not in self.transitions_allowed[self.state]:
            raise RuntimeError(f"Invalid check-in transition: {self.state} -> {target}")
        self.transitions.append({"from": self.state, "to": target, "result": result})
        self.state = target

    def run(self, image_bytes: bytes | str, idempotency_key: str) -> CheckinOutcome:
        existing = self.db.scalar(
            select(CheckinAttempt).where(CheckinAttempt.idempotency_key == idempotency_key)
        )
        if existing:
            if existing.device_id != self.device.id:
                raise APIError(
                    409,
                    "IDEMPOTENCY_KEY_REUSED",
                    "Idempotency-Key was already used by another device.",
                )
            return CheckinOutcome(
                existing,
                self.db.get(Member, existing.member_id) if existing.member_id else None,
                self.db.get(Membership, existing.membership_id) if existing.membership_id else None,
            )

        self.transition("CAMERA_READY")
        branch = self.db.get(Branch, self.device.branch_id)
        if not self.device.is_active or branch is None or not branch.is_active:
            return self._deny("DEVICE_INACTIVE", idempotency_key)

        if isinstance(image_bytes, str):
            image_bytes = image_bytes.encode()
        result = self.engine.identify(image_bytes, self.device.branch_id)
        first_error = result.errors[0] if result.errors else None
        if result.detected_face_count == 0:
            return self._deny(first_error or "NO_FACE", idempotency_key, result=result)
        if result.detected_face_count != 1:
            return self._deny(first_error or "MULTIPLE_FACES", idempotency_key, result=result)
        self.transition("FACE_DETECTED")
        if first_error in {
            "FACE_TOO_SMALL",
            "IMAGE_TOO_BLURRY",
            "BAD_EXPOSURE",
            "LOW_IMAGE_QUALITY",
        }:
            return self._deny(first_error, idempotency_key, result=result)
        if result.quality_score is None or result.quality_score < self.min_quality_score:
            return self._deny("LOW_IMAGE_QUALITY", idempotency_key, result=result)
        self.transition("QUALITY_VALIDATED")
        if self.liveness_mode != "none":
            if result.liveness_score is None or result.liveness_score < self.min_liveness_score:
                return self._deny("LIVENESS_FAILED", idempotency_key, result=result)
            self.transition("LIVENESS_VALIDATED")
        if result.embedding is None:
            return self._deny(first_error or "IDENTITY_NOT_FOUND", idempotency_key, result=result)
        self.transition("EMBEDDING_EXTRACTED")

        profile, score, runner_up_score = self._best_match(result)
        if profile is None:
            return self._deny("IDENTITY_NOT_FOUND", idempotency_key, result=result)
        result.match_score = score
        result.matched_profile_id = profile.id
        if score < self.match_threshold:
            reason = (
                "LOW_MATCH_CONFIDENCE"
                if result.confidence_cap is not None
                else "IDENTITY_NOT_FOUND"
            )
            return self._deny(reason, idempotency_key, result=result)
        if runner_up_score is not None and score - runner_up_score < self.ambiguity_margin:
            return self._deny("AMBIGUOUS_FACE_MATCH", idempotency_key, result=result)
        self.transition("IDENTITY_MATCHED")
        member = self.db.get(Member, profile.member_id)
        if member is None or member.deleted_at is not None or member.status != MemberStatus.ACTIVE:
            return self._deny("MEMBER_INACTIVE", idempotency_key, result=result, member=member)
        if member.branch_id != self.device.branch_id:
            return self._deny("BRANCH_MISMATCH", idempotency_key, result=result, member=member)

        memberships = list(
            self.db.scalars(select(Membership).where(Membership.member_id == member.id)).all()
        )
        membership_decision = evaluate_memberships(memberships, utcnow())
        if not membership_decision.allowed:
            return self._deny(
                membership_decision.reason_code,
                idempotency_key,
                result=result,
                member=member,
                membership=membership_decision.membership,
            )
        self.transition("MEMBERSHIP_VALIDATED")

        cutoff = utcnow() - timedelta(seconds=self.cooldown_seconds)
        duplicate = self.db.scalar(
            select(CheckinAttempt)
            .where(
                CheckinAttempt.member_id == member.id,
                CheckinAttempt.decision == Decision.ALLOW,
                CheckinAttempt.attempted_at >= cutoff,
            )
            .order_by(desc(CheckinAttempt.attempted_at))
        )
        if duplicate:
            return self._deny(
                "DUPLICATE_CHECKIN",
                idempotency_key,
                result=result,
                member=member,
                membership=membership_decision.membership,
            )
        self.transition("ACCESS_GRANTED")
        return self._persist(
            Decision.ALLOW,
            "MEMBERSHIP_ACTIVE",
            idempotency_key,
            result,
            member,
            membership_decision.membership,
        )

    def _best_match(
        self, result: RecognitionResult
    ) -> tuple[FaceProfile | None, float, float | None]:
        profiles = self.db.scalars(
            select(FaceProfile)
            .join(Member, Member.id == FaceProfile.member_id)
            .where(
                Member.branch_id == self.device.branch_id,
                Member.deleted_at.is_(None),
                FaceProfile.revoked_at.is_(None),
                FaceProfile.enrollment_status == "ACTIVE",
                FaceProfile.model_name == self.engine.model_name,
                FaceProfile.model_version == self.engine.model_version,
                FaceProfile.embedding_dimension == self.engine.dimension,
            )
        ).all()
        matches_by_member: dict[str, tuple[float, FaceProfile]] = {}
        for profile in profiles:
            score = cosine_similarity(result.embedding or [], profile.embedding)
            if result.confidence_cap is not None:
                score = min(score, result.confidence_cap)
            current = matches_by_member.get(profile.member_id)
            if current is None or score > current[0]:
                matches_by_member[profile.member_id] = (score, profile)
        matches = list(matches_by_member.values())
        matches.sort(key=lambda item: item[0], reverse=True)
        if not matches:
            return None, 0.0, None
        runner_up = max(matches[1][0], 0.0) if len(matches) > 1 else None
        return matches[0][1], max(matches[0][0], 0.0), runner_up

    def _deny(
        self,
        reason: str,
        idempotency_key: str,
        result: RecognitionResult | None = None,
        member: Member | None = None,
        membership: Membership | None = None,
    ) -> CheckinOutcome:
        self.transition("ACCESS_DENIED", reason)
        return self._persist(
            Decision.DENY,
            reason,
            idempotency_key,
            result or RecognitionResult(0, None, None),
            member,
            membership,
        )

    def _persist(
        self,
        decision: Decision,
        reason: str,
        idempotency_key: str,
        result: RecognitionResult,
        member: Member | None,
        membership: Membership | None,
    ) -> CheckinOutcome:
        elapsed = max(1, round((perf_counter() - self.started) * 1000))
        self.transition("COOLDOWN")
        self.transition("IDLE")
        attempt = CheckinAttempt(
            branch_id=self.device.branch_id,
            device_id=self.device.id,
            member_id=member.id if member else None,
            decision=decision,
            reason_code=reason,
            match_score=result.match_score,
            match_threshold=self.match_threshold,
            quality_score=result.quality_score,
            liveness_score=result.liveness_score,
            depth_score=result.depth_score,
            membership_id=membership.id if membership else None,
            processing_time_ms=elapsed,
            correlation_id=self.correlation_id,
            idempotency_key=idempotency_key,
            metadata_json={
                "state_transitions": self.transitions,
                "engine": self.engine.engine_name,
                "model_name": self.engine.model_name,
                "model_version": self.engine.model_version,
                "liveness_mode": self.liveness_mode,
            },
        )
        self.db.add(attempt)
        self.db.flush()
        self.db.add(
            AccessEvent(
                checkin_attempt_id=attempt.id,
                event_type="ACCESS_DECISION",
                door_action="UNLOCK" if decision == Decision.ALLOW else "NONE",
                door_result="SUCCESS" if decision == Decision.ALLOW else "NOT_TRIGGERED",
            )
        )
        self.db.commit()
        return CheckinOutcome(attempt, member, membership)


PUBLIC_MESSAGES = {
    "MEMBERSHIP_EXPIRED": "Membership Anda telah berakhir. Silakan hubungi resepsionis.",
    "MEMBERSHIP_NOT_STARTED": "Membership Anda belum dimulai.",
    "MEMBERSHIP_SUSPENDED": "Membership tidak dapat digunakan. Silakan hubungi resepsionis.",
    "DUPLICATE_CHECKIN": "Anda baru saja melakukan check-in.",
    "LIVENESS_FAILED": "Verifikasi wajah gagal. Silakan coba kembali.",
    "DEVICE_INACTIVE": "Perangkat tidak tersedia.",
}


def kiosk_response(outcome: CheckinOutcome, settings: Settings) -> dict[str, Any]:
    attempt = outcome.attempt
    payload: dict[str, Any] = {
        "attempt_id": attempt.id,
        "decision": attempt.decision.value,
        "reason_code": attempt.reason_code,
        "processing_time_ms": attempt.processing_time_ms,
        "cooldown_seconds": settings.kiosk_result_cooldown_seconds,
    }
    if attempt.decision == Decision.ALLOW and outcome.member and outcome.membership:
        payload["member"] = {
            "id": outcome.member.id,
            "display_name": outcome.member.full_name.split()[0],
        }
        payload["membership"] = {
            "status": "ACTIVE",
            "valid_until": outcome.membership.end_at,
        }
    else:
        payload["public_message"] = PUBLIC_MESSAGES.get(
            attempt.reason_code, "Akses ditolak. Silakan hubungi resepsionis."
        )
    return payload
