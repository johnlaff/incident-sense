"""Load the versioned rubric that lives next to this module."""

from __future__ import annotations

import tomllib
from functools import lru_cache
from pathlib import Path

from incident_sense.models.change import Rubric

RUBRIC_PATH = Path(__file__).with_name("rubrica.toml")


@lru_cache
def load_rubric(path: Path = RUBRIC_PATH) -> Rubric:
    """Parse ``rubrica.toml`` into a validated :class:`Rubric`."""
    with path.open("rb") as handle:
        return Rubric.model_validate(tomllib.load(handle))
