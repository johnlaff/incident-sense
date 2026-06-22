"""CLI: load the committed dataset + embeddings into Qdrant (``make seed``).

This makes no LLM/embedding API calls — vectors come from the committed
``embeddings.npz``. Qdrant must be reachable (e.g. ``docker compose up qdrant``).
"""

from __future__ import annotations

import argparse
import sys

from incident_sense.config import get_settings
from incident_sense.data.ingest import ingest


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed Qdrant from committed data.")
    parser.add_argument(
        "--keep",
        action="store_true",
        help="Reuse the existing collection instead of recreating it.",
    )
    args = parser.parse_args()

    settings = get_settings()
    count = ingest(settings, recreate=not args.keep)
    print(
        f"Ingested {count} resolved incidents into "
        f"'{settings.qdrant_collection}' at {settings.qdrant_url}.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
