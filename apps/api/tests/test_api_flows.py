from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.checkin import CheckinStateMachine
from app.database import SessionLocal
from app.models import AuditLog, Branch, CheckinAttempt, Decision, Device, Member
from tests.conftest import login


def kiosk_scan(client: TestClient, headers: dict[str, str], tag: str) -> dict:
    session = client.post("/api/v1/kiosk/sessions", headers=headers)
    assert session.status_code == 201, session.text
    response = client.post(
        "/api/v1/kiosk/checkin",
        headers=headers,
        json={
            "session_token": session.json()["session_token"],
            "sample_tag": tag,
            "idempotency_key": str(uuid4()),
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def member_by_code(client: TestClient, headers: dict[str, str], code: str) -> dict:
    response = client.get(f"/api/v1/members?search={code}", headers=headers)
    assert response.status_code == 200
    return next(item for item in response.json()["items"] if item["member_code"] == code)


def test_member_list_exposes_effective_membership_and_face_state(
    client: TestClient, admin_headers: dict[str, str]
):
    active = member_by_code(client, admin_headers, "DEMO-ACTIVE")
    expired = member_by_code(client, admin_headers, "DEMO-EXPIRED")
    no_face = member_by_code(client, admin_headers, "DEMO-NOFACE")

    assert active["plan"] == "Monthly"
    assert active["status"] == "ACTIVE"
    assert active["valid_until"] is not None
    assert active["face_enrolled"] is True
    assert active["joined_at"] is not None
    assert expired["status"] == "EXPIRED"
    assert no_face["face_enrolled"] is False


def test_member_code_is_optional_but_explicit_codes_are_preserved(
    client: TestClient, admin_headers: dict[str, str]
):
    generated = client.post(
        "/api/v1/members",
        headers=admin_headers,
        json={"full_name": "Generated Code Member"},
    )
    explicit = client.post(
        "/api/v1/members",
        headers=admin_headers,
        json={"member_code": "EXPLICIT-1", "full_name": "Explicit Code Member"},
    )

    assert generated.status_code == 201, generated.text
    assert generated.json()["member_code"].startswith("BG-")
    assert explicit.status_code == 201, explicit.text
    assert explicit.json()["member_code"] == "EXPLICIT-1"


def test_auth_refresh_rotation_and_secure_headers(client: TestClient):
    tokens = login(client, "admin@gym.local")
    response = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
    replay = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "INVALID_TOKEN"


def test_mock_checkin_decisions_and_duplicate_cooldown(
    client: TestClient, device_headers: dict[str, str]
):
    allowed = kiosk_scan(client, device_headers, "member-demo-active")
    assert allowed["decision"] == "ALLOW"
    assert allowed["reason_code"] == "MEMBERSHIP_ACTIVE"
    assert "match_score" not in allowed

    duplicate = kiosk_scan(client, device_headers, "member-demo-active")
    assert duplicate["reason_code"] == "DUPLICATE_CHECKIN"
    assert kiosk_scan(client, device_headers, "member-demo-expired")["reason_code"] == (
        "MEMBERSHIP_EXPIRED"
    )
    assert kiosk_scan(client, device_headers, "member-demo-suspended")["reason_code"] == (
        "MEMBERSHIP_SUSPENDED"
    )
    assert kiosk_scan(client, device_headers, "unknown")["reason_code"] == "IDENTITY_NOT_FOUND"
    assert kiosk_scan(client, device_headers, "spoof")["reason_code"] == "LIVENESS_FAILED"
    low = kiosk_scan(client, device_headers, "low-confidence:member-demo-active")
    assert low["reason_code"] == "LOW_MATCH_CONFIDENCE"


def test_branch_rbac_and_role_permissions(
    client: TestClient,
    reception_headers: dict[str, str],
    super_headers: dict[str, str],
):
    assert client.get("/api/v1/users", headers=reception_headers).status_code == 403
    branch_response = client.post(
        "/api/v1/branches",
        headers=super_headers,
        json={"code": "GYM-OTHER", "name": "Other Branch"},
    )
    assert branch_response.status_code == 201
    other_member = client.post(
        "/api/v1/members",
        headers=super_headers,
        json={
            "branch_id": branch_response.json()["id"],
            "member_code": "OTHER-1",
            "full_name": "Other Branch Member",
        },
    )
    assert other_member.status_code == 201
    denied = client.get(f"/api/v1/members/{other_member.json()['id']}", headers=reception_headers)
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "FORBIDDEN"


def test_manual_override_is_separate_and_audited(
    client: TestClient,
    device_headers: dict[str, str],
    reception_headers: dict[str, str],
):
    denied = kiosk_scan(client, device_headers, "unknown")
    member = member_by_code(client, reception_headers, "DEMO-ACTIVE")
    response = client.post(
        f"/api/v1/checkins/{denied['attempt_id']}/manual-override",
        headers=reception_headers,
        json={"member_id": member["id"], "reason": "Identity verified at reception"},
    )
    assert response.status_code == 201, response.text
    override = response.json()
    assert override["decision"] == "ALLOW"
    assert override["manual_override"] is True
    assert override["id"] != denied["attempt_id"]
    with SessionLocal() as db:
        audit = db.scalar(select(AuditLog).where(AuditLog.action == "CHECKIN_MANUAL_OVERRIDE"))
        assert audit is not None
        assert audit.after_data["reason"] == "Identity verified at reception"


def test_complete_enrollment_checkin_and_consent_revocation(
    client: TestClient,
    admin_headers: dict[str, str],
    device_headers: dict[str, str],
):
    member_response = client.post(
        "/api/v1/members",
        headers=admin_headers,
        json={"member_code": "FLOW-1", "full_name": "Flow Member"},
    )
    member = member_response.json()
    plan = client.get("/api/v1/membership-plans", headers=admin_headers).json()["items"][0]
    now = datetime.now(UTC)
    membership = client.post(
        f"/api/v1/members/{member['id']}/memberships",
        headers=admin_headers,
        json={
            "plan_id": plan["id"],
            "start_at": (now - timedelta(minutes=1)).isoformat(),
            "end_at": (now + timedelta(days=1)).isoformat(),
        },
    )
    assert membership.status_code == 201, membership.text
    consent = client.post(
        f"/api/v1/members/{member['id']}/biometric-consents",
        headers=admin_headers,
        json={
            "consent_version": "v2",
            "capture_purpose": "Gym entry",
            "retention_policy": "Until revoked",
        },
    )
    assert consent.status_code == 201
    session = client.post(
        "/api/v1/enrollments/sessions",
        headers=admin_headers,
        json={"member_id": member["id"]},
    ).json()
    for pose in ("FRONT", "LEFT", "RIGHT"):
        sample = client.post(
            f"/api/v1/enrollments/sessions/{session['id']}/samples",
            headers=admin_headers,
            json={"sample_tag": "flow-member-face", "pose_type": pose},
        )
        assert sample.status_code == 201, sample.text
    completed = client.post(
        f"/api/v1/enrollments/sessions/{session['id']}/complete", headers=admin_headers
    )
    assert completed.status_code == 200, completed.text
    assert kiosk_scan(client, device_headers, "flow-member-face")["decision"] == "ALLOW"

    revoked = client.post(
        f"/api/v1/biometric-consents/{consent.json()['id']}/revoke",
        headers=admin_headers,
        json={"reason": "Member requested deletion"},
    )
    assert revoked.status_code == 200
    assert revoked.json()["profiles_revoked"] == 1
    status = client.get(
        f"/api/v1/members/{member['id']}/face-profile/status", headers=admin_headers
    )
    assert status.json()["enrolled"] is False
    assert kiosk_scan(client, device_headers, "flow-member-face")["reason_code"] == (
        "IDENTITY_NOT_FOUND"
    )


def test_csv_export_sanitizes_formula_cells(client: TestClient, admin_headers: dict[str, str]):
    with SessionLocal() as db:
        branch = db.scalar(select(Branch).where(Branch.code == "GYM-001"))
        member = Member(
            branch_id=branch.id,
            member_code="CSV-1",
            full_name='=HYPERLINK("https://bad")',
        )
        db.add(member)
        db.flush()
        db.add(
            CheckinAttempt(
                branch_id=branch.id,
                member_id=member.id,
                decision=Decision.ALLOW,
                reason_code="MANUAL_OVERRIDE",
                processing_time_ms=1,
                manual_override=True,
                correlation_id=str(uuid4()),
            )
        )
        db.commit()
    response = client.get("/api/v1/reports/attendance?export=csv", headers=admin_headers)
    assert response.status_code == 200
    assert "'=HYPERLINK" in response.text
    assert response.headers["content-type"].startswith("text/csv")


def test_consent_required_and_consistent_error_shape(
    client: TestClient, admin_headers: dict[str, str]
):
    member = member_by_code(client, admin_headers, "DEMO-NOFACE")
    response = client.post(
        "/api/v1/enrollments/sessions",
        headers=admin_headers,
        json={"member_id": member["id"]},
    )
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "ACTIVE_CONSENT_REQUIRED"
    assert error["correlation_id"] == response.headers["x-correlation-id"]


def test_privileged_threshold_setting_affects_checkin(
    client: TestClient,
    super_headers: dict[str, str],
    reception_headers: dict[str, str],
    device_headers: dict[str, str],
):
    denied = client.patch(
        "/api/v1/settings/face_match_threshold",
        headers=reception_headers,
        json={"value": 0.2},
    )
    assert denied.status_code == 403
    invalid = client.patch(
        "/api/v1/settings/face_match_threshold",
        headers=super_headers,
        json={"value": 0},
    )
    assert invalid.status_code == 422
    updated = client.patch(
        "/api/v1/settings/face_match_threshold",
        headers=super_headers,
        json={"value": 0.2},
    )
    assert updated.status_code == 200
    result = kiosk_scan(client, device_headers, "low-confidence:member-demo-active")
    assert result["decision"] == "ALLOW"


def test_inactive_device_and_wrong_branch_state_rules(client: TestClient, settings):
    with SessionLocal() as db:
        source = db.scalar(select(Branch).where(Branch.code == "GYM-001"))
        assert source is not None
        other = Branch(code="GYM-X", name="Wrong Branch")
        db.add(other)
        db.flush()
        kiosk = db.scalar(select(Device).where(Device.device_code == "KIOSK-001"))
        kiosk.branch_id = other.id
        db.commit()
    headers = {
        "X-Device-Code": "KIOSK-001",
        "X-Device-Token": settings.device_shared_secret,
    }
    result = kiosk_scan(client, headers, "member-demo-active")
    assert result["reason_code"] == "IDENTITY_NOT_FOUND"
    with SessionLocal() as db:
        kiosk = db.scalar(select(Device).where(Device.device_code == "KIOSK-001"))
        kiosk.is_active = False
        db.commit()
        outcome = CheckinStateMachine(db, settings, kiosk, str(uuid4())).run(
            "member-demo-active", str(uuid4())
        )
        assert outcome.attempt.reason_code == "DEVICE_INACTIVE"
