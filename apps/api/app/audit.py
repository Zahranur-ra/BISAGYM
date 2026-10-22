from typing import Any

from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.models import AuditLog


def record_audit(
    db: Session,
    *,
    action: str,
    resource_type: str,
    correlation_id: str,
    actor_id: str | None = None,
    actor_type: str = "USER",
    resource_id: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> AuditLog:
    log = AuditLog(
        actor_type=actor_type,
        actor_id=actor_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        before_data=jsonable_encoder(before) if before is not None else None,
        after_data=jsonable_encoder(after) if after is not None else None,
        ip_address=ip_address,
        user_agent=user_agent,
        correlation_id=correlation_id,
    )
    db.add(log)
    return log
