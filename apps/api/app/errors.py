from typing import Any


class APIError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(message)


def not_found(resource: str) -> APIError:
    return APIError(404, "NOT_FOUND", f"{resource} was not found.")


def forbidden(message: str = "You are not authorized to perform this action.") -> APIError:
    return APIError(403, "FORBIDDEN", message)


def conflict(code: str, message: str) -> APIError:
    return APIError(409, code, message)
