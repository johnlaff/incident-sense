"""Schemas for the recurrence-clustering endpoint.

These mirror the committed precomputed result: one 2D point per incident, each
tagged with its cluster (or marked as an outlier). HDBSCAN labels noise points
with cluster id ``-1`` — we expose that as ``is_outlier`` so the UI can grey
them out instead of coloring them as a real group.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

# Cluster id used by HDBSCAN for noise / outliers.
OUTLIER_CLUSTER_ID = -1


class ClusterPoint(BaseModel):
    """One incident projected to 2D, with its cluster assignment."""

    id: str = Field(description="Incident number this point represents.")
    x: float = Field(description="UMAP x coordinate.")
    y: float = Field(description="UMAP y coordinate.")
    cluster_id: int = Field(description="Cluster id, or -1 for an outlier.")
    cluster_label: str = Field(description="Human-readable cluster name.")
    is_outlier: bool = Field(description="True when HDBSCAN marked it as noise.")
    short_description: str
    priority: int = Field(description="Ticket priority (1 = most urgent).")


class ClusterSummary(BaseModel):
    """Aggregate info for one cluster, handy for legends and labels."""

    cluster_id: int
    label: str
    size: int = Field(description="Number of incidents in this cluster.")


class ClustersResponse(BaseModel):
    """Everything the map needs to render the recurrence view."""

    points: list[ClusterPoint]
    clusters: list[ClusterSummary]
    total: int = Field(description="Total number of plotted incidents.")
    outliers: int = Field(description="How many points are outliers.")
