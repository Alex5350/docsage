"""Shared retry policy for provider API calls (SDK-level retries are off)."""

import time
from collections.abc import Callable

ATTEMPTS = 3
# Exponential backoff between attempts (seconds): 1s, 2s, 4s.
DELAYS: tuple[float, ...] = (1.0, 2.0, 4.0)


def call_with_retries[T](
    operation: Callable[[], T],
    is_retryable: Callable[[Exception], bool],
    attempts: int = ATTEMPTS,
    delays: tuple[float, ...] = DELAYS,
) -> T:
    """Run ``operation`` with exponential backoff; re-raise the last error otherwise."""
    for attempt in range(1, attempts + 1):
        try:
            return operation()
        except Exception as exc:
            if attempt >= attempts or not is_retryable(exc):
                raise
            time.sleep(delays[min(attempt - 1, len(delays) - 1)])
    raise AssertionError("unreachable")  # pragma: no cover
