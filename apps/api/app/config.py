from functools import lru_cache
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore"
    )

    app_env: Literal["development", "test", "production"] = "development"
    app_name: str = "Gym Face Access"
    app_timezone: str = "Asia/Jakarta"
    secret_key: str = "development-only-change-me"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    database_url: str = "sqlite:///./bisagym.db"
    auto_create_db: bool = True
    cors_origins: list[str] | str = ["http://localhost:5173"]

    face_engine: Literal["mock", "opencv_sface"] = "opencv_sface"
    face_model_name: str = "opencv_sface"
    face_model_version: str = "2021dec"
    face_detection_model_path: str = "runtime-models/face_detection_yunet_2023mar.onnx"
    face_recognition_model_path: str = "runtime-models/face_recognition_sface_2021dec.onnx"
    face_detection_model_sha256: str = (
        "8F2383E4DD3CFBB4553EA8718107FC0423210DC964F9F4280604804ED2552FA4"
    )
    face_recognition_model_sha256: str = (
        "0BA9FBFA01B5270C96627C4EF784DA859931E02F04419C829E83484087C34E79"
    )
    face_match_threshold: float = 0.50
    face_match_ambiguity_margin: float = 0.05
    face_enrollment_consistency_threshold: float = 0.45
    face_min_quality_score: float = 0.70
    face_max_image_width: int = 4096
    face_max_image_height: int = 4096
    face_max_image_pixels: int = 12_000_000
    face_min_size_pixels: int = 80
    face_min_size_ratio: float = 0.10
    face_blur_threshold: float = 80.0
    face_min_exposure: float = 45.0
    face_max_exposure: float = 210.0
    face_max_clipped_fraction: float = 0.30
    yunet_score_threshold: float = 0.90
    yunet_nms_threshold: float = 0.30
    yunet_top_k: int = 5000
    liveness_mode: Literal["none", "active_challenge"] = "none"
    liveness_min_score: float = 0.70
    depth_validation_enabled: bool = False
    depth_min_score: float = 0.70
    checkin_cooldown_seconds: int = 60
    kiosk_result_cooldown_seconds: int = 3
    raw_capture_storage_enabled: bool = False
    raw_capture_retention_hours: int = 24
    max_sample_bytes: int = 5_000_000

    device_auth_mode: Literal["shared_secret"] = "shared_secret"
    device_shared_secret: str = "development-device-secret"
    demo_password: str = "GymDemo123!"

    login_rate_limit: int = 10
    kiosk_rate_limit: int = 120
    live_camera_rate_limit: int = 120
    live_camera_max_faces: int = 10
    rate_limit_window_seconds: int = 60

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value

    @field_validator(
        "face_match_threshold",
        "face_match_ambiguity_margin",
        "face_enrollment_consistency_threshold",
        "face_min_quality_score",
        "liveness_min_score",
        "depth_min_score",
        "face_min_size_ratio",
        "face_max_clipped_fraction",
        "yunet_score_threshold",
        "yunet_nms_threshold",
    )
    @classmethod
    def score_range(cls, value: float) -> float:
        if not 0 <= value <= 1:
            raise ValueError("scores must be between 0 and 1")
        return value

    @field_validator("face_match_threshold")
    @classmethod
    def positive_match_threshold(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("face_match_threshold must be greater than zero")
        return value

    @model_validator(mode="after")
    def production_safety(self) -> "Settings":
        if "*" in self.cors_origins:
            raise ValueError("wildcard CORS origins are not permitted")
        if self.face_engine == "opencv_sface" and self.liveness_mode != "none":
            raise ValueError("opencv_sface does not provide liveness; LIVENESS_MODE must be none")
        if self.app_env == "production":
            if self.secret_key.startswith("development") or len(self.secret_key) < 32:
                raise ValueError("production SECRET_KEY must be at least 32 characters")
            if self.device_shared_secret.startswith("development"):
                raise ValueError("production device secret must be changed")
            if self.demo_password == "GymDemo123!":
                raise ValueError("production DEMO_PASSWORD must be changed")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
