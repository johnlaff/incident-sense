"""CLI: re-embed the knowledge base as the article builds the query (needs a key).

    uv run python scripts/reembed.py --incidents   # summary + categoria/subcategoria/empresa
    uv run python scripts/reembed.py --problems    # real Problem embeddings

Writes ``summary_embeddings.npz`` / ``problem_embeddings.npz`` next to the
committed vectors; the next seed (``make seed`` or an API restart with an empty
Qdrant) prefers them. The raw-text ``embeddings.npz`` stays for clustering.
"""

from __future__ import annotations

import argparse
import sys

from incident_sense.config import get_settings
from incident_sense.data.loader import load_incidents, load_problems, resolved_incidents
from incident_sense.data.precomputed import save_embeddings
from incident_sense.data.reembed import incident_summary_vectors, problem_text_vectors
from incident_sense.rag.clients import build_deps


def main() -> None:
    parser = argparse.ArgumentParser(description="Re-embed incidents and/or Problems.")
    parser.add_argument("--incidents", action="store_true", help="Summary-based incident vectors.")
    parser.add_argument("--problems", action="store_true", help="Real Problem embeddings.")
    args = parser.parse_args()
    if not (args.incidents or args.problems):
        parser.error("choose --incidents and/or --problems")

    settings = get_settings()
    if not settings.has_llm:
        sys.exit("OPENROUTER_API_KEY is not set: re-embedding needs the gateway.")
    deps = build_deps(settings)

    if args.incidents:
        incidents = resolved_incidents(load_incidents(settings.incidents_path))
        ids, vectors = incident_summary_vectors(deps, incidents)
        save_embeddings(settings.summary_embeddings_path, ids, vectors)
        print(f"{len(ids)} incidents -> {settings.summary_embeddings_path}", file=sys.stderr)
    if args.problems:
        problems = load_problems(settings.problems_path)
        ids, vectors = problem_text_vectors(deps.embeddings, problems)
        save_embeddings(settings.problem_embeddings_path, ids, vectors)
        print(f"{len(ids)} problems -> {settings.problem_embeddings_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
