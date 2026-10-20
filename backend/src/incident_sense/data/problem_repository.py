"""In-memory Problem repository for the browse UI.

The ten synthetic Problems are loaded once. A Problem's detail is joined with
the incident repository so the page can list the incidents it explains and the
recurrence group they belong to.
"""

from __future__ import annotations

from collections import Counter

from incident_sense.data.loader import load_problems
from incident_sense.data.repository import IncidentRepository
from incident_sense.models import Problem, ProblemDetail, ProblemSummary
from incident_sense.models.incident_list import IncidentSummary


class ProblemRepository:
    """Holds Problems in memory and answers list/detail queries."""

    def __init__(self, problems: list[Problem]) -> None:
        self._problems = sorted(problems, key=lambda p: p.number)
        self._by_number = {p.number: p for p in self._problems}

    def list(self) -> list[ProblemSummary]:
        """Every Problem as a summary, in number order."""
        return [ProblemSummary.from_problem(p) for p in self._problems]

    def get(self, number: str) -> Problem | None:
        """Return the full Problem, or None if unknown."""
        return self._by_number.get(number.upper())

    def detail(self, number: str, incidents: IncidentRepository) -> ProblemDetail | None:
        """The Problem joined with its linked incidents and recurrence group."""
        problem = self.get(number)
        if problem is None:
            return None
        found = [inc for n in problem.linked_incidents if (inc := incidents.get(n)) is not None]
        found.sort(key=lambda inc: inc.opened_at, reverse=True)
        clusters = Counter(
            (point.cluster_id, point.cluster_label)
            for inc in found
            if (point := incidents.get_cluster(inc.number)) is not None and not point.is_outlier
        )
        top = clusters.most_common(1)
        cluster_id, cluster_label = top[0][0] if top else (None, None)
        return ProblemDetail(
            **problem.model_dump(),
            related=[IncidentSummary.from_incident(inc) for inc in found],
            cluster_id=cluster_id,
            cluster_label=cluster_label,
        )


def build_problem_repository() -> ProblemRepository:
    """Build a repository from the committed Problem records."""
    return ProblemRepository(load_problems())
