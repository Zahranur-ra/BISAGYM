from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.database import SessionLocal
from app.main import create_app
from app.seed import seed_database


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        app_env="test",
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        secret_key="test-secret-key-that-is-long-enough-for-tests",
        device_shared_secret="test-device-secret",
        face_engine="mock",
        face_match_threshold=0.45,
        face_match_ambiguity_margin=0.0,
        liveness_mode="active_challenge",
        checkin_cooldown_seconds=60,
        login_rate_limit=1000,
        kiosk_rate_limit=1000,
    )


@pytest.fixture
def client(settings: Settings) -> Generator[TestClient]:
    app = create_app(settings)
    with TestClient(app) as test_client:
        with SessionLocal() as db:
            seed_database(db, settings)
        yield test_client


def login(client: TestClient, email: str) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": "GymDemo123!"})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def admin_headers(client: TestClient) -> dict[str, str]:
    token = login(client, "admin@gym.local")["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def reception_headers(client: TestClient) -> dict[str, str]:
    token = login(client, "reception@gym.local")["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def super_headers(client: TestClient) -> dict[str, str]:
    token = login(client, "superadmin@gym.local")["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def device_headers(settings: Settings) -> dict[str, str]:
    return {
        "X-Device-Code": "KIOSK-001",
        "X-Device-Token": settings.device_shared_secret,
    }
