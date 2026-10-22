from collections.abc import Generator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.biometrics import (
    DetectedFaceResult,
    FrameAnalysisResult,
    OpenCvSFaceEngine,
    RecognitionResult,
    cosine_similarity,
    normalized_average,
)
from app.config import Settings
from app.database import SessionLocal
from app.main import create_app
from app.models import Branch, CheckinAttempt, FaceEnrollmentSample, FaceProfile, Member, User
from app.seed import seed_database


class DeterministicSFaceEngine:
    engine_name = "opencv_sface"
    model_name = "test-sface"
    model_version = "test-v1"
    dimension = 4

    def analyze_enrollment_sample(self, image_bytes: bytes) -> RecognitionResult:
        return self.identify(image_bytes, "enrollment")

    def identify(self, image_bytes: bytes, branch_id: str) -> RecognitionResult:
        if image_bytes == b"malformed":
            return RecognitionResult(0, None, None, errors=["INVALID_IMAGE"])
        if image_bytes == b"other-face":
            embedding = [0.0, 1.0, 0.0, 0.0]
        else:
            embedding = [1.0, 0.0, 0.0, 0.0]
        return RecognitionResult(1, 0.95, None, embedding=embedding)

    def analyze_frame(self, image_bytes: bytes) -> FrameAnalysisResult:
        if image_bytes == b"no-face":
            return FrameAnalysisResult(640, 480)
        if image_bytes == b"malformed":
            return FrameAnalysisResult(None, None, errors=["INVALID_IMAGE"])
        return FrameAnalysisResult(
            640,
            480,
            faces=[
                DetectedFaceResult((60, 70, 160, 210), 0.95, [1.0, 0.0, 0.0, 0.0]),
                DetectedFaceResult((360, 80, 150, 200), 0.94, [0.0, 1.0, 0.0, 0.0]),
            ],
        )

    def create_profile(self, embeddings: list[list[float]]) -> list[float]:
        return normalized_average(embeddings)

    def health(self) -> dict:
        return {
            "status": "ready",
            "engine": self.engine_name,
            "demo_mode": False,
            "model_name": self.model_name,
            "model_version": self.model_version,
            "embedding_dimension": self.dimension,
        }


@pytest.fixture
def real_client(tmp_path) -> Generator[tuple[TestClient, Settings, DeterministicSFaceEngine]]:
    settings = Settings(
        app_env="test",
        database_url=f"sqlite:///{(tmp_path / 'real.db').as_posix()}",
        secret_key="test-secret-key-that-is-long-enough-for-tests",
        device_shared_secret="test-device-secret",
        face_engine="opencv_sface",
        face_model_name="test-sface",
        face_model_version="test-v1",
        liveness_mode="none",
        max_sample_bytes=32,
        login_rate_limit=1000,
        kiosk_rate_limit=1000,
    )
    engine = DeterministicSFaceEngine()
    app = create_app(settings, face_engine=engine)
    with TestClient(app) as client:
        with SessionLocal() as db:
            seed_database(db, settings)
        yield client, settings, engine


def admin_headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@gym.local", "password": "GymDemo123!"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def create_enrollment(client: TestClient, headers: dict[str, str]) -> tuple[dict, dict]:
    member = client.post(
        "/api/v1/members",
        headers=headers,
        json={"member_code": f"REAL-{uuid4()}", "full_name": "Real Face Member"},
    ).json()
    consent = client.post(
        f"/api/v1/members/{member['id']}/biometric-consents",
        headers=headers,
        json={
            "consent_version": "real-v1",
            "capture_purpose": "Gym entry",
            "retention_policy": "Until revoked",
        },
    )
    assert consent.status_code == 201
    session = client.post(
        "/api/v1/enrollments/sessions",
        headers=headers,
        json={"member_id": member["id"]},
    )
    assert session.status_code == 201
    return member, session.json()


def test_raw_enrollment_is_mode_checked_and_descriptors_are_transient(real_client):
    client, _, _ = real_client
    headers = admin_headers(client)
    member, session = create_enrollment(client, headers)
    assert session["engine"] == "opencv_sface"
    assert session["demo_mode"] is False

    mismatch = client.post(
        f"/api/v1/enrollments/sessions/{session['id']}/samples",
        headers=headers,
        json={"sample_tag": "face", "pose_type": "FRONT"},
    )
    assert mismatch.status_code == 415
    assert mismatch.json()["error"]["code"] == "BIOMETRIC_PAYLOAD_MODE_MISMATCH"

    malformed = client.post(
        f"/api/v1/enrollments/sessions/{session['id']}/samples?pose_type=FRONT",
        headers={**headers, "Content-Type": "image/jpeg"},
        content=b"malformed",
    )
    assert malformed.status_code == 422
    assert malformed.json()["error"]["code"] == "INVALID_IMAGE"
    oversized = client.post(
        f"/api/v1/enrollments/sessions/{session['id']}/samples?pose_type=FRONT",
        headers={**headers, "Content-Type": "image/jpeg"},
        content=b"x" * 33,
    )
    assert oversized.status_code == 413

    for pose in ("FRONT", "LEFT", "RIGHT"):
        response = client.post(
            f"/api/v1/enrollments/sessions/{session['id']}/samples?pose_type={pose}",
            headers={**headers, "Content-Type": "image/jpeg"},
            content=b"face-one",
        )
        assert response.status_code == 201, response.text
        assert response.json()["liveness_passed"] is None

    with SessionLocal() as db:
        samples = list(
            db.scalars(
                select(FaceEnrollmentSample).where(
                    FaceEnrollmentSample.enrollment_session_id == session["id"]
                )
            )
        )
        assert all(sample.embedding == [1.0, 0.0, 0.0, 0.0] for sample in samples)
        assert all(
            sample.sample_tag is None and sample.storage_reference is None for sample in samples
        )

    completed = client.post(
        f"/api/v1/enrollments/sessions/{session['id']}/complete", headers=headers
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["model"] == {"name": "test-sface", "version": "test-v1"}
    with SessionLocal() as db:
        samples = list(
            db.scalars(
                select(FaceEnrollmentSample).where(
                    FaceEnrollmentSample.enrollment_session_id == session["id"]
                )
            )
        )
        profile = db.scalar(select(FaceProfile).where(FaceProfile.member_id == member["id"]))
        assert all(sample.embedding is None for sample in samples)
        assert profile is not None and profile.embedding_dimension == 4


def test_raw_checkin_scopes_models_and_does_not_fabricate_liveness(real_client):
    client, settings, engine = real_client
    headers = admin_headers(client)
    member, session = create_enrollment(client, headers)
    for pose in ("FRONT", "LEFT", "RIGHT"):
        response = client.post(
            f"/api/v1/enrollments/sessions/{session['id']}/samples?pose_type={pose}",
            headers={**headers, "Content-Type": "image/png"},
            content=b"face-one",
        )
        assert response.status_code == 201
    assert (
        client.post(
            f"/api/v1/enrollments/sessions/{session['id']}/complete", headers=headers
        ).status_code
        == 200
    )

    plans = client.get("/api/v1/membership-plans", headers=headers).json()["items"]
    membership = client.post(
        f"/api/v1/members/{member['id']}/memberships",
        headers=headers,
        json={"plan_id": plans[0]["id"], "start_at": "2026-01-01T00:00:00Z"},
    )
    assert membership.status_code == 201

    with SessionLocal() as db:
        branch = db.scalar(select(Branch).where(Branch.code == "GYM-001"))
        actor = db.scalar(select(User).where(User.email == "admin@gym.local"))
        current_member = db.get(Member, member["id"])
        db.add(
            FaceProfile(
                member_id=current_member.id,
                model_name="wrong-model",
                model_version=engine.model_version,
                embedding_dimension=engine.dimension,
                embedding=[1.0, 0.0, 0.0, 0.0],
                quality_score=0.95,
                created_by=actor.id,
            )
        )
        db.add(
            FaceProfile(
                member_id=current_member.id,
                model_name=engine.model_name,
                model_version=engine.model_version,
                embedding_dimension=engine.dimension,
                embedding=[1.0, 0.0, 0.0, 0.0],
                quality_score=0.95,
                created_by=actor.id,
            )
        )
        other_branch = Branch(code="REAL-OTHER", name="Other Branch")
        db.add(other_branch)
        db.flush()
        other_member = Member(
            branch_id=other_branch.id,
            member_code="REAL-OTHER",
            full_name="Other Face",
        )
        db.add(other_member)
        db.flush()
        db.add(
            FaceProfile(
                member_id=other_member.id,
                model_name=engine.model_name,
                model_version=engine.model_version,
                embedding_dimension=engine.dimension,
                embedding=[1.0, 0.0, 0.0, 0.0],
                quality_score=0.95,
                created_by=actor.id,
            )
        )
        assert branch is not None
        db.commit()

    device_headers = {
        "X-Device-Code": "KIOSK-001",
        "X-Device-Token": settings.device_shared_secret,
    }
    kiosk_session = client.post("/api/v1/kiosk/sessions", headers=device_headers)
    assert kiosk_session.status_code == 201
    assert kiosk_session.json()["challenge"] == "NONE"
    mismatch = client.post(
        "/api/v1/kiosk/checkin",
        headers=device_headers,
        json={
            "session_token": kiosk_session.json()["session_token"],
            "sample_tag": "face-one",
            "idempotency_key": str(uuid4()),
        },
    )
    assert mismatch.status_code == 415

    response = client.post(
        "/api/v1/kiosk/checkin",
        headers={
            **device_headers,
            "Content-Type": "image/jpeg",
            "X-Kiosk-Session": kiosk_session.json()["session_token"],
            "Idempotency-Key": str(uuid4()),
        },
        content=b"face-one",
    )
    assert response.status_code == 200, response.text
    assert response.json()["decision"] == "ALLOW"
    assert "match_score" not in response.json()
    assert "embedding" not in response.json()
    with SessionLocal() as db:
        attempt = db.scalar(
            select(CheckinAttempt).where(CheckinAttempt.id == response.json()["attempt_id"])
        )
        assert attempt.liveness_score is None
        assert attempt.metadata_json["engine"] == "opencv_sface"
        transitions = attempt.metadata_json["state_transitions"]
        assert all(item["to"] != "LIVENESS_VALIDATED" for item in transitions)


def test_opencv_engine_rejects_generated_malformed_bytes_and_reports_models():
    engine = OpenCvSFaceEngine(Settings())
    result = engine.analyze_enrollment_sample(bytes(range(32)))
    assert result.errors == ["INVALID_IMAGE"]
    health = engine.health()
    assert health["status"] == "ready"
    assert health["embedding_dimension"] == 128
    assert health["models"]["detection"]["sha256"].startswith("8F2383E4")


def test_embedding_math_rejects_non_finite_and_zero_vectors():
    assert cosine_similarity([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)
    assert cosine_similarity([float("nan"), 0.0], [1.0, 0.0]) == -1.0
    assert cosine_similarity([0.0, 0.0], [1.0, 0.0]) == -1.0
    with pytest.raises(ValueError, match="finite"):
        normalized_average([[float("inf"), 0.0]])


def test_live_camera_identifies_multiple_faces_without_creating_checkins(real_client):
    client, _, _ = real_client
    headers = admin_headers(client)
    member, session = create_enrollment(client, headers)
    for pose in ("FRONT", "LEFT", "RIGHT"):
        response = client.post(
            f"/api/v1/enrollments/sessions/{session['id']}/samples?pose_type={pose}",
            headers={**headers, "Content-Type": "image/jpeg"},
            content=b"face-one",
        )
        assert response.status_code == 201
    completed = client.post(
        f"/api/v1/enrollments/sessions/{session['id']}/complete", headers=headers
    )
    assert completed.status_code == 200

    with SessionLocal() as db:
        before = len(list(db.scalars(select(CheckinAttempt)).all()))

    response = client.post(
        "/api/v1/live-camera/frames",
        headers={**headers, "Content-Type": "image/jpeg"},
        content=b"two-faces",
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["face_count"] == 2
    assert payload["image_width"] == 640
    assert payload["image_height"] == 480
    assert payload["faces"][0]["registration"] == "REGISTERED"
    assert payload["faces"][0]["member"] == {
        "full_name": member["full_name"],
        "member_code": member["member_code"],
    }
    assert payload["faces"][1]["registration"] == "UNREGISTERED"
    assert payload["faces"][1]["member"] is None
    assert "embedding" not in response.text
    assert "match_score" not in response.text
    with SessionLocal() as db:
        assert len(list(db.scalars(select(CheckinAttempt)).all())) == before


def test_live_camera_requires_authentication(real_client):
    client, _, _ = real_client
    response = client.post(
        "/api/v1/live-camera/frames",
        headers={"Content-Type": "image/jpeg"},
        content=b"two-faces",
    )
    assert response.status_code == 401
