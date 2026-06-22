"""Read/write the committed precomputed artifacts.

Two artifacts live in ``backend/data/precomputed/``:

* ``embeddings.npz`` — one 3072-dim vector per incident (compact NumPy archive).
  Used to self-seed Qdrant without any embedding API calls.
* ``clusters.json`` — the 2D clustering result served by ``GET /api/clusters``.

Keeping all the (de)serialization in one module means the scripts that *write*
these files and the API that *reads* them never disagree on the format.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import numpy as np
import numpy.typing as npt

from incident_sense.models import ClustersResponse


def save_embeddings(path: Path, ids: list[str], vectors: npt.NDArray[np.float32]) -> None:
    """Write incident ids + their vectors to a compressed ``.npz`` archive."""
    path.parent.mkdir(parents=True, exist_ok=True)
    # Unicode string array (not object) so loading needs no pickle.
    np.savez_compressed(path, ids=np.array(ids), vectors=vectors.astype(np.float32))


def load_embeddings(path: Path) -> tuple[list[str], npt.NDArray[np.float32]]:
    """Load the committed embeddings as (ids, vectors)."""
    with np.load(path) as data:
        ids = [str(value) for value in data["ids"].tolist()]
        vectors = cast("npt.NDArray[np.float32]", data["vectors"])
    return ids, vectors


def load_clusters_response(path: Path) -> ClustersResponse:
    """Load and validate the committed clustering result."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    return ClustersResponse.model_validate(raw)
