"""In-process sliding-window rate limiting for the auth endpoints.

Dependency-free and per-process by design (ADR deployment story: one API
instance). Login counts FAILED attempts per email+client pair and clears on
success; register counts every attempt per client. Both share the same
window/limit defaults.
"""

from __future__ import annotations

from collections import defaultdict, deque
from threading import Lock
from time import monotonic

LOGIN_FAILURE_LIMIT = 10
REGISTER_LIMIT = 10
WINDOW_SECONDS = 60.0


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(
        self, key: str, *, limit: int = LOGIN_FAILURE_LIMIT, window: float = WINDOW_SECONDS
    ) -> float:
        """Record a hit; returns 0.0 when allowed, else the retry-after seconds."""
        now = monotonic()
        with self._lock:
            bucket = self._hits[key]
            cutoff = now - window
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                retry_after = window - (now - bucket[0])
                return max(retry_after, 0.1)
            bucket.append(now)
            return 0.0

    def clear(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)

    def reset(self) -> None:
        """Test isolation: drop every window (production never calls this)."""
        with self._lock:
            self._hits.clear()


limiter = SlidingWindowLimiter()


def client_ip(request) -> str:
    return request.client.host if request.client else "unknown"
