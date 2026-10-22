from collections.abc import Callable

from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.biometrics import FaceRecognitionEngine
from app.config import Settings
from app.database import get_db
from app.errors import APIError, forbidden
from app.models import Device, Role, User
from app.security import credential_matches, decode_token

bearer = HTTPBearer(auto_error=False)


def app_settings(request: Request) -> Settings:
    return request.app.state.settings


def face_recognition_engine(request: Request) -> FaceRecognitionEngine:
    engine = getattr(request.app.state, "face_engine", None)
    if engine is None:
        health = getattr(request.app.state, "face_engine_health", {})
        raise APIError(
            503,
            "FACE_ENGINE_UNAVAILABLE",
            "The configured face recognition engine is unavailable.",
            {"reason": health.get("error", "Face engine did not initialize.")},
        )
    return engine


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
    settings: Settings = Depends(app_settings),
) -> User:
    if credentials is None:
        raise APIError(401, "NOT_AUTHENTICATED", "Authentication is required.")
    payload = decode_token(credentials.credentials, "access", settings)
    user = db.get(User, payload["sub"])
    if user is None or not user.is_active:
        raise APIError(401, "NOT_AUTHENTICATED", "User is inactive or unavailable.")
    return user


def require_roles(*roles: Role) -> Callable:
    def dependency(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise forbidden()
        return user

    return dependency


def current_device(
    x_device_code: str | None = Header(default=None),
    x_device_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Device:
    if not x_device_code or not x_device_token:
        raise APIError(401, "DEVICE_AUTH_REQUIRED", "Device credentials are required.")
    device = db.scalar(select(Device).where(Device.device_code == x_device_code))
    if device is None or not credential_matches(x_device_token, device.credential_hash):
        raise APIError(401, "INVALID_DEVICE_CREDENTIAL", "Device credentials are invalid.")
    return device


def ensure_branch_access(user: User, branch_id: str) -> None:
    if user.role != Role.SUPER_ADMIN and user.branch_id != branch_id:
        raise forbidden("You cannot access another branch.")
