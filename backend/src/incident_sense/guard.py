"""Usage guard-rails for routes that call a model.

The published demo is open to a live audience, so each AI route is metered
*before* any provider call: a sliding window per browser-generated client id,
a looser window per IP (a whole room often shares one NAT address), and a
global daily ceiling that bounds the worst-case bill. State is in-process and
resets on restart, which is acceptable for a single-instance demo.

Two things keep a script from gaming it (spec #128): the network is the hop a
trusted proxy appended to ``X-Forwarded-For``, never the one the client wrote
first; and the windows are bounded in memory, so rotating ids cannot grow the
process without limit.
"""

from __future__ import annotations

import ipaddress
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from incident_sense.config import Settings, get_settings
from incident_sense.logging import get_logger

CLIENT_HEADER = "X-Client-Id"
# Most distinct clients (and most distinct networks) the guard remembers at
# once. An audience is in the hundreds; beyond this, the oldest entry goes.
MAX_KEYS = 10_000

log = get_logger(__name__)


class UsageGuard:
    """Sliding-window limits per client and per IP plus a daily global cap."""

    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._by_client: OrderedDict[str, deque[float]] = OrderedDict()
        self._by_ip: OrderedDict[str, deque[float]] = OrderedDict()
        self._day = ""
        self._day_count = 0

    @property
    def tracked_clients(self) -> int:
        """How many client ids currently hold a window."""
        with self._lock:
            return len(self._by_client)

    @property
    def tracked_ips(self) -> int:
        """How many networks currently hold a window."""
        with self._lock:
            return len(self._by_ip)

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
        refusal says what the person actually did. Every refusal is logged
        with the limit that held, so abuse shows up during a live session.
        """
        per_client = settings.ai_max_per_client if max_per_client is None else max_per_client
        per_ip = settings.ai_max_per_ip if max_per_ip is None else max_per_ip
        now = self._clock()
        day = datetime.fromtimestamp(now, UTC).date().isoformat()
        limit: str | None = None
        reason: str | None = None
        with self._lock:
            if day != self._day:
                self._day, self._day_count = day, 0
            if self._day_count >= settings.ai_max_per_day:
                limit, reason = "day", "A demo atingiu o limite de uso de hoje. Volte amanhã."
            else:
                client_hits = self._window(self._by_client, client_id, now, settings)
                ip_hits = self._window(self._by_ip, ip, now, settings)
                if len(client_hits) >= per_client:
                    limit = "client"
                    reason = f"Você fez muitas {noun} seguidas. Espere alguns minutos."
                elif len(ip_hits) >= per_ip:
                    limit = "ip"
                    reason = f"Muitas {noun} vindas desta rede. Espere alguns minutos."
                else:
                    client_hits.append(now)
                    ip_hits.append(now)
                    self._day_count += 1
                self._settle(self._by_client, client_id, client_hits)
                self._settle(self._by_ip, ip, ip_hits)
                self._sweep(self._by_client, now, settings)
                self._sweep(self._by_ip, now, settings)
        if reason is not None:
            # The id is a browser-generated token; a prefix is enough to follow
            # one visitor in the log without copying what they sent.
            log.warning("ai_quota_refused", limit=limit, client_id=client_id[:16], ip=ip, noun=noun)
        return reason

    @staticmethod
    def _window(
        table: OrderedDict[str, deque[float]], key: str, now: float, settings: Settings
    ) -> deque[float]:
        hits = table.get(key)
        if hits is None:
            hits = deque()
        while hits and now - hits[0] >= settings.ai_window_seconds:
            hits.popleft()
        return hits

    @staticmethod
    def _sweep(table: OrderedDict[str, deque[float]], now: float, settings: Settings) -> None:
        """Drop the stalest windows: the table is ordered by last activity."""
        while table:
            key, hits = next(iter(table.items()))
            if hits and now - hits[-1] < settings.ai_window_seconds:
                return
            del table[key]

    @staticmethod
    def _settle(table: OrderedDict[str, deque[float]], key: str, hits: deque[float]) -> None:
        """Keep a live window (most recent last), drop an empty one, cap the table."""
        if not hits:
            table.pop(key, None)
            return
        table[key] = hits
        table.move_to_end(key)
        while len(table) > MAX_KEYS:
            table.popitem(last=False)


_guard = UsageGuard()


def get_usage_guard() -> UsageGuard:
    """The process-wide guard (overridable in tests)."""
    return _guard


_ask_guard = UsageGuard()


def get_ask_guard() -> UsageGuard:
    """The guard for follow-up questions: a budget of its own (overridable)."""
    return _ask_guard


def client_ip(request: Request, settings: Settings | None = None) -> str:
    """The visitor's network: the last public hop a trusted proxy appended.

    Proxies append the address they saw to ``X-Forwarded-For``, so the list
    ends with what our own edge saw; everything before it is whatever the
    client chose to send. Addresses from private ranges at the end of the
    list are the hosting platform's own hops (Render's internal proxies
    append one, and it changes between requests) and never a visitor, so
    they are skipped first. ``trusted_proxy_hops`` then counts the trusted
    entries from the end (one for Render's edge). Without the header, the
    peer of the connection is the visitor.
    """
    settings = settings or get_settings()
    forwarded = [h.strip() for h in request.headers.get("x-forwarded-for", "").split(",")]
    forwarded = [h for h in forwarded if h]
    while len(forwarded) > 1 and _is_internal(forwarded[-1]):
        forwarded.pop()
    if forwarded:
        hops = max(1, settings.trusted_proxy_hops)
        return forwarded[-hops] if hops <= len(forwarded) else forwarded[0]
    return request.client.host if request.client else "unknown"


def _is_internal(address: str) -> bool:
    """A private, loopback, link-local or unspecified address: a platform hop."""
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_unspecified


def client_key(request: Request) -> str:
    """Who is asking: the X-Client-Id (first 64 chars) or, without one, the IP.

    The quota, the content lock and the published notes all key on this, so
    the three never disagree about who a visitor is.
    """
    return request.headers.get(CLIENT_HEADER, "")[:64] or f"ip:{client_ip(request)}"


def ai_quota(request: Request, guard: Annotated[UsageGuard, Depends(get_usage_guard)]) -> None:
    """FastAPI dependency: refuse with 429 once a limit is reached."""
    settings = get_settings()
    reason = guard.check(
        client_id=client_key(request), ip=client_ip(request, settings), settings=settings
    )
    if reason:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=reason)
