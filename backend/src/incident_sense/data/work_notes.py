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
MAX_KEYS = 5000


class WorkNotesStore:
    """Thread-safe in-memory work notes, newest last, bounded per incident."""

    def __init__(self, max_per_incident: int = MAX_NOTES_PER_INCIDENT) -> None:
        self._max = max_per_incident
        self._notes: dict[tuple[str, str], list[WorkNote]] = defaultdict(list)
        self._lock = threading.Lock()

    def publish(
        self,
        incident_number: str,
        text: str,
        *,
        sources: list[str],
        author: str = "Assistente da IA",
        model: str | None = None,
        client_id: str = "",
    ) -> WorkNote:
        """Append a note to an incident's work notes and return it.

        The same text twice (another Analisar of the same incident) is the same
        note: the history does not fill up with copies.
        """
        key = (client_id, incident_number)
        with self._lock:
            existing = self._notes.get(key, [])
            if existing and existing[-1].text == text and existing[-1].sources == list(sources):
                return existing[-1]
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
            if key not in self._notes and len(self._notes) >= MAX_KEYS:
                self._notes.pop(next(iter(self._notes)))
            notes = self._notes[key]
            notes.append(note)
            del notes[: max(0, len(notes) - self._max)]
        return note

    def list(self, incident_number: str, client_id: str = "") -> list[WorkNote]:
        """Return the notes this visitor's analyses published, oldest first.

        Scoped per visitor (the browser session id): each student opens a clean
        incident instead of every note anyone in the room published.
        """
        with self._lock:
            return list(self._notes.get((client_id, incident_number), []))


@lru_cache
def get_work_notes_store() -> WorkNotesStore:
    """The process-wide store shared by the suggest and incident endpoints."""
    return WorkNotesStore()
