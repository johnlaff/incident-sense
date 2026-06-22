"""GET /api/clusters — serve the committed recurrence-clustering result.

This is fully offline and deterministic: it returns the precomputed 2D layout
verbatim, with no API calls. The loader is wrapped in a dependency so tests can
inject a fixture instead of reading from disk.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from incident_sense.config import get_settings
from incident_sense.data.precomputed import load_clusters_response
from incident_sense.models import ClustersResponse

router = APIRouter(tags=["clusters"])


def get_clusters() -> ClustersResponse:
    """Load the committed clustering result, or 503 if it is missing."""
    settings = get_settings()
    try:
        return load_clusters_response(settings.clusters_path)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Clustering result not found. Run `make precompute` to build it.",
        ) from exc


@router.get("/clusters", response_model=ClustersResponse)
def clusters(data: Annotated[ClustersResponse, Depends(get_clusters)]) -> ClustersResponse:
    """Return every incident as a 2D point with its cluster assignment."""
    return data
