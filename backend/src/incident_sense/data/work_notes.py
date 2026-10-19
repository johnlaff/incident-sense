"""Work notes published on incidents by the platform (step 7).

The demo has no ITSM to write back to, so published notes live in a small,
process-wide, in-memory store: the incident detail endpoint reads them back, so
the suggestion shows up on the incident's work notes. A restart clears them,
which is fine for a demo; each incident keeps only its most recent notes so a
live audience cannot grow memory without bound.
"""

from __future__ import annotations

import threading
import uuid
from collections import defaultdict
from datetime import UTC, datetime
from functools import lru_cache

from incident_sense.models import WorkNote

MAX_NOTES_PER_INCIDENT = 10


class WorkNotesStore:
    """Thread-safe in-memory work notes, newest last, bounded per incident."""

    def __init__(self, max_per_incident: int = MAX_NOTES_PER_INCIDENT) -> None:
        self._max = max_per_incident
        self._notes: dict[str, list[WorkNote]] = defaultdict(list)
        self._lock = threading.Lock()

    def publish(
        self,
        incident_number: str,
        text: str,
        *,
        sources: list[str],
        author: str = "Aurora",
        model: str | None = None,
    ) -> WorkNote:
        """Append a note to an incident's work notes and return it."""
        note = WorkNote(
            id=uuid.uuid4().hex[:12],
            incident_number=incident_number,
            author=author,
            text=text,
            sources=list(sources),
            model=model,
            created_at=datetime.now(UTC),
        )
        with self._lock:
            notes = self._notes[incident_number]
            notes.append(note)
            del notes[: max(0, len(notes) - self._max)]
        return note

    def list(self, incident_number: str) -> list[WorkNote]:
        """Return an incident's published notes, oldest first."""
        with self._lock:
            return list(self._notes.get(incident_number, []))


@lru_cache
def get_work_notes_store() -> WorkNotesStore:
    """The process-wide store shared by the suggest and incident endpoints."""
    return WorkNotesStore()
