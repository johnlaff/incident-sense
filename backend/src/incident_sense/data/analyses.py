"""Each visitor's last analysis of an incident, as the server ran it.

A follow-up question (``/api/incidents/{n}/ask``) answers from the analysis
the person is looking at: its verdict, the suggestion shown and the cases it
kept. Holding that here, by visitor and incident, means the browser never
decides which cases count as sources. In memory and bounded, like the work
notes: a restart forgets it, and the question then asks for a new analysis.
"""

from __future__ import annotations

import threading
from collections import OrderedDict

from pydantic import BaseModel, Field

MAX_ANALYSES = 5000


class AnalysisMemory(BaseModel):
    """What a follow-up needs from one analysis."""

    classification: str
    justification: str = ""
    suggestion: str | None = None
    kept: list[str] = Field(default_factory=list, description="Context ids, in order.")
    reasons: dict[str, str] = Field(
        default_factory=dict, description="Why the post-filter kept each case."
    )


class AnalysisStore:
    """Thread-safe last analysis per (visitor, incident), oldest dropped first."""

    def __init__(self, max_entries: int = MAX_ANALYSES) -> None:
        self._max = max_entries
        self._items: OrderedDict[tuple[str, str], AnalysisMemory] = OrderedDict()
        self._lock = threading.Lock()

    def put(self, client_id: str, number: str, memory: AnalysisMemory) -> None:
        """Hold this visitor's latest analysis of the incident."""
        key = (client_id, number.upper())
        with self._lock:
            self._items[key] = memory
            self._items.move_to_end(key)
            while len(self._items) > self._max:
                self._items.popitem(last=False)

    def get(self, client_id: str, number: str) -> AnalysisMemory | None:
        """The latest analysis, or None (never run, or forgotten on restart)."""
        with self._lock:
            return self._items.get((client_id, number.upper()))


_store = AnalysisStore()


def get_analysis_store() -> AnalysisStore:
    """The process-wide store (overridable in tests)."""
    return _store
