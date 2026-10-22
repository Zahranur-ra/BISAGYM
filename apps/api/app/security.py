import hashlib
import hmac
import secrets
from datetime import timedelta

import jwt
from pwdlib import PasswordHash

from app.config import Settings
from app.database import utcnow
from app.errors import APIError

password_hasher = PasswordHash.recommended()
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return password_hasher.verify(password, password_hash)


def _token(
    user_id: str, token_type: str, lifetime: timedelta, settings: Settings
) -> tuple[str, str]:
    now = utcnow()
    jti = secrets.token_urlsafe(24)
    payload = {
        "sub": user_id,
        "type": token_type,
        "jti": jti,
        "iat": now,
        "exp": now + lifetime,
        "iss": settings.app_name,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM), jti


def create_access_token(user_id: str, settings: Settings) -> str:
    return _token(
        user_id, "access", timedelta(minutes=settings.access_token_expire_minutes), settings
    )[0]


def create_refresh_token(user_id: str, settings: Settings) -> tuple[str, str]:
    return _token(user_id, "refresh", timedelta(days=settings.refresh_token_expire_days), settings)


def create_kiosk_token(device_id: str, settings: Settings) -> tuple[str, str]:
    return _token(device_id, "kiosk_challenge", timedelta(seconds=30), settings)


def decode_token(token: str, expected_type: str, settings: Settings) -> dict:
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[ALGORITHM],
            issuer=settings.app_name,
            options={"require": ["exp", "sub", "type", "jti"]},
        )
    except jwt.PyJWTError as exc:
        raise APIError(401, "INVALID_TOKEN", "Authentication token is invalid or expired.") from exc
    if payload["type"] != expected_type:
        raise APIError(401, "INVALID_TOKEN", "Authentication token type is invalid.")
    return payload


def token_fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def credential_hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def credential_matches(secret: str, expected_hash: str) -> bool:
    return hmac.compare_digest(credential_hash(secret), expected_hash)


def new_device_secret() -> str:
    return secrets.token_urlsafe(32)
