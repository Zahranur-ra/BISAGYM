from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.biometrics import MockFaceRecognitionEngine
from app.config import Settings, get_settings
from app.database import Base, SessionLocal, configure_database, utcnow
from app.models import (
    BiometricConsent,
    Branch,
    Device,
    FaceProfile,
    Member,
    Membership,
    MembershipPlan,
    MembershipStatus,
    Role,
    User,
)
from app.security import credential_hash, hash_password


def seed_database(db: Session, settings: Settings) -> dict[str, str]:
    mock_engine = MockFaceRecognitionEngine()
    branch = db.scalar(select(Branch).where(Branch.code == "GYM-001"))
    if branch is None:
        branch = Branch(
            code="GYM-001",
            name="Demo Fitness Center",
            address="Jakarta",
            timezone="Asia/Jakarta",
        )
        db.add(branch)
        db.flush()

    users: dict[str, User] = {}
    user_specs = [
        ("superadmin@gym.local", "Demo Super Admin", Role.SUPER_ADMIN, None),
        ("admin@gym.local", "Demo Gym Admin", Role.GYM_ADMIN, branch.id),
        ("reception@gym.local", "Demo Receptionist", Role.RECEPTIONIST, branch.id),
    ]
    for email, name, role, branch_id in user_specs:
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(
                email=email,
                full_name=name,
                role=role,
                branch_id=branch_id,
                password_hash=hash_password(settings.demo_password),
            )
            db.add(user)
            db.flush()
        users[email] = user

    plan_specs = [
        ("Daily Pass", 1, 75000),
        ("Monthly", 30, 500000),
        ("Quarterly", 90, 1350000),
        ("Annual", 365, 4800000),
    ]
    plans: dict[str, MembershipPlan] = {}
    for name, duration, price in plan_specs:
        plan = db.scalar(
            select(MembershipPlan).where(
                MembershipPlan.branch_id == branch.id, MembershipPlan.name == name
            )
        )
        if plan is None:
            plan = MembershipPlan(
                branch_id=branch.id, name=name, duration_days=duration, price=price
            )
            db.add(plan)
            db.flush()
        plans[name] = plan

    now = utcnow()
    member_specs = [
        ("DEMO-ACTIVE", "Demo Active Member", "member-demo-active", MembershipStatus.ACTIVE),
        ("DEMO-EXPIRED", "Demo Expired Member", "member-demo-expired", MembershipStatus.EXPIRED),
        (
            "DEMO-SUSPENDED",
            "Demo Suspended Member",
            "member-demo-suspended",
            MembershipStatus.SUSPENDED,
        ),
        ("DEMO-NOFACE", "Demo Member Without Face Enrollment", None, MembershipStatus.ACTIVE),
    ]
    members: dict[str, Member] = {}
    for code, name, tag, membership_status in member_specs:
        member = db.scalar(
            select(Member).where(Member.branch_id == branch.id, Member.member_code == code)
        )
        if member is None:
            member = Member(branch_id=branch.id, member_code=code, full_name=name)
            db.add(member)
            db.flush()
        members[code] = member
        membership = db.scalar(select(Membership).where(Membership.member_id == member.id))
        if membership is None:
            if membership_status == MembershipStatus.EXPIRED:
                start, end = now - timedelta(days=60), now - timedelta(days=30)
            else:
                start, end = now - timedelta(days=1), now + timedelta(days=29)
            membership = Membership(
                member_id=member.id,
                plan_id=plans["Monthly"].id,
                start_at=start,
                end_at=end,
                status=membership_status,
                price_paid=plans["Monthly"].price,
                created_by=users["admin@gym.local"].id,
                suspended_at=now if membership_status == MembershipStatus.SUSPENDED else None,
                suspension_reason=(
                    "Demo suspension" if membership_status == MembershipStatus.SUSPENDED else None
                ),
            )
            db.add(membership)
        if tag:
            consent = db.scalar(
                select(BiometricConsent).where(
                    BiometricConsent.member_id == member.id,
                    BiometricConsent.revoked_at.is_(None),
                )
            )
            if consent is None:
                consent = BiometricConsent(
                    member_id=member.id,
                    consent_version="v1-demo",
                    capture_purpose="Gym access control demo",
                    retention_policy="Retain until consent is revoked",
                    operator_user_id=users["admin@gym.local"].id,
                )
                db.add(consent)
            profile = db.scalar(
                select(FaceProfile).where(
                    FaceProfile.member_id == member.id,
                    FaceProfile.revoked_at.is_(None),
                    FaceProfile.model_name == mock_engine.model_name,
                    FaceProfile.model_version == mock_engine.model_version,
                    FaceProfile.embedding_dimension == mock_engine.dimension,
                )
            )
            if profile is None and settings.face_engine == "mock":
                embedding = mock_engine.embedding_for_tag(tag)
                db.add(
                    FaceProfile(
                        member_id=member.id,
                        model_name=mock_engine.model_name,
                        model_version=mock_engine.model_version,
                        embedding_dimension=len(embedding),
                        embedding=embedding,
                        quality_score=0.95,
                        enrollment_status="ACTIVE",
                        is_primary=True,
                        created_by=users["admin@gym.local"].id,
                    )
                )

    device = db.scalar(select(Device).where(Device.device_code == "KIOSK-001"))
    if device is None:
        device = Device(
            branch_id=branch.id,
            device_code="KIOSK-001",
            name="Demo Front Door Kiosk",
            credential_hash=credential_hash(settings.device_shared_secret),
            capabilities={
                "rgb": True,
                "depth": False,
                "active_liveness": settings.liveness_mode != "none",
                "demo_mode": settings.face_engine == "mock",
            },
        )
        db.add(device)
    db.commit()
    return {
        "branch_id": branch.id,
        "device_code": device.device_code,
        "device_token": settings.device_shared_secret,
        "demo_password": settings.demo_password,
    }


def main() -> None:
    settings = get_settings()
    engine = configure_database(settings.database_url)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        result = seed_database(db, settings)
    print(f"Seed complete: branch={result['branch_id']} device={result['device_code']}")


if __name__ == "__main__":
    main()
