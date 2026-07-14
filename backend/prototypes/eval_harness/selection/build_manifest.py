"""Regenerate the selection dataset manifest (hashes + counts).

PROTOTYPE. Run explicitly after editing the selection corpus:

    cd backend && uv run python -m prototypes.eval_harness.selection.build_manifest
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

from ..schema import CaseFileEntry, EvalCase, EvalManifest
from .contexts import CONTEXTS

_DATASET_DIR = Path(__file__).parent / "dataset"
_CASES = _DATASET_DIR / "cases.jsonl"
_MANIFEST = _DATASET_DIR / "manifest.json"
_DATASET_VERSION = "selection-bilingual/v1"
_CREATED = "2026-07-13"  # fixed stamp — reproducible artifact, not a live clock


def build() -> EvalManifest:
    """Validate the cases (and their probe contexts) and return the manifest."""
    cases: list[EvalCase] = []
    for number, line in enumerate(_CASES.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            cases.append(EvalCase.model_validate_json(line))
        except ValueError as exc:
            raise SystemExit(f"invalid case on line {number}: {exc}") from exc

    orphans = [case.case_id for case in cases if case.case_id not in CONTEXTS]
    if orphans:
        raise SystemExit(f"cases without a probe context: {orphans}")

    digest = hashlib.sha256(_CASES.read_bytes()).hexdigest()
    counts = {
        "total": len(cases),
        **{f"locale:{k}": v for k, v in Counter(c.locale for c in cases).items()},
        **{f"family:{k}": v for k, v in Counter(c.family for c in cases).items()},
    }
    return EvalManifest(
        dataset_version=_DATASET_VERSION,
        created=_CREATED,
        files=[CaseFileEntry(path="cases.jsonl", sha256=digest, count=len(cases))],
        counts=counts,
        notes=(
            "Selection sentinel corpus for the controlled model comparison. "
            "Draft provenance, single-author, synthetic; NOT the human-reviewed "
            "regression corpus — thresholds must not be ratified against it."
        ),
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
