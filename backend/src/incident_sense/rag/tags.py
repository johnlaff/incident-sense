"""Semantic tags: the first retrieval layer decides *where* to search.

The resolved incidents and the Problems carry semantic tags (``pix``,
``timeout``, ``banco-de-dados``...). Before any vector math, the pipeline picks
the tags of the incident under analysis and restricts both searches to records
sharing at least one of them. Bookkeeping tags that say nothing about the
subject (noise markers, demo markers) are not part of the vocabulary.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from functools import lru_cache

from incident_sense.data.loader import load_incidents, load_problems, resolved_incidents
from incident_sense.models import Incident, Problem

# Tags that describe the record, not its subject: never used to route a search.
NON_SEMANTIC_TAGS = frozenset(
    {"ruido", "dados-incompletos", "demo", "procedente", "improcedente", "borderline"}
)


@dataclass(frozen=True)
class TagCatalog:
    """The semantic tag vocabulary and the usual tags per (category, subcategory)."""

    vocabulary: frozenset[str] = field(default_factory=frozenset)
    by_subcategory: dict[tuple[str, str], tuple[str, ...]] = field(default_factory=dict)

    def constrain(self, tags: Iterable[str]) -> list[str]:
        """Keep only vocabulary tags, deduplicated, in their original order."""
        seen: list[str] = []
        for tag in tags:
            normalized = tag.strip().lower()
            if normalized in self.vocabulary and normalized not in seen:
                seen.append(normalized)
        return seen

    def infer(self, category: str | None, subcategory: str | None) -> list[str]:
        """The tags most incidents of this category and subcategory carry."""
        if not category or not subcategory:
            return []
        return list(self.by_subcategory.get((category, subcategory), ()))

    @classmethod
    def from_records(cls, incidents: Iterable[Incident], problems: Iterable[Problem]) -> TagCatalog:
        """Build the catalog from the knowledge base (resolved incidents + Problems)."""
        vocabulary: set[str] = set()
        per_group: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
        sizes: Counter[tuple[str, str]] = Counter()
        records: list[Incident | Problem] = [*incidents, *problems]
        for record in records:
            semantic = [t for t in record.tags if t not in NON_SEMANTIC_TAGS]
            vocabulary.update(semantic)
            key = (record.category, record.subcategory)
            sizes[key] += 1
            per_group[key].update(semantic)
        by_subcategory = {
            key: tuple(tag for tag, count in counter.most_common() if count * 2 >= sizes[key])
            for key, counter in per_group.items()
        }
        return cls(
            vocabulary=frozenset(vocabulary),
            by_subcategory={k: v for k, v in by_subcategory.items() if v},
        )


@lru_cache
def get_tag_catalog() -> TagCatalog:
    """The catalog built once from the committed knowledge base."""
    return TagCatalog.from_records(resolved_incidents(load_incidents()), load_problems())
