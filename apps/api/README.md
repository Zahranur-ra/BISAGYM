# BisaGym API

Python 3.13 FastAPI backend for branch-scoped membership and local RGB biometric access control.

## Run locally

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload
```

SQLite is the local default. Set `DATABASE_URL=postgresql+psycopg://...` for PostgreSQL.
API documentation is available at `/docs`. The demo password for all staff accounts is
`GymDemo123!`; change all secrets before production use.

Local development defaults to `FACE_ENGINE=opencv_sface`, using the checked-in YuNet and SFace
ONNX files under `runtime-models/`. Startup verifies both configured paths and SHA-256 hashes.
`GET /health/model` reports the loaded model metadata, and readiness returns HTTP 503 when the
engine cannot be initialized. SFace matching defaults to a conservative cosine threshold of
`0.50` and should still be calibrated using representative, consented local data.

Real enrollment sample requests use a raw `image/jpeg` or `image/png` body and a `pose_type`
query parameter. Real kiosk check-ins use the same raw body plus `X-Kiosk-Session` and
`Idempotency-Key` headers; device authentication headers remain required. Images are decoded in
memory and are never persisted. Temporary enrollment embeddings are cleared after profile
creation. `LIVENESS_MODE=none` performs no liveness check and records no fabricated score; YuNet
and SFace are not presentation-attack detection.

Demo logins: `superadmin@gym.local`, `admin@gym.local`, and `reception@gym.local`.
The seeded kiosk uses code `KIOSK-001` and the configured `DEVICE_SHARED_SECRET`.

Set `FACE_ENGINE=mock` and `LIVENESS_MODE=active_challenge` only for deterministic demo/testing.
Mock check-in tags include `member-demo-active`, `member-demo-expired`,
`member-demo-suspended`, `unknown`, `spoof`, `no-face`, `multiple-faces`, and
`low-confidence:member-demo-active`.

## Commands

```powershell
pytest
ruff check .
alembic upgrade head
python -m app.seed
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Production requires TLS termination, strong unique secrets, calibrated thresholds, shared rate
limiting for multiple workers, encrypted database backups, appropriate biometric consent and
retention controls, and a separately evaluated PAD solution when liveness is required. The mock
engine is deterministic and must not be enabled for real access control.
