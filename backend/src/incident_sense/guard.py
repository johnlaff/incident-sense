"""Usage guard-rails for routes that call a model.

The published demo is open to a live audience, so each AI route is metered
*before* any provider call: a sliding window per browser-generated client id,
a looser window per IP (a whole room often shares one NAT address), and a
global daily ceiling that bounds the worst-case bill. State is in-process and
resets on restart, which is acceptable for a single-instance demo.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from incident_sense.config import Settings, get_settings

CLIENT_HEADER = "X-Client-Id"


class UsageGuard:
    """Sliding-window limits per client and per IP plus a daily global cap."""

    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._by_client: defaultdict[str, deque[float]] = defaultdict(deque)
        self._by_ip: defaultdict[str, deque[float]] = defaultdict(deque)
        self._day = ""
        self._day_count = 0

    def check(
        self,
        *,
        client_id: str,
        ip: str,
        settings: Settings,
        max_per_client: int | None = None,
        max_per_ip: int | None = None,
        noun: str = "análises",
    ) -> str | None:
        """Record one AI call, or return the pt-BR reason it is refused.

        ``noun`` names what is counted ("análises", "perguntas"), so the
        refusal says what the person actually did.
        """
        per_client = settings.ai_max_per_client if max_per_client is None else max_per_client
        per_ip = settings.ai_max_per_ip if max_per_ip is None else max_per_ip
        now = self._clock()
        day = datetime.fromtimestamp(now, UTC).date().isoformat()
        with self._lock:
            if day != self._day:
                self._day, self._day_count = day, 0
            if self._day_count >= settings.ai_max_per_day:
                return "A demo atingiu o limite de uso de hoje. Volte amanhã."
            client_hits = self._window(self._by_client[client_id], now, settings)
            ip_hits = self._window(self._by_ip[ip], now, settings)
            if len(client_hits) >= per_client:
                return f"Você fez muitas {noun} seguidas. Espere alguns minutos."
            if len(ip_hits) >= per_ip:
                return f"Muitas {noun} vindas desta rede. Espere alguns minutos."
            client_hits.append(now)
            ip_hits.append(now)
            self._day_count += 1
        return None

    @staticmethod
    def _window(hits: deque[float], now: float, settings: Settings) -> deque[float]:
        while hits and now - hits[0] >= settings.ai_window_seconds:
            hits.popleft()
        return hits


_guard = UsageGuard()


def get_usage_guard() -> UsageGuard:
    """The process-wide guard (overridable in tests)."""
    return _guard


_ask_guard = UsageGuard()


def get_ask_guard() -> UsageGuard:
    """The guard for follow-up questions: a budget of its own (overridable)."""
    return _ask_guard


def _client_ip(request: Request) -> str:
    # Behind Render's proxy the caller is the first X-Forwarded-For hop.
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def client_key(request: Request) -> str:
    """Who is asking: the X-Client-Id (first 64 chars) or, without one, the IP.

    The quota, the content lock and the published notes all key on this, so
    the three never disagree about who a visitor is.
    """
    return request.headers.get(CLIENT_HEADER, "")[:64] or f"ip:{_client_ip(request)}"


def ai_quota(request: Request, guard: Annotated[UsageGuard, Depends(get_usage_guard)]) -> None:
    """FastAPI dependency: refuse with 429 once a limit is reached."""
    ip = _client_ip(request)
    client_id = client_key(request)
    reason = guard.check(client_id=client_id, ip=ip, settings=get_settings())
    if reason:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=reason)
