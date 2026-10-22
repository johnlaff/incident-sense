"""Run the real evaluation of one Change N times and print what the judge decided.

Each run calls POST /api/changes/{number}/evaluate with ``fresh: true``, so the
model is called again instead of the visitor's cache. For every run it prints
the verdict, the failed gates, the coherence and back-out numbers, and the
points the judge raised, split by what they do: contradictions (block the
Change) and points of attention (gaps and suggestions, never block). The last
line counts the verdicts, which is what calibration looks at.

Usage:
    uv run python scripts/calibrar_mudanca.py CHG0031001 --vezes 5
    uv run python scripts/calibrar_mudanca.py CHG0031002 --base https://exemplo.onrender.com
    uv run python scripts/calibrar_mudanca.py CHG0031001 --vezes 10 --paralelo 5
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from typing import Any

DEFAULT_BASE = "http://localhost:8000"


def evaluate(base: str, number: str, client_id: str, timeout: float) -> dict[str, Any]:
    """One fresh evaluation, as the page asks for it."""
    request = urllib.request.Request(
        f"{base.rstrip('/')}/api/changes/{number}/evaluate",
        data=json.dumps({"fresh": True}).encode(),
        headers={"Content-Type": "application/json", "X-Client-Id": client_id},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body: dict[str, Any] = json.loads(response.read().decode("utf-8"))
    return body


def report(run: int, body: dict[str, Any]) -> str:
    """The lines for one run."""
    decision = body.get("decision") or {}
    verdict = "Pode seguir" if decision.get("passes") else "Não segue"
    semantic = body.get("semantic") or {}
    lines = [
        f"#{run} {verdict}  média {body.get('overall')}  "
        f"coerência {semantic.get('consistency_score', '-')}  "
        f"retorno {semantic.get('backout_adherence_percent', '-')}%",
        f"   portões que falharam: {', '.join(decision.get('failed') or []) or 'nenhum'}",
    ]
    if not semantic:
        lines.append(f"   coerência não rodou: {body.get('semantic_skipped_reason') or '-'}")
    for title, key in (("contradicao", "problems"), ("lacuna ou sugestao", "attention")):
        points = semantic.get(key) or []
        lines.append(f"   {title} ({len(points)})")
        lines.extend(f"     - {point}" for point in points)
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    """Parse the arguments, run the evaluations and print the tally."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("numero", help="a Mudança, por exemplo CHG0031001")
    parser.add_argument("--vezes", type=int, default=3, help="quantas avaliações (padrão 3)")
    parser.add_argument("--base", default=DEFAULT_BASE, help=f"URL da API (padrão {DEFAULT_BASE})")
    parser.add_argument("--timeout", type=float, default=120.0, help="segundos por chamada")
    parser.add_argument(
        "--paralelo",
        type=int,
        default=1,
        help="quantas avaliações ao mesmo tempo (padrão 1, uma depois da outra)",
    )
    args = parser.parse_args(argv)

    client_id = f"calibracao-{uuid.uuid4().hex[:8]}"

    def one(run: int) -> tuple[int, dict[str, Any] | Exception]:
        # Each run its own visitor id, so parallel runs never share a lock.
        try:
            return run, evaluate(args.base, args.numero, f"{client_id}-{run}", args.timeout)
        except Exception as error:  # noqa: BLE001 - a failed run is reported, not fatal
            return run, error

    with ThreadPoolExecutor(max_workers=max(1, args.paralelo)) as pool:
        results = list(pool.map(one, range(1, args.vezes + 1)))

    tally: Counter[str] = Counter()
    for run, outcome in results:
        if isinstance(outcome, Exception):
            print(f"#{run} falhou: {outcome}")
            tally["falhou"] += 1
            continue
        print(report(run, outcome))
        passes = (outcome.get("decision") or {}).get("passes")
        tally["Pode seguir" if passes else "Não segue"] += 1
    print("total: " + ", ".join(f"{verdict} {count}" for verdict, count in tally.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
