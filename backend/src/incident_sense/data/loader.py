"""Load the committed synthetic dataset into typed models.

The dataset is a JSON array of incidents on disk; this module is the single
place that reads and validates it, so the rest of the app works with
``Incident`` objects instead of raw dicts.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import TypeAdapter

from incident_sense.config import get_settings
from incident_sense.models import Incident

# A reusable validator for "a list of incidents" (faster than per-item parsing).
_INCIDENTS_ADAPTER = TypeAdapter(list[Incident])


def load_incidents(path: Path | None = None) -> list[Incident]:
    """Read and validate the committed dataset.

    Args:
        path: override the dataset location (defaults to the configured path).

    Raises:
        FileNotFoundError: with an actionable message if the dataset is missing.
    """
    dataset_path = path or get_settings().incidents_path
    if not dataset_path.exists():
        raise FileNotFoundError(
            f"Dataset not found at {dataset_path}. Generate it with "
            "`make generate` (or it should be committed in backend/data/)."
        )
    raw = json.loads(dataset_path.read_text(encoding="utf-8"))
    return _INCIDENTS_ADAPTER.validate_python(raw)


def resolved_incidents(incidents: list[Incident]) -> list[Incident]:
    """Return only incidents that carry a usable resolution (the RAG knowledge)."""
    return [incident for incident in incidents if incident.is_resolved]
