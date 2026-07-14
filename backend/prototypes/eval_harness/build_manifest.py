"""Regenerate the dataset manifest (hashes + counts) from ``cases.jsonl``.

PROTOTYPE. Run explicitly after editing the corpus:

    cd backend && uv run python -m prototypes.eval_harness.build_manifest

It validates every line against ``EvalCase`` (fails loud on a bad row), computes
the content hash, and writes ``dataset/manifest.json`` with a fixed ``created``
stamp so the artifact stays reproducible.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

from .schema import CaseFileEntry, EvalCase, EvalManifest

_DATASET_DIR = Path(__file__).parent / "dataset"
_CASES = _DATASET_DIR / "cases.jsonl"
_MANIFEST = _DATASET_DIR / "manifest.json"
_DATASET_VERSION = "proto-bilingual/v1"
_CREATED = "2026-07-13"  # fixed stamp — reproducible artifact, not a live clock


def build() -> EvalManifest:
    """Validate the cases, hash the file, and return the manifest model."""
    cases: list[EvalCase] = []
    for number, line in enumerate(_CASES.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            cases.append(EvalCase.model_validate_json(line))
        except ValueError as exc:  # loud failure, with the offending line number
            raise SystemExit(f"invalid case on line {number}: {exc}") from exc

    digest = hashlib.sha256(_CASES.read_bytes()).hexdigest()
    by_locale = Counter(c.locale for c in cases)
    by_family = Counter(c.family for c in cases)
    counts = {
        "total": len(cases),
        **{f"locale:{k}": v for k, v in by_locale.items()},
        **{f"family:{k}": v for k, v in by_family.items()},
    }
    return EvalManifest(
        dataset_version=_DATASET_VERSION,
        created=_CREATED,
        files=[CaseFileEntry(path="cases.jsonl", sha256=digest, count=len(cases))],
        counts=counts,
        notes="Prototype bilingual corpus. Single-annotator, synthetic; not a secret holdout.",
    )


def main() -> None:
    """Write ``dataset/manifest.json`` from the current cases."""
    manifest = build()
    _MANIFEST.write_text(
        json.dumps(manifest.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {_MANIFEST} ({manifest.counts['total']} cases)")


if __name__ == "__main__":
    main()
