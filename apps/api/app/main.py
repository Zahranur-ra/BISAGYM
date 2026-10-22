import json
import logging
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.middleware.base import BaseHTTPMiddleware

from app.biometrics import FaceRecognitionEngine, create_face_engine
from app.config import Settings, get_settings
from app.database import Base, SessionLocal, configure_database
from app.errors import APIError
from app.routes import router

logger = logging.getLogger("bisagym.api")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps(
            {
                "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%SZ"),
                "level": record.levelname,
                "service": "bisagym-api",
                "message": record.getMessage(),
                "correlation_id": getattr(record, "correlation_id", None),
            }
        )


def configure_logging() -> None:
    if logger.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        supplied = request.headers.get("x-correlation-id")
        try:
            request.state.correlation_id = str(UUID(supplied)) if supplied else str(uuid4())
        except ValueError:
            request.state.correlation_id = str(uuid4())
        response = await call_next(request)
        response.headers["X-Correlation-ID"] = request.state.correlation_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(self), microphone=()"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response


def error_payload(request: Request, code: str, message: str, details: object) -> dict:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": jsonable_encoder(details),
            "correlation_id": getattr(request.state, "correlation_id", str(uuid4())),
        }
    }


def create_app(
    settings: Settings | None = None, face_engine: FaceRecognitionEngine | None = None
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging()
    database_engine = configure_database(settings.database_url)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        if settings.auto_create_db:
            Base.metadata.create_all(database_engine)
        try:
            application.state.face_engine = face_engine or create_face_engine(settings)
            application.state.face_engine_health = application.state.face_engine.health()
        except Exception as exc:
            logger.error("face engine initialization failed: %s", exc)
            application.state.face_engine = None
            application.state.face_engine_health = {
                "status": "unavailable",
                "engine": settings.face_engine,
                "demo_mode": settings.face_engine == "mock",
                "model_name": settings.face_model_name,
                "model_version": settings.face_model_version,
                "error": str(exc),
            }
        yield

    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        description="Membership and local biometric gym access API.",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "X-Correlation-ID",
            "X-Device-Code",
            "X-Device-Token",
            "X-Kiosk-Session",
            "Idempotency-Key",
        ],
        expose_headers=["X-Correlation-ID", "Content-Disposition"],
    )

    @app.exception_handler(APIError)
    async def api_error(request: Request, exc: APIError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(request, exc.code, exc.message, exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {"loc": list(error["loc"]), "msg": error["msg"], "type": error["type"]}
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=error_payload(
                request, "VALIDATION_ERROR", "Request validation failed.", details
            ),
        )

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(request, "HTTP_ERROR", str(exc.detail), {}),
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "unexpected request failure",
            extra={"correlation_id": getattr(request.state, "correlation_id", None)},
        )
        return JSONResponse(
            status_code=500,
            content=error_payload(request, "SYSTEM_ERROR", "An unexpected error occurred.", {}),
        )

    @app.get("/health/live", tags=["health"])
    def health_live() -> dict[str, str]:
        return {"status": "ok", "service": "api"}

    @app.get("/health/ready", tags=["health"])
    def health_ready(response: Response) -> dict[str, str]:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        model_ready = app.state.face_engine_health.get("status") == "ready"
        if not model_ready:
            response.status_code = 503
        return {
            "status": "ready" if model_ready else "unavailable",
            "database": "ok",
            "face_engine": "ready" if model_ready else "unavailable",
        }

    @app.get("/health/model", tags=["health"])
    def health_model(response: Response) -> dict:
        health = app.state.face_engine_health
        if health.get("status") != "ready":
            response.status_code = 503
        return health

    app.include_router(router)
    return app


app = create_app()
