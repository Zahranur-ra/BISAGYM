from collections import defaultdict, deque
from threading import Lock
from time import monotonic

from app.errors import APIError


class InMemoryRateLimiter:
    """A bounded per-process limiter; deployments can replace it with a shared store."""

    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str, limit: int, window_seconds: int) -> None:
        now = monotonic()
        cutoff = now - window_seconds
        with self._lock:
            events = self._events[key]
            while events and events[0] < cutoff:
                events.popleft()
            if len(events) >= limit:
                raise APIError(429, "RATE_LIMITED", "Too many requests. Please try again later.")
            events.append(now)


rate_limiter = InMemoryRateLimiter()
