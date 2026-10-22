import csv
import io
import math
import secrets
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy import desc, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.audit import record_audit
from app.biometrics import FaceRecognitionEngine, cosine_similarity
from app.checkin import CheckinOutcome, CheckinStateMachine, kiosk_response
from app.config import Settings
from app.database import as_utc, get_db, utcnow
from app.deps import (
    app_settings,
    current_device,
    current_user,
    ensure_branch_access,
    face_recognition_engine,
    require_roles,
)
from app.errors import APIError, conflict, forbidden, not_found
from app.models import (
    AccessEvent,
    AuditLog,
    AuthSession,
    BiometricConsent,
    Branch,
    CheckinAttempt,
    Decision,
    Device,
    EnrollmentSession,
    FaceEnrollmentSample,
    FaceProfile,
    KioskSession,
    Member,
    Membership,
    MembershipPlan,
    MembershipStatus,
    Role,
    SystemSetting,
    User,
)
from app.rate_limit import rate_limiter
from app.schemas import (
    BranchCreate,
    ChangePasswordRequest,
    ConsentCreate,
    DeviceCreate,
    DeviceUpdate,
    EnrollmentSampleCreate,
    EnrollmentSessionCreate,
    HeartbeatRequest,
    KioskCheckinRequest,
    LiveCameraFrameResponse,
    LoginRequest,
    LogoutRequest,
    ManualOverrideRequest,
    MemberCreate,
    MembershipCreate,
    MembershipUpdate,
    MemberUpdate,
    PlanCreate,
    PlanUpdate,
    RefreshRequest,
    RevokeRequest,
    SettingUpdate,
    SuspendRequest,
    UserCreate,
)
from app.security import (
    create_access_token,
    create_kiosk_token,
    create_refresh_token,
    credential_hash,
    decode_token,
    hash_password,
    new_device_secret,
    token_fingerprint,
    verify_password,
)

router = APIRouter(prefix="/api/v1")
STAFF_ROLES = (Role.SUPER_ADMIN, Role.GYM_ADMIN, Role.RECEPTIONIST)
ADMIN_ROLES = (Role.SUPER_ADMIN, Role.GYM_ADMIN)
IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png"}
REQUIRED_ENROLLMENT_POSES = {"FRONT", "LEFT", "RIGHT"}


def correlation_id(request: Request) -> str:
    return request.state.correlation_id


def client_context(request: Request) -> dict[str, str | None]:
    return {
        "ip_address": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
    }


async def read_limited_image(request: Request, settings: Settings) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > settings.max_sample_bytes:
                raise APIError(413, "IMAGE_TOO_LARGE", "Image body exceeds the configured limit.")
        except ValueError as exc:
            raise APIError(400, "INVALID_CONTENT_LENGTH", "Content-Length is invalid.") from exc
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > settings.max_sample_bytes:
            raise APIError(413, "IMAGE_TOO_LARGE", "Image body exceeds the configured limit.")
    if not body:
        raise APIError(422, "INVALID_IMAGE", "Image body is empty.")
    return bytes(body)


def recognition_error_code(errors: list[str], detected_face_count: int) -> str:
    if errors:
        return errors[0]
    if detected_face_count == 0:
        return "NO_FACE"
    if detected_face_count != 1:
        return "MULTIPLE_FACES"
    return "LOW_IMAGE_QUALITY"


def user_data(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "branch_id": user.branch_id,
        "full_name": user.full_name,
        "email": user.email,
        "role": user.role.value,
        "is_active": user.is_active,
        "last_login_at": user.last_login_at,
        "created_at": user.created_at,
    }


def member_data(member: Member, db: Session) -> dict[str, Any]:
    now = utcnow()
    memberships = list(
        db.scalars(
            select(Membership)
            .where(Membership.member_id == member.id)
            .order_by(desc(Membership.start_at))
        ).all()
    )
    current = [
        item
        for item in memberships
        if as_utc(item.start_at) <= now < as_utc(item.end_at)
        and item.status != MembershipStatus.CANCELLED
    ]
    future = [
        item
        for item in memberships
        if now < as_utc(item.start_at)
        and item.status in {MembershipStatus.ACTIVE, MembershipStatus.PENDING}
    ]
    membership = (
        max(current, key=lambda item: as_utc(item.start_at))
        if current
        else min(future, key=lambda item: as_utc(item.start_at))
        if future
        else memberships[0]
        if memberships
        else None
    )

    if member.status.value == "SUSPENDED":
        effective_status = MembershipStatus.SUSPENDED.value
    elif member.status.value == "INACTIVE":
        effective_status = MembershipStatus.CANCELLED.value
    elif membership is None:
        effective_status = MembershipStatus.PENDING.value
    elif membership.status in {MembershipStatus.SUSPENDED, MembershipStatus.CANCELLED}:
        effective_status = membership.status.value
    elif now < as_utc(membership.start_at):
        effective_status = MembershipStatus.PENDING.value
    elif now >= as_utc(membership.end_at):
        effective_status = MembershipStatus.EXPIRED.value
    else:
        effective_status = MembershipStatus.ACTIVE.value

    plan = db.get(MembershipPlan, membership.plan_id) if membership else None
    face_enrolled = bool(
        db.scalar(
            select(FaceProfile.id).where(
                FaceProfile.member_id == member.id,
                FaceProfile.revoked_at.is_(None),
                FaceProfile.enrollment_status == "ACTIVE",
            )
        )
    )
    return {
        "id": member.id,
        "branch_id": member.branch_id,
        "member_code": member.member_code,
        "full_name": member.full_name,
        "email": member.email,
        "phone": member.phone,
        "date_of_birth": member.date_of_birth,
        "gender": member.gender,
        "address": member.address,
        "photo_url": member.photo_url,
        "status": effective_status,
        "plan": plan.name if plan else None,
        "valid_until": membership.end_at if membership else None,
        "face_enrolled": face_enrolled,
        "joined_at": member.created_at,
        "emergency_contact_name": member.emergency_contact_name,
        "emergency_contact_phone": member.emergency_contact_phone,
        "notes": member.notes,
        "created_at": member.created_at,
        "updated_at": member.updated_at,
    }


def plan_data(plan: MembershipPlan) -> dict[str, Any]:
    return {
        "id": plan.id,
        "branch_id": plan.branch_id,
        "name": plan.name,
        "duration_days": plan.duration_days,
        "price": str(plan.price),
        "description": plan.description,
        "is_active": plan.is_active,
        "created_at": plan.created_at,
        "updated_at": plan.updated_at,
    }


def membership_data(membership: Membership) -> dict[str, Any]:
    now = utcnow()
    derived_status = membership.status.value
    if membership.status in {MembershipStatus.ACTIVE, MembershipStatus.PENDING}:
        if now < as_utc(membership.start_at):
            derived_status = MembershipStatus.PENDING.value
        elif now >= as_utc(membership.end_at):
            derived_status = MembershipStatus.EXPIRED.value
        else:
            derived_status = MembershipStatus.ACTIVE.value
    return {
        "id": membership.id,
        "member_id": membership.member_id,
        "plan_id": membership.plan_id,
        "start_at": membership.start_at,
        "end_at": membership.end_at,
        "status": membership.status.value,
        "derived_status": derived_status,
        "price_paid": str(membership.price_paid),
        "payment_reference": membership.payment_reference,
        "created_by": membership.created_by,
        "suspended_at": membership.suspended_at,
        "suspension_reason": membership.suspension_reason,
        "created_at": membership.created_at,
        "updated_at": membership.updated_at,
    }


def consent_data(consent: BiometricConsent) -> dict[str, Any]:
    return {
        "id": consent.id,
        "member_id": consent.member_id,
        "consent_version": consent.consent_version,
        "consented_at": consent.consented_at,
        "revoked_at": consent.revoked_at,
        "capture_purpose": consent.capture_purpose,
        "retention_policy": consent.retention_policy,
        "operator_user_id": consent.operator_user_id,
        "signature_reference": consent.signature_reference,
        "created_at": consent.created_at,
    }


def device_data(device: Device) -> dict[str, Any]:
    return {
        "id": device.id,
        "branch_id": device.branch_id,
        "device_code": device.device_code,
        "name": device.name,
        "device_type": device.device_type,
        "capabilities": device.capabilities,
        "is_active": device.is_active,
        "last_seen_at": device.last_seen_at,
        "created_at": device.created_at,
        "updated_at": device.updated_at,
    }


def checkin_data(attempt: CheckinAttempt, db: Session) -> dict[str, Any]:
    member = db.get(Member, attempt.member_id) if attempt.member_id else None
    device = db.get(Device, attempt.device_id) if attempt.device_id else None
    return {
        "id": attempt.id,
        "branch_id": attempt.branch_id,
        "device": {"id": device.id, "name": device.name} if device else None,
        "member": (
            {"id": member.id, "member_code": member.member_code, "full_name": member.full_name}
            if member
            else None
        ),
        "attempted_at": attempt.attempted_at,
        "decision": attempt.decision.value,
        "reason_code": attempt.reason_code,
        "match_score": float(attempt.match_score) if attempt.match_score is not None else None,
        "match_threshold": (
            float(attempt.match_threshold) if attempt.match_threshold is not None else None
        ),
        "quality_score": (
            float(attempt.quality_score) if attempt.quality_score is not None else None
        ),
        "liveness_score": (
            float(attempt.liveness_score) if attempt.liveness_score is not None else None
        ),
        "membership_id": attempt.membership_id,
        "processing_time_ms": attempt.processing_time_ms,
        "manual_override": attempt.manual_override,
        "operator_user_id": attempt.operator_user_id,
        "correlation_id": attempt.correlation_id,
        "metadata": attempt.metadata_json,
    }


def get_member_for_user(db: Session, member_id: str, user: User) -> Member:
    member = db.get(Member, member_id)
    if member is None or member.deleted_at is not None:
        raise not_found("Member")
    ensure_branch_access(user, member.branch_id)
    return member


def get_membership_for_user(db: Session, membership_id: str, user: User) -> Membership:
    membership = db.get(Membership, membership_id)
    if membership is None:
        raise not_found("Membership")
    get_member_for_user(db, membership.member_id, user)
    return membership


@router.post("/auth/login")
def login(
    payload: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
) -> dict[str, Any]:
    key = f"login:{request.client.host if request.client else 'unknown'}:{payload.email}"
    rate_limiter.check(key, settings.login_rate_limit, settings.rate_limit_window_seconds)
    user = db.scalar(select(User).where(User.email == payload.email))
    if (
        user is None
        or not user.is_active
        or not verify_password(payload.password, user.password_hash)
    ):
        record_audit(
            db,
            action="AUTH_LOGIN_FAILED",
            resource_type="authentication",
            correlation_id=correlation_id(request),
            after={"email": payload.email},
            **client_context(request),
        )
        db.commit()
        raise APIError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.")
    access = create_access_token(user.id, settings)
    refresh, jti = create_refresh_token(user.id, settings)
    db.add(
        AuthSession(
            user_id=user.id,
            jti_hash=token_fingerprint(jti),
            expires_at=utcnow() + timedelta(days=settings.refresh_token_expire_days),
        )
    )
    user.last_login_at = utcnow()
    record_audit(
        db,
        actor_id=user.id,
        action="AUTH_LOGIN_SUCCESS",
        resource_type="authentication",
        correlation_id=correlation_id(request),
        **client_context(request),
    )
    db.commit()
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "expires_in": settings.access_token_expire_minutes * 60,
        "user": user_data(user),
    }


@router.post("/auth/refresh")
def refresh_token(
    payload: RefreshRequest,
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
) -> dict[str, Any]:
    decoded = decode_token(payload.refresh_token, "refresh", settings)
    session = db.scalar(
        select(AuthSession).where(AuthSession.jti_hash == token_fingerprint(decoded["jti"]))
    )
    if session is None or session.revoked_at is not None or as_utc(session.expires_at) <= utcnow():
        raise APIError(401, "INVALID_TOKEN", "Refresh token has been revoked or expired.")
    user = db.get(User, decoded["sub"])
    if user is None or not user.is_active:
        raise APIError(401, "INVALID_TOKEN", "User is inactive or unavailable.")
    session.revoked_at = utcnow()
    new_refresh, jti = create_refresh_token(user.id, settings)
    db.add(
        AuthSession(
            user_id=user.id,
            jti_hash=token_fingerprint(jti),
            expires_at=utcnow() + timedelta(days=settings.refresh_token_expire_days),
        )
    )
    db.commit()
    return {
        "access_token": create_access_token(user.id, settings),
        "refresh_token": new_refresh,
        "token_type": "bearer",
        "expires_in": settings.access_token_expire_minutes * 60,
        "user": user_data(user),
    }


@router.post("/auth/logout", status_code=204)
def logout(
    payload: LogoutRequest,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
) -> Response:
    if payload.refresh_token:
        decoded = decode_token(payload.refresh_token, "refresh", settings)
        if decoded["sub"] != user.id:
            raise forbidden()
        session = db.scalar(
            select(AuthSession).where(AuthSession.jti_hash == token_fingerprint(decoded["jti"]))
        )
        if session:
            session.revoked_at = utcnow()
    record_audit(
        db,
        actor_id=user.id,
        action="AUTH_LOGOUT",
        resource_type="authentication",
        correlation_id=correlation_id(request),
        **client_context(request),
    )
    db.commit()
    return Response(status_code=204)


@router.get("/auth/me")
def me(user: User = Depends(current_user)) -> dict[str, Any]:
    return user_data(user)


@router.post("/auth/change-password", status_code=204)
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> Response:
    if not verify_password(payload.current_password, user.password_hash):
        raise APIError(400, "INVALID_PASSWORD", "Current password is incorrect.")
    user.password_hash = hash_password(payload.new_password)
    db.execute(
        select(AuthSession).where(AuthSession.user_id == user.id)
    )  # keep the mutation and audit in one transaction
    for auth_session in db.scalars(
        select(AuthSession).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
    ):
        auth_session.revoked_at = utcnow()
    record_audit(
        db,
        actor_id=user.id,
        action="AUTH_PASSWORD_CHANGED",
        resource_type="user",
        resource_id=user.id,
        correlation_id=correlation_id(request),
    )
    db.commit()
    return Response(status_code=204)


@router.get("/branches")
def list_branches(
    user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict[str, Any]:
    query = select(Branch).order_by(Branch.name)
    if user.role != Role.SUPER_ADMIN:
        query = query.where(Branch.id == user.branch_id)
    items = list(db.scalars(query).all())
    return {
        "items": [
            {
                "id": item.id,
                "code": item.code,
                "name": item.name,
                "address": item.address,
                "timezone": item.timezone,
                "is_active": item.is_active,
            }
            for item in items
        ],
        "total": len(items),
    }


@router.post("/branches", status_code=201)
def create_branch(
    payload: BranchCreate,
    request: Request,
    user: User = Depends(require_roles(Role.SUPER_ADMIN)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    branch = Branch(**payload.model_dump())
    db.add(branch)
    try:
        db.flush()
    except IntegrityError as exc:
        raise conflict("BRANCH_CODE_EXISTS", "Branch code already exists.") from exc
    record_audit(
        db,
        actor_id=user.id,
        action="BRANCH_CREATED",
        resource_type="branch",
        resource_id=branch.id,
        after=payload.model_dump(),
        correlation_id=correlation_id(request),
    )
    db.commit()
    return {"id": branch.id, **payload.model_dump()}


@router.get("/users")
def list_users(
    user: User = Depends(require_roles(Role.SUPER_ADMIN)), db: Session = Depends(get_db)
) -> dict[str, Any]:
    items = list(db.scalars(select(User).order_by(User.full_name)).all())
    return {"items": [user_data(item) for item in items], "total": len(items)}


@router.post("/users", status_code=201)
def create_user(
    payload: UserCreate,
    request: Request,
    actor: User = Depends(require_roles(Role.SUPER_ADMIN)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if payload.role != Role.SUPER_ADMIN and not payload.branch_id:
        raise APIError(422, "BRANCH_REQUIRED", "A branch is required for this role.")
    if payload.branch_id and db.get(Branch, payload.branch_id) is None:
        raise not_found("Branch")
    user = User(
        branch_id=payload.branch_id,
        full_name=payload.full_name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        raise conflict("EMAIL_EXISTS", "Email address already exists.") from exc
    record_audit(
        db,
        actor_id=actor.id,
        action="USER_CREATED",
        resource_type="user",
        resource_id=user.id,
        after=user_data(user),
        correlation_id=correlation_id(request),
    )
    db.commit()
    return user_data(user)


@router.get("/members")
def list_members(
    search: str | None = None,
    status: str | None = None,
    branch_id: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    query = select(Member).where(Member.deleted_at.is_(None))
    if user.role != Role.SUPER_ADMIN:
        query = query.where(Member.branch_id == user.branch_id)
    elif branch_id:
        query = query.where(Member.branch_id == branch_id)
    if search:
        term = f"%{search}%"
        query = query.where(
            or_(
                Member.full_name.ilike(term),
                Member.member_code.ilike(term),
                Member.email.ilike(term),
            )
        )
    if status:
        query = query.where(Member.status == status)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = db.scalars(query.order_by(Member.full_name).limit(limit).offset(offset)).all()
    return {"items": [member_data(item, db) for item in items], "total": total}


@router.post("/members", status_code=201)
def create_member(
    payload: MemberCreate,
    request: Request,
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    branch_id = payload.branch_id or user.branch_id
    if not branch_id:
        raise APIError(422, "BRANCH_REQUIRED", "branch_id is required.")
    ensure_branch_access(user, branch_id)
    if db.get(Branch, branch_id) is None:
        raise not_found("Branch")
    values = payload.model_dump(exclude={"branch_id"})
    if not values["member_code"]:
        while True:
            values["member_code"] = f"BG-{secrets.token_hex(4).upper()}"
            exists = db.scalar(
                select(Member.id).where(
                    Member.branch_id == branch_id,
                    Member.member_code == values["member_code"],
                )
            )
            if not exists:
                break
    member = Member(branch_id=branch_id, **values)
    db.add(member)
    try:
        db.flush()
    except IntegrityError as exc:
        raise conflict("MEMBER_CODE_EXISTS", "Member code already exists in this branch.") from exc
    record_audit(
        db,
        actor_id=user.id,
        action="MEMBER_CREATED",
        resource_type="member",
        resource_id=member.id,
        after=member_data(member, db),
        correlation_id=correlation_id(request),
        **client_context(request),
    )
    db.commit()
    return member_data(member, db)


@router.get("/members/{member_id}")
def get_member(
    member_id: str,
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return member_data(get_member_for_user(db, member_id, user), db)


@router.patch("/members/{member_id}")
def update_member(
    member_id: str,
    payload: MemberUpdate,
    request: Request,
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    member = get_member_for_user(db, member_id, user)
    before = member_data(member, db)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(member, key, value)
    record_audit(
        db,
        actor_id=user.id,
        action="MEMBER_UPDATED",
        resource_type="member",
        resource_id=member.id,
        before=before,
        after=payload.model_dump(exclude_unset=True),
        correlation_id=correlation_id(request),
    )
    db.commit()
    return member_data(member, db)


@router.delete("/members/{member_id}", status_code=204)
def delete_member(
    member_id: str,
    request: Request,
    user: User = Depends(require_roles(*ADMIN_ROLES)),
    db: Session = Depends(get_db),
) -> Response:
    member = get_member_for_user(db, member_id, user)
    member.deleted_at = utcnow()
    for profile in db.scalars(
        select(FaceProfile).where(
            FaceProfile.member_id == member.id, FaceProfile.revoked_at.is_(None)
        )
    ):
        profile.revoked_at = utcnow()
        profile.revocation_reason = "Member deleted"
        profile.enrollment_status = "REVOKED"
    record_audit(
        db,
        actor_id=user.id,
        action="MEMBER_DELETED",
        resource_type="member",
        resource_id=member.id,
        correlation_id=correlation_id(request),
    )
    db.commit()
    return Response(status_code=204)


@router.get("/membership-plans")
def list_plans(
    user: User = Depends(require_roles(*STAFF_ROLES)), db: Session = Depends(get_db)
) -> dict[str, Any]:
    query = select(MembershipPlan)
    if user.role != Role.SUPER_ADMIN:
        query = query.where(
            or_(MembershipPlan.branch_id.is_(None), MembershipPlan.branch_id == user.branch_id)
        )
    items = db.scalars(query.order_by(MembershipPlan.name)).all()
    return {"items": [plan_data(item) for item in items], "total": len(items)}


@router.post("/membership-plans", status_code=201)
def create_plan(
    payload: PlanCreate,
    request: Request,
    user: User = Depends(require_roles(*ADMIN_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    branch_id = payload.branch_id
    if user.role != Role.SUPER_ADMIN:
        branch_id = user.branch_id
    if branch_id:
        ensure_branch_access(user, branch_id)
    plan = MembershipPlan(**payload.model_dump(exclude={"branch_id"}), branch_id=branch_id)
    db.add(plan)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action="MEMBERSHIP_PLAN_CREATED",
        resource_type="membership_plan",
        resource_id=plan.id,
        after=plan_data(plan),
        correlation_id=correlation_id(request),
    )
    db.commit()
    return plan_data(plan)


@router.patch("/membership-plans/{plan_id}")
def update_plan(
    plan_id: str,
    payload: PlanUpdate,
    request: Request,
    user: User = Depends(require_roles(*ADMIN_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    plan = db.get(MembershipPlan, plan_id)
    if plan is None:
        raise not_found("Membership plan")
    if plan.branch_id:
        ensure_branch_access(user, plan.branch_id)
    elif user.role != Role.SUPER_ADMIN:
        raise forbidden("Only a super admin can modify a global plan.")
    before = plan_data(plan)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(plan, key, value)
    record_audit(
        db,
        actor_id=user.id,
        action="MEMBERSHIP_PLAN_UPDATED",
        resource_type="membership_plan",
        resource_id=plan.id,
        before=before,
        after=payload.model_dump(exclude_unset=True),
        correlation_id=correlation_id(request),
    )
    db.commit()
    return plan_data(plan)


@router.get("/members/{member_id}/memberships")
def member_memberships(
    member_id: str,
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    member = get_member_for_user(db, member_id, user)
    items = db.scalars(
        select(Membership)
        .where(Membership.member_id == member.id)
        .order_by(desc(Membership.start_at))
    ).all()
    return {"items": [membership_data(item) for item in items], "total": len(items)}


@router.post("/members/{member_id}/memberships", status_code=201)
def create_membership(
    member_id: str,
    payload: MembershipCreate,
    request: Request,
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    member = get_member_for_user(db, member_id, user)
    plan = db.get(MembershipPlan, payload.plan_id)
    if plan is None or (plan.branch_id is not None and plan.branch_id != member.branch_id):
        raise not_found("Membership plan")
    start_at = as_utc(payload.start_at)
    end_at = (
        as_utc(payload.end_at) if payload.end_at else start_at + timedelta(days=plan.duration_days)
    )
    overlap = db.scalar(
        select(Membership).where(
            Membership.member_id == member.id,
            Membership.status.in_([MembershipStatus.ACTIVE, MembershipStatus.PENDING]),
            Membership.start_at < end_at,
            Membership.end_at > start_at,
        )
    )
    if overlap:
        raise conflict("MEMBERSHIP_OVERLAP", "Member already has a membership in this period.")
    membership = Membership(
        member_id=member.id,
        plan_id=plan.id,
        start_at=start_at,
        end_at=end_at,
        status=MembershipStatus.ACTIVE if start_at <= utcnow() else MembershipStatus.PENDING,
        price_paid=payload.price_paid,
        payment_reference=payload.payment_reference,
        created_by=user.id,
    )
    db.add(membership)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action="MEMBERSHIP_CREATED",
        resource_type="membership",
        resource_id=membership.id,
        after=membership_data(membership),
        correlation_id=correlation_id(request),
    )
    db.commit()
    return membership_data(membership)


@router.patch("/memberships/{membership_id}")
def update_membership(
    membership_id: str,
    payload: MembershipUpdate,
    request: Request,
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    membership = get_membership_for_user(db, membership_id, user)
    values = payload.model_dump(exclude_unset=True)
    start = as_utc(values.get("start_at", membership.start_at))
    end = as_utc(values.get("end_at", membership.end_at))
    if end <= start:
        raise APIError(422, "INVALID_MEMBERSHIP_PERIOD", "end_at must be after start_at.")
    before = membership_data(membership)
    for key, value in values.items():
        setattr(membership, key, value)
    record_audit(
        db,
        actor_id=user.id,
        action="MEMBERSHIP_UPDATED",
        resource_type="membership",
        resource_id=membership.id,
        before=before,
        after=values,
        correlation_id=correlation_id(request),
    )
    db.commit()
    return membership_data(membership)


@router.post("/memberships/{membership_id}/suspend")
def suspend_membership(
    membership_id: str,
    payload: SuspendRequest,
    request: Request,
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    membership = get_membership_for_user(db, membership_id, user)
    if membership.status == MembershipStatus.CANCELLED:
        raise conflict("MEMBERSHIP_CANCELLED", "A cancelled membership cannot be suspended.")
    membership.status = MembershipStatus.SUSPENDED
    membership.suspended_at = utcnow()
    membership.suspension_reason = payload.reason
    record_audit(
        db,
        actor_id=user.id,
        action="MEMBERSHIP_SUSPENDED",
        resource_type="membership",
        resource_id=membership.id,
        after={"reason": payload.reason},
        correlation_id=correlation_id(request),
    )
    db.commit()
    return membership_data(membership)


@router.post("/memberships/{membership_id}/reactivate")
def reactivate_membership(
    membership_id: str,
    request: Request,
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    membership = get_membership_for_user(db, membership_id, user)
    if membership.status != MembershipStatus.SUSPENDED:
        raise conflict(
            "INVALID_MEMBERSHIP_STATE", "Only a suspended membership can be reactivated."
        )
    membership.status = MembershipStatus.ACTIVE
    membership.suspended_at = None
    membership.suspension_reason = None
    record_audit(
        db,
        actor_id=user.id,
        action="MEMBERSHIP_REACTIVATED",
        resource_type="membership",
        resource_id=membership.id,
        correlation_id=correlation_id(request),
    )
    db.commit()
    return membership_data(membership)


@router.post("/memberships/{membership_id}/cancel")
def cancel_membership(
    membership_id: str,
    request: Request,
    user: User = Depends(require_roles(*ADMIN_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    membership = get_membership_for_user(db, membership_id, user)
    membership.status = MembershipStatus.CANCELLED
    record_audit(
        db,
        actor_id=user.id,
        action="MEMBERSHIP_CANCELLED",
        resource_type="membership",
        resource_id=membership.id,
        correlation_id=correlation_id(request),
    )
    db.commit()
    return membership_data(membership)


@router.get("/members/{member_id}/biometric-consents")
def list_consents(
    member_id: str,
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    member = get_member_for_user(db, member_id, user)
    items = db.scalars(
        select(BiometricConsent)
        .where(BiometricConsent.member_id == member.id)
        .order_by(desc(BiometricConsent.consented_at))
    ).all()
    return {"items": [consent_data(item) for item in items], "total": len(items)}


@router.post("/members/{member_id}/biometric-consents", status_code=201)
def create_consent(
    member_id: str,
    payload: ConsentCreate,
    request: Request,
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    member = get_member_for_user(db, member_id, user)
    for active in db.scalars(
        select(BiometricConsent).where(
            BiometricConsent.member_id == member.id, BiometricConsent.revoked_at.is_(None)
        )
    ):
        active.revoked_at = utcnow()
    consent = BiometricConsent(
        member_id=member.id, operator_user_id=user.id, **payload.model_dump()
    )
    db.add(consent)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action="BIOMETRIC_CONSENT_RECORDED",
        resource_type="biometric_consent",
        resource_id=consent.id,
        after=consent_data(consent),
        correlation_id=correlation_id(request),
    )
    db.commit()
    return consent_data(consent)


@router.post("/biometric-consents/{consent_id}/revoke")
def revoke_consent(
    consent_id: str,
    payload: RevokeRequest,
    request: Request,
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    consent = db.get(BiometricConsent, consent_id)
    if consent is None:
        raise not_found("Biometric consent")
    get_member_for_user(db, consent.member_id, user)
    if consent.revoked_at is not None:
        raise conflict("CONSENT_ALREADY_REVOKED", "Biometric consent is already revoked.")
    now = utcnow()
    consent.revoked_at = now
    revoked_profiles = 0
    for profile in db.scalars(
        select(FaceProfile).where(
            FaceProfile.member_id == consent.member_id, FaceProfile.revoked_at.is_(None)
        )
    ):
        profile.revoked_at = now
        profile.revocation_reason = payload.reason
        profile.enrollment_status = "REVOKED"
        revoked_profiles += 1
    record_audit(
        db,
        actor_id=user.id,
        action="BIOMETRIC_CONSENT_REVOKED",
        resource_type="biometric_consent",
        resource_id=consent.id,
        after={"reason": payload.reason, "profiles_revoked": revoked_profiles},
        correlation_id=correlation_id(request),
    )
    db.commit()
    return {**consent_data(consent), "profiles_revoked": revoked_profiles}


@router.post("/enrollments/sessions", status_code=201)
def create_enrollment_session(
    payload: EnrollmentSessionCreate,
    request: Request,
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    engine: FaceRecognitionEngine = Depends(face_recognition_engine),
) -> dict[str, Any]:
    member = get_member_for_user(db, payload.member_id, user)
    consent = db.scalar(
        select(BiometricConsent)
        .where(
            BiometricConsent.member_id == member.id,
            BiometricConsent.revoked_at.is_(None),
        )
        .order_by(desc(BiometricConsent.consented_at))
    )
    if consent is None:
        raise APIError(409, "ACTIVE_CONSENT_REQUIRED", "Active biometric consent is required.")
    session = EnrollmentSession(
        member_id=member.id,
        operator_user_id=user.id,
        expires_at=utcnow() + timedelta(minutes=10),
    )
    db.add(session)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action="ENROLLMENT_SESSION_CREATED",
        resource_type="enrollment_session",
        resource_id=session.id,
        correlation_id=correlation_id(request),
    )
    db.commit()
    return {
        "id": session.id,
        "member_id": session.member_id,
        "status": session.status,
        "expires_at": session.expires_at,
        "required_poses": ["FRONT", "LEFT", "RIGHT"],
        "engine": engine.engine_name,
        "demo_mode": engine.engine_name == "mock",
    }


@router.post("/enrollments/sessions/{session_id}/samples", status_code=201)
async def add_enrollment_sample(
    session_id: str,
    request: Request,
    pose_type: str | None = Query(default=None),
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    engine: FaceRecognitionEngine = Depends(face_recognition_engine),
) -> dict[str, Any]:
    session = db.get(EnrollmentSession, session_id)
    if session is None:
        raise not_found("Enrollment session")
    get_member_for_user(db, session.member_id, user)
    if session.status != "OPEN" or as_utc(session.expires_at) <= utcnow():
        raise APIError(409, "ENROLLMENT_SESSION_CLOSED", "Enrollment session is closed or expired.")
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    payload: EnrollmentSampleCreate | None = None
    if settings.face_engine == "mock":
        if content_type != "application/json":
            raise APIError(
                415,
                "BIOMETRIC_PAYLOAD_MODE_MISMATCH",
                "Mock mode requires the JSON sample_tag payload.",
            )
        try:
            payload = EnrollmentSampleCreate.model_validate(await request.json())
        except (ValidationError, ValueError) as exc:
            raise APIError(422, "VALIDATION_ERROR", "Request validation failed.") from exc
        image_bytes = payload.sample_tag.encode()
        selected_pose = payload.pose_type
        depth_available = payload.depth_available
        depth_quality_score = payload.depth_quality_score
    else:
        if content_type not in IMAGE_CONTENT_TYPES:
            raise APIError(
                415,
                "BIOMETRIC_PAYLOAD_MODE_MISMATCH",
                "OpenCV mode requires a raw image/jpeg or image/png body.",
            )
        selected_pose = pose_type.upper() if pose_type else None
        if selected_pose not in {"FRONT", "LEFT", "RIGHT", "UP", "DOWN"}:
            raise APIError(
                422,
                "INVALID_POSE_TYPE",
                "A valid pose_type query parameter is required.",
            )
        image_bytes = await read_limited_image(request, settings)
        depth_available = False
        depth_quality_score = None

    result = engine.analyze_enrollment_sample(image_bytes)
    if result.detected_face_count != 1:
        code = recognition_error_code(result.errors, result.detected_face_count)
        raise APIError(422, code, "Exactly one face is required.")
    if result.errors:
        raise APIError(422, result.errors[0], "Enrollment image did not pass quality checks.")
    if result.quality_score is None or result.quality_score < settings.face_min_quality_score:
        raise APIError(422, "LOW_IMAGE_QUALITY", "Enrollment sample quality is too low.")
    if settings.liveness_mode != "none" and (
        result.liveness_score is None or result.liveness_score < settings.liveness_min_score
    ):
        raise APIError(422, "LIVENESS_FAILED", "Enrollment sample failed liveness validation.")
    if result.embedding is None or len(result.embedding) != engine.dimension:
        raise APIError(422, "EMBEDDING_EXTRACTION_FAILED", "Could not extract a face descriptor.")
    if settings.depth_validation_enabled and (
        not depth_available
        or depth_quality_score is None
        or depth_quality_score < settings.depth_min_score
    ):
        raise APIError(422, "DEPTH_VALIDATION_FAILED", "Depth validation is required.")
    sample = FaceEnrollmentSample(
        enrollment_session_id=session.id,
        sample_tag=payload.sample_tag if payload else None,
        embedding=result.embedding,
        pose_type=selected_pose,
        quality_score=result.quality_score,
        liveness_passed=(
            result.liveness_score is not None
            and result.liveness_score >= settings.liveness_min_score
        ),
        depth_available=depth_available,
        depth_quality_score=depth_quality_score,
        storage_reference=None,
    )
    db.add(sample)
    db.commit()
    return {
        "id": sample.id,
        "pose_type": sample.pose_type,
        "quality_score": float(sample.quality_score),
        "liveness_passed": (sample.liveness_passed if settings.liveness_mode != "none" else None),
        "engine": engine.engine_name,
    }


@router.post("/enrollments/sessions/{session_id}/complete")
def complete_enrollment(
    session_id: str,
    request: Request,
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    engine: FaceRecognitionEngine = Depends(face_recognition_engine),
) -> dict[str, Any]:
    session = db.get(EnrollmentSession, session_id)
    if session is None:
        raise not_found("Enrollment session")
    member = get_member_for_user(db, session.member_id, user)
    if session.status != "OPEN" or as_utc(session.expires_at) <= utcnow():
        raise APIError(409, "ENROLLMENT_SESSION_CLOSED", "Enrollment session is closed or expired.")
    consent = db.scalar(
        select(BiometricConsent).where(
            BiometricConsent.member_id == member.id, BiometricConsent.revoked_at.is_(None)
        )
    )
    if consent is None:
        raise APIError(409, "ACTIVE_CONSENT_REQUIRED", "Active biometric consent is required.")
    samples = list(
        db.scalars(
            select(FaceEnrollmentSample).where(
                FaceEnrollmentSample.enrollment_session_id == session.id
            )
        ).all()
    )
    poses = {sample.pose_type for sample in samples}
    if not REQUIRED_ENROLLMENT_POSES.issubset(poses):
        raise APIError(
            422,
            "ENROLLMENT_SAMPLES_INCOMPLETE",
            "Front, left, and right samples are required.",
            {"received_poses": sorted(poses)},
        )
    descriptors: list[list[float]] = []
    for sample in samples:
        descriptor = sample.embedding
        if descriptor is None and settings.face_engine == "mock" and sample.sample_tag:
            descriptor = engine.analyze_enrollment_sample(sample.sample_tag.encode()).embedding
        if descriptor is None or len(descriptor) != engine.dimension:
            raise APIError(
                409,
                "ENROLLMENT_DESCRIPTOR_UNAVAILABLE",
                "An enrollment sample descriptor is unavailable or incompatible.",
            )
        descriptors.append(descriptor)
    for index, left in enumerate(descriptors):
        for right in descriptors[index + 1 :]:
            if cosine_similarity(left, right) < settings.face_enrollment_consistency_threshold:
                raise APIError(
                    422,
                    "INCONSISTENT_ENROLLMENT_SAMPLES",
                    "Enrollment samples do not appear to belong to the same person.",
                )
    embedding = engine.create_profile(descriptors)
    existing_profiles = db.scalars(
        select(FaceProfile)
        .join(Member, Member.id == FaceProfile.member_id)
        .where(
            Member.branch_id == member.branch_id,
            FaceProfile.revoked_at.is_(None),
            FaceProfile.enrollment_status == "ACTIVE",
            FaceProfile.model_name == engine.model_name,
            FaceProfile.model_version == engine.model_version,
            FaceProfile.embedding_dimension == engine.dimension,
        )
    ).all()
    for existing in existing_profiles:
        existing_member = db.get(Member, existing.member_id)
        if (
            existing_member
            and existing.member_id != member.id
            and cosine_similarity(embedding, existing.embedding) >= 0.98
        ):
            raise conflict(
                "DUPLICATE_BIOMETRIC_REVIEW_REQUIRED",
                "A similar profile exists and requires administrator review.",
            )
    now = utcnow()
    for existing in existing_profiles:
        if existing.member_id == member.id:
            existing.revoked_at = now
            existing.revocation_reason = "Re-enrolled"
            existing.enrollment_status = "REVOKED"
            existing.is_primary = False
    profile = FaceProfile(
        member_id=member.id,
        model_name=engine.model_name,
        model_version=engine.model_version,
        embedding_dimension=len(embedding),
        embedding=embedding,
        quality_score=sum(float(sample.quality_score) for sample in samples) / len(samples),
        enrollment_status="ACTIVE",
        is_primary=True,
        created_by=user.id,
    )
    db.add(profile)
    db.flush()
    for sample in samples:
        sample.face_profile_id = profile.id
        sample.embedding = None
    session.status = "COMPLETED"
    record_audit(
        db,
        actor_id=user.id,
        action="FACE_PROFILE_ENROLLED",
        resource_type="face_profile",
        resource_id=profile.id,
        after={
            "member_id": member.id,
            "model_name": profile.model_name,
            "model_version": profile.model_version,
            "sample_count": len(samples),
        },
        correlation_id=correlation_id(request),
    )
    db.commit()
    return {
        "profile_id": profile.id,
        "member_id": member.id,
        "status": profile.enrollment_status,
        "sample_count": len(samples),
        "model": {"name": profile.model_name, "version": profile.model_version},
    }


@router.delete("/members/{member_id}/face-profile", status_code=204)
def revoke_face_profile(
    member_id: str,
    request: Request,
    reason: str = Query(..., min_length=3, max_length=500),
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> Response:
    member = get_member_for_user(db, member_id, user)
    profiles = list(
        db.scalars(
            select(FaceProfile).where(
                FaceProfile.member_id == member.id, FaceProfile.revoked_at.is_(None)
            )
        ).all()
    )
    if not profiles:
        raise not_found("Active face profile")
    now = utcnow()
    for profile in profiles:
        profile.revoked_at = now
        profile.revocation_reason = reason
        profile.enrollment_status = "REVOKED"
    record_audit(
        db,
        actor_id=user.id,
        action="BIOMETRIC_PROFILE_REVOKED",
        resource_type="member",
        resource_id=member.id,
        after={"reason": reason, "profiles_revoked": len(profiles)},
        correlation_id=correlation_id(request),
    )
    db.commit()
    return Response(status_code=204)


@router.get("/members/{member_id}/face-profile/status")
def face_profile_status(
    member_id: str,
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    member = get_member_for_user(db, member_id, user)
    profiles = list(db.scalars(select(FaceProfile).where(FaceProfile.member_id == member.id)).all())
    active = [profile for profile in profiles if profile.revoked_at is None]
    return {
        "member_id": member.id,
        "enrolled": bool(active),
        "active_profile_count": len(active),
        "last_enrolled_at": max((profile.created_at for profile in active), default=None),
        "model": (
            {"name": active[0].model_name, "version": active[0].model_version} if active else None
        ),
    }


@router.post("/live-camera/frames", response_model=LiveCameraFrameResponse)
async def analyze_live_camera_frame(
    request: Request,
    branch_id: str | None = Query(default=None),
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    engine: FaceRecognitionEngine = Depends(face_recognition_engine),
) -> dict[str, Any]:
    selected_branch_id = branch_id or user.branch_id
    if not selected_branch_id:
        raise APIError(422, "BRANCH_REQUIRED", "A branch must be selected for live recognition.")
    ensure_branch_access(user, selected_branch_id)
    branch = db.get(Branch, selected_branch_id)
    if branch is None:
        raise not_found("Branch")
    if not branch.is_active:
        raise APIError(409, "BRANCH_INACTIVE", "The selected branch is inactive.")
    if engine.engine_name != "opencv_sface":
        raise APIError(
            409,
            "LIVE_CAMERA_ENGINE_UNAVAILABLE",
            "Live camera recognition requires the OpenCV SFace engine.",
        )
    rate_limiter.check(
        f"live-camera:{user.id}:{selected_branch_id}",
        settings.live_camera_rate_limit,
        settings.rate_limit_window_seconds,
    )
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "image/jpeg":
        raise APIError(415, "INVALID_IMAGE_TYPE", "A raw image/jpeg body is required.")

    image_bytes = await read_limited_image(request, settings)
    analysis = await run_in_threadpool(engine.analyze_frame, image_bytes)
    if analysis.errors or analysis.image_width is None or analysis.image_height is None:
        raise APIError(
            422,
            analysis.errors[0] if analysis.errors else "INVALID_IMAGE",
            "The camera frame could not be analyzed.",
        )

    overrides = {
        item.key: item.value
        for item in db.scalars(
            select(SystemSetting).where(
                SystemSetting.scope_type == "GLOBAL",
                SystemSetting.scope_id.is_(None),
                SystemSetting.key.in_(["face_match_threshold", "face_min_quality_score"]),
            )
        ).all()
    }
    match_threshold = float(
        overrides.get("face_match_threshold", settings.face_match_threshold)
    )
    quality_threshold = float(
        overrides.get("face_min_quality_score", settings.face_min_quality_score)
    )
    profile_rows = db.execute(
        select(FaceProfile, Member)
        .join(Member, Member.id == FaceProfile.member_id)
        .where(
            Member.branch_id == selected_branch_id,
            Member.deleted_at.is_(None),
            FaceProfile.revoked_at.is_(None),
            FaceProfile.enrollment_status == "ACTIVE",
            FaceProfile.model_name == engine.model_name,
            FaceProfile.model_version == engine.model_version,
            FaceProfile.embedding_dimension == engine.dimension,
        )
    ).all()

    response_faces: list[dict[str, Any]] = []
    for detected in analysis.faces:
        x, y, width, height = detected.bounding_box
        registration = "UNREGISTERED"
        reason_code = detected.errors[0] if detected.errors else None
        matched_member: Member | None = None

        if reason_code is None and (
            detected.quality_score is None or detected.quality_score < quality_threshold
        ):
            reason_code = "LOW_IMAGE_QUALITY"
        if reason_code is None and detected.embedding is None:
            reason_code = "EMBEDDING_EXTRACTION_FAILED"
        if reason_code is None and detected.embedding is not None:
            matches_by_member: dict[str, tuple[float, Member]] = {}
            for profile, member in profile_rows:
                if (
                    not isinstance(profile.embedding, list)
                    or len(profile.embedding) != engine.dimension
                ):
                    continue
                try:
                    stored_embedding = [float(value) for value in profile.embedding]
                except (TypeError, ValueError, OverflowError):
                    continue
                if not all(math.isfinite(value) for value in stored_embedding):
                    continue
                score = cosine_similarity(detected.embedding, stored_embedding)
                current = matches_by_member.get(member.id)
                if current is None or score > current[0]:
                    matches_by_member[member.id] = (score, member)
            matches = sorted(matches_by_member.values(), key=lambda item: item[0], reverse=True)
            if not matches or matches[0][0] < match_threshold:
                reason_code = "IDENTITY_NOT_FOUND"
            elif (
                len(matches) > 1
                and matches[0][0] - matches[1][0] < settings.face_match_ambiguity_margin
            ):
                reason_code = "AMBIGUOUS_FACE_MATCH"
            else:
                registration = "REGISTERED"
                matched_member = matches[0][1]

        response_faces.append(
            {
                "bounding_box": {"x": x, "y": y, "width": width, "height": height},
                "registration": registration,
                "reason_code": reason_code,
                "member": (
                    {
                        "full_name": matched_member.full_name,
                        "member_code": matched_member.member_code,
                    }
                    if matched_member
                    else None
                ),
            }
        )

    return {
        "image_width": analysis.image_width,
        "image_height": analysis.image_height,
        "face_count": len(response_faces),
        "faces": response_faces,
    }


@router.post("/kiosk/sessions", status_code=201)
def create_kiosk_session(
    device: Device = Depends(current_device),
    db: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    engine: FaceRecognitionEngine = Depends(face_recognition_engine),
) -> dict[str, Any]:
    if not device.is_active:
        raise APIError(403, "DEVICE_INACTIVE", "Device is inactive.")
    token, jti = create_kiosk_token(device.id, settings)
    challenge = (
        secrets.choice(["BLINK", "TURN_LEFT", "TURN_RIGHT"])
        if settings.liveness_mode != "none"
        else "NONE"
    )
    session = KioskSession(
        device_id=device.id,
        jti_hash=token_fingerprint(jti),
        challenge=challenge,
        expires_at=utcnow() + timedelta(seconds=30),
    )
    db.add(session)
    db.commit()
    return {
        "session_id": session.id,
        "session_token": token,
        "challenge": challenge,
        "expires_at": session.expires_at,
        "engine": engine.engine_name,
        "liveness_mode": settings.liveness_mode,
        "demo_mode": engine.engine_name == "mock",
    }


@router.post("/kiosk/checkin")
async def kiosk_checkin(
    request: Request,
    x_kiosk_session: str | None = Header(default=None),
    idempotency_key_header: str | None = Header(default=None, alias="Idempotency-Key"),
    device: Device = Depends(current_device),
    db: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
    engine: FaceRecognitionEngine = Depends(face_recognition_engine),
) -> dict[str, Any]:
    rate_limiter.check(
        f"kiosk:{device.id}", settings.kiosk_rate_limit, settings.rate_limit_window_seconds
    )
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if settings.face_engine == "mock":
        if content_type != "application/json":
            raise APIError(
                415,
                "BIOMETRIC_PAYLOAD_MODE_MISMATCH",
                "Mock mode requires the JSON sample_tag payload.",
            )
        try:
            payload = KioskCheckinRequest.model_validate(await request.json())
        except (ValidationError, ValueError) as exc:
            raise APIError(422, "VALIDATION_ERROR", "Request validation failed.") from exc
        session_token = payload.session_token
        idempotency_key = payload.idempotency_key
        image_bytes = payload.sample_tag.encode()
    else:
        if content_type not in IMAGE_CONTENT_TYPES:
            raise APIError(
                415,
                "BIOMETRIC_PAYLOAD_MODE_MISMATCH",
                "OpenCV mode requires a raw image/jpeg or image/png body.",
            )
        if not x_kiosk_session:
            raise APIError(422, "KIOSK_SESSION_REQUIRED", "X-Kiosk-Session is required.")
        if not idempotency_key_header or not 8 <= len(idempotency_key_header) <= 100:
            raise APIError(
                422,
                "IDEMPOTENCY_KEY_REQUIRED",
                "Idempotency-Key must contain between 8 and 100 characters.",
            )
        session_token = x_kiosk_session
        idempotency_key = idempotency_key_header
        image_bytes = await read_limited_image(request, settings)

    decoded = decode_token(session_token, "kiosk_challenge", settings)
    if decoded["sub"] != device.id:
        raise APIError(401, "INVALID_KIOSK_SESSION", "Kiosk session belongs to another device.")
    kiosk_session = db.scalar(
        select(KioskSession).where(KioskSession.jti_hash == token_fingerprint(decoded["jti"]))
    )
    if (
        kiosk_session is None
        or kiosk_session.used_at is not None
        or as_utc(kiosk_session.expires_at) <= utcnow()
    ):
        raise APIError(409, "KIOSK_SESSION_INVALID", "Kiosk session is expired or already used.")
    kiosk_session.used_at = utcnow()
    outcome = CheckinStateMachine(db, settings, device, correlation_id(request), engine=engine).run(
        image_bytes, idempotency_key
    )
    db.commit()
    return kiosk_response(outcome, settings)


@router.get("/kiosk/checkin/{attempt_id}")
def get_kiosk_checkin(
    attempt_id: str,
    device: Device = Depends(current_device),
    db: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
) -> dict[str, Any]:
    attempt = db.get(CheckinAttempt, attempt_id)
    if attempt is None or attempt.device_id != device.id:
        raise not_found("Check-in attempt")
    outcome = CheckinOutcome(
        attempt,
        db.get(Member, attempt.member_id) if attempt.member_id else None,
        db.get(Membership, attempt.membership_id) if attempt.membership_id else None,
    )
    return kiosk_response(outcome, settings)


@router.post("/kiosk/heartbeat")
def kiosk_heartbeat(
    payload: HeartbeatRequest,
    device: Device = Depends(current_device),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    device.last_seen_at = utcnow()
    capabilities = dict(device.capabilities or {})
    if payload.software_version:
        capabilities["software_version"] = payload.software_version
    if payload.camera_status:
        capabilities["camera_status"] = payload.camera_status
    capabilities["last_health"] = payload.health
    device.capabilities = capabilities
    db.commit()
    return {"status": "ok", "server_time": utcnow(), "device_id": device.id}


@router.get("/checkins")
def list_checkins(
    decision: str | None = None,
    reason_code: str | None = None,
    member_id: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    query = select(CheckinAttempt)
    if user.role != Role.SUPER_ADMIN:
        query = query.where(CheckinAttempt.branch_id == user.branch_id)
    if decision:
        query = query.where(CheckinAttempt.decision == decision)
    if reason_code:
        query = query.where(CheckinAttempt.reason_code == reason_code)
    if member_id:
        query = query.where(CheckinAttempt.member_id == member_id)
    if start_at:
        query = query.where(CheckinAttempt.attempted_at >= as_utc(start_at))
    if end_at:
        query = query.where(CheckinAttempt.attempted_at < as_utc(end_at))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = db.scalars(
        query.order_by(desc(CheckinAttempt.attempted_at)).limit(limit).offset(offset)
    ).all()
    return {"items": [checkin_data(item, db) for item in items], "total": total}


@router.get("/checkins/{attempt_id}")
def get_checkin(
    attempt_id: str,
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    attempt = db.get(CheckinAttempt, attempt_id)
    if attempt is None:
        raise not_found("Check-in attempt")
    ensure_branch_access(user, attempt.branch_id)
    return checkin_data(attempt, db)


@router.get("/members/{member_id}/checkins")
def member_checkins(
    member_id: str,
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    member = get_member_for_user(db, member_id, user)
    items = db.scalars(
        select(CheckinAttempt)
        .where(CheckinAttempt.member_id == member.id)
        .order_by(desc(CheckinAttempt.attempted_at))
        .limit(200)
    ).all()
    return {"items": [checkin_data(item, db) for item in items], "total": len(items)}


@router.post("/checkins/{attempt_id}/manual-override", status_code=201)
def manual_override(
    attempt_id: str,
    payload: ManualOverrideRequest,
    request: Request,
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    original = db.get(CheckinAttempt, attempt_id)
    if original is None:
        raise not_found("Check-in attempt")
    ensure_branch_access(user, original.branch_id)
    if original.decision != Decision.DENY:
        raise conflict("OVERRIDE_NOT_REQUIRED", "Only a denied attempt can be manually overridden.")
    member = get_member_for_user(db, payload.member_id, user)
    if member.branch_id != original.branch_id:
        raise forbidden("Member and attempt must belong to the same branch.")
    override = CheckinAttempt(
        branch_id=original.branch_id,
        device_id=original.device_id,
        member_id=member.id,
        decision=Decision.ALLOW,
        reason_code="MANUAL_OVERRIDE",
        processing_time_ms=1,
        manual_override=True,
        operator_user_id=user.id,
        correlation_id=correlation_id(request),
        metadata_json={"original_attempt_id": original.id, "operator_reason": payload.reason},
    )
    db.add(override)
    db.flush()
    db.add(
        AccessEvent(
            checkin_attempt_id=override.id,
            event_type="MANUAL_OVERRIDE",
            door_action="UNLOCK",
            door_result="MOCK_SUCCESS",
            metadata_json={"original_attempt_id": original.id},
        )
    )
    record_audit(
        db,
        actor_id=user.id,
        action="CHECKIN_MANUAL_OVERRIDE",
        resource_type="checkin_attempt",
        resource_id=override.id,
        before={"original_attempt_id": original.id, "reason_code": original.reason_code},
        after={"member_id": member.id, "reason": payload.reason},
        correlation_id=correlation_id(request),
        **client_context(request),
    )
    db.commit()
    return checkin_data(override, db)


@router.get("/devices")
def list_devices(
    user: User = Depends(require_roles(*ADMIN_ROLES)), db: Session = Depends(get_db)
) -> dict[str, Any]:
    query = select(Device)
    if user.role != Role.SUPER_ADMIN:
        query = query.where(Device.branch_id == user.branch_id)
    items = db.scalars(query.order_by(Device.name)).all()
    return {"items": [device_data(item) for item in items], "total": len(items)}


@router.post("/devices", status_code=201)
def create_device(
    payload: DeviceCreate,
    request: Request,
    user: User = Depends(require_roles(*ADMIN_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    branch_id = payload.branch_id or user.branch_id
    if not branch_id:
        raise APIError(422, "BRANCH_REQUIRED", "branch_id is required.")
    ensure_branch_access(user, branch_id)
    if db.get(Branch, branch_id) is None:
        raise not_found("Branch")
    secret = new_device_secret()
    device = Device(
        branch_id=branch_id,
        credential_hash=credential_hash(secret),
        **payload.model_dump(exclude={"branch_id"}),
    )
    db.add(device)
    try:
        db.flush()
    except IntegrityError as exc:
        raise conflict("DEVICE_CODE_EXISTS", "Device code already exists.") from exc
    record_audit(
        db,
        actor_id=user.id,
        action="DEVICE_CREATED",
        resource_type="device",
        resource_id=device.id,
        after=device_data(device),
        correlation_id=correlation_id(request),
    )
    db.commit()
    return {**device_data(device), "credential": secret}


@router.get("/devices/{device_id}")
def get_device(
    device_id: str,
    user: User = Depends(require_roles(*ADMIN_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    device = db.get(Device, device_id)
    if device is None:
        raise not_found("Device")
    ensure_branch_access(user, device.branch_id)
    return device_data(device)


@router.patch("/devices/{device_id}")
def update_device(
    device_id: str,
    payload: DeviceUpdate,
    request: Request,
    user: User = Depends(require_roles(*ADMIN_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    device = db.get(Device, device_id)
    if device is None:
        raise not_found("Device")
    ensure_branch_access(user, device.branch_id)
    before = device_data(device)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(device, key, value)
    record_audit(
        db,
        actor_id=user.id,
        action="DEVICE_UPDATED",
        resource_type="device",
        resource_id=device.id,
        before=before,
        after=payload.model_dump(exclude_unset=True),
        correlation_id=correlation_id(request),
    )
    db.commit()
    return device_data(device)


@router.post("/devices/{device_id}/rotate-credential")
def rotate_device_credential(
    device_id: str,
    request: Request,
    user: User = Depends(require_roles(*ADMIN_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    device = db.get(Device, device_id)
    if device is None:
        raise not_found("Device")
    ensure_branch_access(user, device.branch_id)
    secret = new_device_secret()
    device.credential_hash = credential_hash(secret)
    record_audit(
        db,
        actor_id=user.id,
        action="DEVICE_CREDENTIAL_ROTATED",
        resource_type="device",
        resource_id=device.id,
        correlation_id=correlation_id(request),
    )
    db.commit()
    return {"device_id": device.id, "credential": secret}


def _report_query(
    user: User,
    start_at: datetime | None,
    end_at: datetime | None,
):
    query = select(CheckinAttempt)
    if user.role != Role.SUPER_ADMIN:
        query = query.where(CheckinAttempt.branch_id == user.branch_id)
    if start_at:
        query = query.where(CheckinAttempt.attempted_at >= as_utc(start_at))
    if end_at:
        query = query.where(CheckinAttempt.attempted_at < as_utc(end_at))
    return query


def _safe_csv_cell(value: Any) -> str:
    text = "" if value is None else str(value)
    if text and (text[0] in "=+-@" or text[0] in "\t\r\n"):
        return "'" + text
    return text


@router.get("/reports/attendance")
def attendance_report(
    request: Request,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    export: str | None = Query(default=None, pattern="^(csv)?$"),
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
):
    query = _report_query(user, start_at, end_at).where(CheckinAttempt.decision == Decision.ALLOW)
    attempts = list(db.scalars(query.order_by(desc(CheckinAttempt.attempted_at))).all())
    if export == "csv":
        output = io.StringIO(newline="")
        writer = csv.writer(output)
        writer.writerow(
            [
                "attempt_id",
                "attempted_at",
                "member_code",
                "member_name",
                "decision",
                "manual_override",
            ]
        )
        for attempt in attempts:
            member = db.get(Member, attempt.member_id) if attempt.member_id else None
            writer.writerow(
                [
                    _safe_csv_cell(attempt.id),
                    _safe_csv_cell(attempt.attempted_at.isoformat()),
                    _safe_csv_cell(member.member_code if member else ""),
                    _safe_csv_cell(member.full_name if member else ""),
                    _safe_csv_cell(attempt.decision.value),
                    _safe_csv_cell(attempt.manual_override),
                ]
            )
        record_audit(
            db,
            actor_id=user.id,
            action="REPORT_EXPORTED",
            resource_type="attendance_report",
            correlation_id=correlation_id(request),
            after={"format": "csv", "rows": len(attempts)},
        )
        db.commit()
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=attendance.csv"},
        )
    return {
        "items": [checkin_data(item, db) for item in attempts],
        "summary": {"allowed": len(attempts)},
        "total": len(attempts),
    }


@router.get("/reports/denials")
def denial_report(
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    base = _report_query(user, start_at, end_at).where(CheckinAttempt.decision == Decision.DENY)
    attempts = list(db.scalars(base.order_by(desc(CheckinAttempt.attempted_at))).all())
    counts: dict[str, int] = {}
    for attempt in attempts:
        counts[attempt.reason_code] = counts.get(attempt.reason_code, 0) + 1
    return {
        "items": [checkin_data(item, db) for item in attempts],
        "by_reason": [
            {"reason_code": key, "count": value} for key, value in sorted(counts.items())
        ],
        "total": len(attempts),
    }


@router.get("/reports/expiring-memberships")
def expiring_memberships_report(
    days: int = Query(7, ge=1, le=365),
    user: User = Depends(require_roles(*STAFF_ROLES)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    now = utcnow()
    query = (
        select(Membership)
        .join(Member, Member.id == Membership.member_id)
        .where(
            Membership.status == MembershipStatus.ACTIVE,
            Membership.end_at >= now,
            Membership.end_at < now + timedelta(days=days),
            Member.deleted_at.is_(None),
        )
    )
    if user.role != Role.SUPER_ADMIN:
        query = query.where(Member.branch_id == user.branch_id)
    items = list(db.scalars(query.order_by(Membership.end_at)).all())
    return {"items": [membership_data(item) for item in items], "total": len(items), "days": days}


@router.get("/reports/device-health")
def device_health_report(
    user: User = Depends(require_roles(*ADMIN_ROLES)), db: Session = Depends(get_db)
) -> dict[str, Any]:
    query = select(Device)
    if user.role != Role.SUPER_ADMIN:
        query = query.where(Device.branch_id == user.branch_id)
    now = utcnow()
    items = []
    for device in db.scalars(query.order_by(Device.name)):
        age = (now - as_utc(device.last_seen_at)).total_seconds() if device.last_seen_at else None
        items.append(
            {
                **device_data(device),
                "online": bool(device.is_active and age is not None and age <= 120),
                "heartbeat_age_seconds": round(age) if age is not None else None,
            }
        )
    return {"items": items, "total": len(items)}


@router.get("/dashboard/summary")
def dashboard_summary(
    user: User = Depends(require_roles(*STAFF_ROLES)), db: Session = Depends(get_db)
) -> dict[str, int]:
    now = utcnow()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    member_filters = [Member.deleted_at.is_(None)]
    attempt_filters = [CheckinAttempt.attempted_at >= today]
    device_filters = []
    if user.role != Role.SUPER_ADMIN:
        member_filters.append(Member.branch_id == user.branch_id)
        attempt_filters.append(CheckinAttempt.branch_id == user.branch_id)
        device_filters.append(Device.branch_id == user.branch_id)
    active_members = (
        db.scalar(
            select(func.count())
            .select_from(Member)
            .where(*member_filters, Member.status == "ACTIVE")
        )
        or 0
    )
    allowed = (
        db.scalar(
            select(func.count())
            .select_from(CheckinAttempt)
            .where(*attempt_filters, CheckinAttempt.decision == Decision.ALLOW)
        )
        or 0
    )
    denied = (
        db.scalar(
            select(func.count())
            .select_from(CheckinAttempt)
            .where(*attempt_filters, CheckinAttempt.decision == Decision.DENY)
        )
        or 0
    )
    devices_online = (
        db.scalar(
            select(func.count())
            .select_from(Device)
            .where(
                *device_filters,
                Device.is_active.is_(True),
                Device.last_seen_at >= now - timedelta(minutes=2),
            )
        )
        or 0
    )
    return {
        "active_members": active_members,
        "today_allowed_checkins": allowed,
        "today_denied_attempts": denied,
        "devices_online": devices_online,
    }


SETTING_DEFAULTS = {
    "face_match_threshold": "face_match_threshold",
    "face_min_quality_score": "face_min_quality_score",
    "liveness_min_score": "liveness_min_score",
    "depth_validation_enabled": "depth_validation_enabled",
    "depth_min_score": "depth_min_score",
    "checkin_cooldown_seconds": "checkin_cooldown_seconds",
    "raw_capture_retention_hours": "raw_capture_retention_hours",
    "privacy_notice_version": None,
}


@router.get("/settings")
def list_settings(
    user: User = Depends(require_roles(*ADMIN_ROLES)),
    db: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
) -> dict[str, Any]:
    stored = {item.key: item.value for item in db.scalars(select(SystemSetting)).all()}
    items = []
    for key, attribute in SETTING_DEFAULTS.items():
        default = getattr(settings, attribute) if attribute else "v1"
        items.append({"key": key, "value": stored.get(key, default), "scope_type": "GLOBAL"})
    return {"items": items, "total": len(items)}


@router.patch("/settings/{key}")
def update_setting(
    key: str,
    payload: SettingUpdate,
    request: Request,
    user: User = Depends(require_roles(Role.SUPER_ADMIN)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if key not in SETTING_DEFAULTS:
        raise APIError(400, "SETTING_NOT_EDITABLE", "This setting is not editable through the API.")
    if key.endswith("score") or key.endswith("threshold"):
        if isinstance(payload.value, bool) or not isinstance(payload.value, (int, float)):
            raise APIError(422, "INVALID_SETTING_VALUE", "Threshold must be numeric.")
        if not 0 <= float(payload.value) <= 1:
            raise APIError(422, "INVALID_SETTING_VALUE", "Threshold must be between 0 and 1.")
        if key == "face_match_threshold" and float(payload.value) <= 0:
            raise APIError(
                422,
                "INVALID_SETTING_VALUE",
                "Face match threshold must be greater than zero.",
            )
    setting = db.scalar(
        select(SystemSetting).where(
            SystemSetting.scope_type == "GLOBAL",
            SystemSetting.scope_id.is_(None),
            SystemSetting.key == key,
        )
    )
    before = setting.value if setting else None
    if setting is None:
        setting = SystemSetting(
            scope_type="GLOBAL", scope_id=None, key=key, value=payload.value, updated_by=user.id
        )
        db.add(setting)
    else:
        setting.value = payload.value
        setting.updated_by = user.id
    record_audit(
        db,
        actor_id=user.id,
        action="SYSTEM_SETTING_UPDATED",
        resource_type="system_setting",
        resource_id=setting.id,
        before={"value": before},
        after={"key": key, "value": payload.value},
        correlation_id=correlation_id(request),
    )
    db.commit()
    return {"key": key, "value": setting.value, "scope_type": "GLOBAL"}


@router.get("/audit-logs")
def list_audit_logs(
    action: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(require_roles(Role.SUPER_ADMIN)),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    query = select(AuditLog)
    if action:
        query = query.where(AuditLog.action == action)
    items = list(db.scalars(query.order_by(desc(AuditLog.created_at)).limit(limit)).all())
    return {
        "items": [
            {
                "id": item.id,
                "actor_type": item.actor_type,
                "actor_id": item.actor_id,
                "action": item.action,
                "resource_type": item.resource_type,
                "resource_id": item.resource_id,
                "before_data": item.before_data,
                "after_data": item.after_data,
                "correlation_id": item.correlation_id,
                "created_at": item.created_at,
            }
            for item in items
        ],
        "total": len(items),
    }
