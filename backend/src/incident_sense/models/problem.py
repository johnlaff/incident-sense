"""A Problem record: the root cause behind a group of incidents.

In ITSM practice a Problem groups recurring incidents and carries the known
root cause, the workaround and the permanent fix. The RAG flow searches them in
their own collection (top-K 10) next to the resolved incidents (top-K 5). All
records here are synthetic.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from .incident_list import IncidentSummary


class Problem(BaseModel):
    """A synthetic Problem record linked to a cluster of incidents."""

    number: str = Field(description="Problem id, e.g. PRB0004101.", examples=["PRB0004101"])
    short_description: str
    plain_summary: str = Field(
        default="", description="One or two plain sentences for a reader new to ITSM."
    )
    description: str
    root_cause: str
    workaround: str
    permanent_fix: str
    category: str
    subcategory: str
    cmdb_ci: str
    assignment_group: str
    empresa: str = "Banco Meridiano"
    state: str = Field(description="'Resolvido' or 'Erro conhecido'.")
    opened_at: datetime
    resolved_at: datetime | None = None
    tags: list[str] = Field(default_factory=list)
    linked_incidents: list[str] = Field(
        default_factory=list, description="Numbers of the incidents this Problem explains."
    )


class ProblemSummary(BaseModel):
    """The subset of Problem fields a list row needs."""

    number: str
    short_description: str
    plain_summary: str = ""
    root_cause: str
    state: str
    category: str
    subcategory: str
    cmdb_ci: str
    assignment_group: str
    opened_at: datetime
    resolved_at: datetime | None = None
    tags: list[str] = Field(default_factory=list)
    linked_incidents: list[str] = Field(
        default_factory=list, description="Numbers of the incidents this Problem explains."
    )

    @classmethod
    def from_problem(cls, problem: Problem) -> ProblemSummary:
        """Project a full Problem down to a list summary."""
        return cls.model_validate(problem.model_dump())


class ProblemDetail(Problem):
    """A full Problem plus the linked incidents found in the repertoire.

    ``related`` keeps the order of ``linked_incidents``, newest first, and skips
    numbers the incident base does not know. ``cluster_label`` names the
    recurrence group most of the linked incidents fall in, or is ``null``.
    """

    related: list[IncidentSummary] = Field(default_factory=list)
    cluster_id: int | None = None
    cluster_label: str | None = None
