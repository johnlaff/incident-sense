"""A Problem record: the root cause behind a group of incidents.

In ITSM practice a Problem groups recurring incidents and carries the known
root cause, the workaround and the permanent fix. The RAG flow searches them in
their own collection (top-K 10) next to the resolved incidents (top-K 5). All
records here are synthetic.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class Problem(BaseModel):
    """A synthetic Problem record linked to a cluster of incidents."""

    number: str = Field(description="Problem id, e.g. PRB0004101.", examples=["PRB0004101"])
    short_description: str
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
