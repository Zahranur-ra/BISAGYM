from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, new_uuid, utcnow


class Role(StrEnum):
    SUPER_ADMIN = "SUPER_ADMIN"
    GYM_ADMIN = "GYM_ADMIN"
    RECEPTIONIST = "RECEPTIONIST"


class MemberStatus(StrEnum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    SUSPENDED = "SUSPENDED"


class MembershipStatus(StrEnum):
    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    EXPIRED = "EXPIRED"
    SUSPENDED = "SUSPENDED"
    CANCELLED = "CANCELLED"


class Decision(StrEnum):
    ALLOW = "ALLOW"
    DENY = "DENY"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Branch(Base, TimestampMixin):
    __tablename__ = "branches"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(Text)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Jakarta")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class User(Base, TimestampMixin):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role, native_enum=False))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Member(Base, TimestampMixin):
    __tablename__ = "members"
    __table_args__ = (UniqueConstraint("branch_id", "member_code"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    branch_id: Mapped[str] = mapped_column(ForeignKey("branches.id"), index=True)
    member_code: Mapped[str] = mapped_column(String(50), index=True)
    full_name: Mapped[str] = mapped_column(String(200), index=True)
    email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(40))
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    gender: Mapped[str | None] = mapped_column(String(30))
    address: Mapped[str | None] = mapped_column(Text)
    photo_url: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[MemberStatus] = mapped_column(
        Enum(MemberStatus, native_enum=False), default=MemberStatus.ACTIVE
    )
    emergency_contact_name: Mapped[str | None] = mapped_column(String(200))
    emergency_contact_phone: Mapped[str | None] = mapped_column(String(40))
    notes: Mapped[str | None] = mapped_column(Text)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


class MembershipPlan(Base, TimestampMixin):
    __tablename__ = "membership_plans"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), index=True)
    name: Mapped[str] = mapped_column(String(150))
    duration_days: Mapped[int] = mapped_column(Integer)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Membership(Base, TimestampMixin):
    __tablename__ = "memberships"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id"), index=True)
    plan_id: Mapped[str] = mapped_column(ForeignKey("membership_plans.id"))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[MembershipStatus] = mapped_column(
        Enum(MembershipStatus, native_enum=False), default=MembershipStatus.ACTIVE
    )
    price_paid: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    payment_reference: Mapped[str | None] = mapped_column(String(200))
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    suspension_reason: Mapped[str | None] = mapped_column(Text)


class BiometricConsent(Base):
    __tablename__ = "biometric_consents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id"), index=True)
    consent_version: Mapped[str] = mapped_column(String(50))
    consented_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    capture_purpose: Mapped[str] = mapped_column(String(255))
    retention_policy: Mapped[str] = mapped_column(String(255))
    operator_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    signature_reference: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FaceProfile(Base):
    __tablename__ = "face_profiles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id"), index=True)
    model_name: Mapped[str] = mapped_column(String(150))
    model_version: Mapped[str] = mapped_column(String(50))
    embedding_dimension: Mapped[int] = mapped_column(Integer)
    embedding: Mapped[list[float]] = mapped_column(JSON)
    quality_score: Mapped[float] = mapped_column(Numeric(5, 4))
    enrollment_status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    is_primary: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revocation_reason: Mapped[str | None] = mapped_column(Text)


class EnrollmentSession(Base):
    __tablename__ = "enrollment_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    member_id: Mapped[str] = mapped_column(ForeignKey("members.id"), index=True)
    operator_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(30), default="OPEN")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FaceEnrollmentSample(Base):
    __tablename__ = "face_enrollment_samples"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    face_profile_id: Mapped[str | None] = mapped_column(ForeignKey("face_profiles.id"), index=True)
    enrollment_session_id: Mapped[str | None] = mapped_column(
        ForeignKey("enrollment_sessions.id"), index=True
    )
    sample_tag: Mapped[str | None] = mapped_column(String(255), nullable=True)
    embedding: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)
    pose_type: Mapped[str] = mapped_column(String(30))
    quality_score: Mapped[float] = mapped_column(Numeric(5, 4))
    liveness_passed: Mapped[bool] = mapped_column(Boolean)
    depth_available: Mapped[bool] = mapped_column(Boolean, default=False)
    depth_quality_score: Mapped[float | None] = mapped_column(Numeric(5, 4))
    storage_reference: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    purge_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Device(Base, TimestampMixin):
    __tablename__ = "devices"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    branch_id: Mapped[str] = mapped_column(ForeignKey("branches.id"), index=True)
    device_code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    device_type: Mapped[str] = mapped_column(String(50), default="KIOSK")
    credential_hash: Mapped[str] = mapped_column(String(64))
    public_key: Mapped[str | None] = mapped_column(Text)
    capabilities: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CheckinAttempt(Base):
    __tablename__ = "checkin_attempts"
    __table_args__ = (Index("ix_checkin_member_attempted", "member_id", "attempted_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    branch_id: Mapped[str] = mapped_column(ForeignKey("branches.id"), index=True)
    device_id: Mapped[str | None] = mapped_column(ForeignKey("devices.id"), index=True)
    member_id: Mapped[str | None] = mapped_column(ForeignKey("members.id"), index=True)
    attempted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    decision: Mapped[Decision] = mapped_column(Enum(Decision, native_enum=False))
    reason_code: Mapped[str] = mapped_column(String(50), index=True)
    match_score: Mapped[float | None] = mapped_column(Numeric(5, 4))
    match_threshold: Mapped[float | None] = mapped_column(Numeric(5, 4))
    quality_score: Mapped[float | None] = mapped_column(Numeric(5, 4))
    liveness_score: Mapped[float | None] = mapped_column(Numeric(5, 4))
    depth_score: Mapped[float | None] = mapped_column(Numeric(5, 4))
    membership_id: Mapped[str | None] = mapped_column(ForeignKey("memberships.id"))
    processing_time_ms: Mapped[int] = mapped_column(Integer)
    manual_override: Mapped[bool] = mapped_column(Boolean, default=False)
    operator_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    correlation_id: Mapped[str] = mapped_column(String(36), index=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(100), unique=True, index=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AccessEvent(Base):
    __tablename__ = "access_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    checkin_attempt_id: Mapped[str] = mapped_column(ForeignKey("checkin_attempts.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(50))
    door_action: Mapped[str] = mapped_column(String(50), default="NONE")
    door_result: Mapped[str] = mapped_column(String(50), default="NOT_CONFIGURED")
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    actor_type: Mapped[str] = mapped_column(String(30))
    actor_id: Mapped[str | None] = mapped_column(String(36), index=True)
    action: Mapped[str] = mapped_column(String(100), index=True)
    resource_type: Mapped[str] = mapped_column(String(100))
    resource_id: Mapped[str | None] = mapped_column(String(36), index=True)
    before_data: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    after_data: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(500))
    correlation_id: Mapped[str] = mapped_column(String(36), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SystemSetting(Base):
    __tablename__ = "system_settings"
    __table_args__ = (UniqueConstraint("scope_type", "scope_id", "key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    scope_type: Mapped[str] = mapped_column(String(30), default="GLOBAL")
    scope_id: Mapped[str | None] = mapped_column(String(36))
    key: Mapped[str] = mapped_column(String(100))
    value: Mapped[Any] = mapped_column(JSON)
    updated_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    jti_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class KioskSession(Base):
    __tablename__ = "kiosk_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"), index=True)
    jti_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    challenge: Mapped[str] = mapped_column(String(30))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
