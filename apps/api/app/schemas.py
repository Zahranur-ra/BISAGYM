from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import MemberStatus, Role


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, str_strip_whitespace=True)


class LoginRequest(APIModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=256)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        if "@" not in value:
            raise ValueError("invalid email address")
        return value.lower()


class RefreshRequest(APIModel):
    refresh_token: str


class LogoutRequest(APIModel):
    refresh_token: str | None = None


class ChangePasswordRequest(APIModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=256)


class BranchCreate(APIModel):
    code: str = Field(min_length=2, max_length=50)
    name: str = Field(min_length=2, max_length=200)
    address: str | None = None
    timezone: str = "Asia/Jakarta"
    is_active: bool = True


class UserCreate(APIModel):
    branch_id: str | None = None
    full_name: str = Field(min_length=2, max_length=200)
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=10, max_length=256)
    role: Role

    @field_validator("email")
    @classmethod
    def user_email(cls, value: str) -> str:
        if "@" not in value:
            raise ValueError("invalid email address")
        return value.lower()


class MemberCreate(APIModel):
    branch_id: str | None = None
    member_code: str | None = Field(default=None, min_length=1, max_length=50)
    full_name: str = Field(min_length=2, max_length=200)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=40)
    date_of_birth: date | None = None
    gender: str | None = Field(default=None, max_length=30)
    address: str | None = None
    status: MemberStatus = MemberStatus.ACTIVE
    emergency_contact_name: str | None = Field(default=None, max_length=200)
    emergency_contact_phone: str | None = Field(default=None, max_length=40)
    notes: str | None = None


class MemberUpdate(APIModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=40)
    date_of_birth: date | None = None
    gender: str | None = Field(default=None, max_length=30)
    address: str | None = None
    status: MemberStatus | None = None
    emergency_contact_name: str | None = Field(default=None, max_length=200)
    emergency_contact_phone: str | None = Field(default=None, max_length=40)
    notes: str | None = None


class PlanCreate(APIModel):
    branch_id: str | None = None
    name: str = Field(min_length=2, max_length=150)
    duration_days: int = Field(gt=0, le=3650)
    price: Decimal = Field(default=0, ge=0)
    description: str | None = None
    is_active: bool = True


class PlanUpdate(APIModel):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    duration_days: int | None = Field(default=None, gt=0, le=3650)
    price: Decimal | None = Field(default=None, ge=0)
    description: str | None = None
    is_active: bool | None = None


class MembershipCreate(APIModel):
    plan_id: str
    start_at: datetime
    end_at: datetime | None = None
    price_paid: Decimal = Field(default=0, ge=0)
    payment_reference: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def valid_period(self) -> "MembershipCreate":
        if self.end_at is not None and self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class MembershipUpdate(APIModel):
    start_at: datetime | None = None
    end_at: datetime | None = None
    price_paid: Decimal | None = Field(default=None, ge=0)
    payment_reference: str | None = Field(default=None, max_length=200)


class SuspendRequest(APIModel):
    reason: str = Field(min_length=3, max_length=500)


class ConsentCreate(APIModel):
    consent_version: str = Field(min_length=1, max_length=50)
    capture_purpose: str = Field(min_length=3, max_length=255)
    retention_policy: str = Field(min_length=3, max_length=255)
    signature_reference: str | None = Field(default=None, max_length=500)


class RevokeRequest(APIModel):
    reason: str = Field(min_length=3, max_length=500)


class EnrollmentSessionCreate(APIModel):
    member_id: str


class EnrollmentSampleCreate(APIModel):
    sample_tag: str = Field(min_length=1, max_length=255)
    pose_type: str = Field(pattern="^(FRONT|LEFT|RIGHT|UP|DOWN)$")
    depth_available: bool = False
    depth_quality_score: float | None = Field(default=None, ge=0, le=1)


class KioskCheckinRequest(APIModel):
    session_token: str
    sample_tag: str = Field(min_length=1, max_length=255)
    idempotency_key: str = Field(min_length=8, max_length=100)


class HeartbeatRequest(APIModel):
    software_version: str | None = Field(default=None, max_length=50)
    camera_status: str | None = Field(default=None, max_length=50)
    health: dict[str, Any] = Field(default_factory=dict)


class ManualOverrideRequest(APIModel):
    member_id: str
    reason: str = Field(min_length=3, max_length=500)


class DeviceCreate(APIModel):
    branch_id: str | None = None
    device_code: str = Field(min_length=3, max_length=80)
    name: str = Field(min_length=2, max_length=200)
    device_type: str = Field(default="KIOSK", max_length=50)
    capabilities: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True


class DeviceUpdate(APIModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    capabilities: dict[str, Any] | None = None
    is_active: bool | None = None


class SettingUpdate(APIModel):
    value: bool | int | float | str


class RecognitionResult(APIModel):
    detected_face_count: int
    quality_score: float | None
    liveness_score: float | None
    depth_score: float | None = None
    embedding: list[float] | None
    matched_profile_id: str | None = None
    match_score: float | None = None
    errors: list[str] = Field(default_factory=list)
    confidence_cap: float | None = None


class FaceBoundingBox(APIModel):
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    width: int = Field(ge=0)
    height: int = Field(ge=0)


class LiveCameraMember(APIModel):
    full_name: str
    member_code: str


class LiveCameraFace(APIModel):
    bounding_box: FaceBoundingBox
    registration: Literal["REGISTERED", "UNREGISTERED"]
    reason_code: str | None = None
    member: LiveCameraMember | None = None


class LiveCameraFrameResponse(APIModel):
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)
    face_count: int = Field(ge=0)
    faces: list[LiveCameraFace]
