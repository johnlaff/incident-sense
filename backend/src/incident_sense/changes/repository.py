"""Load the committed synthetic Changes once and serve list/detail lookups."""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import TypeAdapter

from incident_sense.changes.evaluator import scope_of
from incident_sense.config import get_settings
from incident_sense.models.change import Change, ChangeSummary

_CHANGES_ADAPTER = TypeAdapter(list[Change])


def load_changes(path: Path | None = None) -> list[Change]:
    """Read and validate ``data/changes.json``."""
    changes_path = path or get_settings().changes_path
    raw = json.loads(changes_path.read_text(encoding="utf-8"))
    return _CHANGES_ADAPTER.validate_python(raw)


class ChangeRepository:
    """In-memory Changes, soonest planned window first."""

    def __init__(self, changes: list[Change]) -> None:
        self._changes = sorted(changes, key=lambda c: c.planned_start)
        self._by_number = {c.number: c for c in self._changes}

    def get(self, number: str) -> Change | None:
        """Return the Change, or None if unknown."""
        return self._by_number.get(number)

    def list(self) -> list[ChangeSummary]:
        """Summaries for the list screen."""
        return [
            ChangeSummary(
                number=c.number,
                short_description=c.short_description,
                type=c.type,
                state=c.state,
                company=c.company,
                cmdb_ci=c.cmdb_ci,
                risk=c.risk,
                planned_start=c.planned_start,
                in_scope=scope_of(c).in_scope,
                scenario=c.scenario,
            )
            for c in self._changes
        ]
