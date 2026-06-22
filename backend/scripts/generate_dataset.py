"""Generate the synthetic incident dataset for incident-sense.

Strategy:
    * For each banking *archetype* (see incident_sense.data.archetypes), ask the
      LLM for many paraphrased incidents so the archetype forms a recoverable
      cluster and a body of known resolutions (the RAG knowledge base).
    * Add a pile of unrelated *noise* incidents (singletons) to exercise
      HDBSCAN noise handling and the RAG "IMPROCEDENTE" path.
    * Wrap every text in ServiceNow-style structural fields using Faker (pt_BR),
      with business-hours-skewed timestamps and a fixed seed.
    * Inject realistic mess (typos, truncated text, mis-routed teams) into a
      subset, and plant exactly 3 clearly-tagged demo-driver incidents.

Determinism: the structural layer is seeded; the text layer comes from the LLM
(run once and committed). The committed incidents.json is the source of truth —
regeneration reproduces the *process*, not byte-identical text.

Usage:
    uv run python scripts/generate_dataset.py            # full dataset
    uv run python scripts/generate_dataset.py --scale 0.1  # quick smoke run
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections.abc import Callable
from datetime import datetime, timedelta
from pathlib import Path

from faker import Faker
from openai import OpenAI

from incident_sense.config import get_settings
from incident_sense.data.archetypes import (
    ARCHETYPES,
    ASSIGNMENT_GROUPS,
    Archetype,
)
from incident_sense.models import Impact, Incident, IncidentState, Priority, Urgency
from incident_sense.providers import (
    chat_text,
    extract_json,
    extract_json_objects,
    make_chat_client,
)

SEED = 42
# Anchor "now" so timestamps are deterministic and stay recent relative to the
# workshop date (June 2026). Incidents span the ~90 days before this.
REFERENCE_NOW = datetime(2026, 6, 15, 12, 0, 0)
WINDOW_DAYS = 90
NOISE_COUNT = 70
MESS_FRACTION = 0.15
MISROUTE_FRACTION = 0.10

# State mix for archetype incidents: most are resolved/closed (so they become
# RAG knowledge); a few stay open to look realistic.
STATE_WEIGHTS: dict[IncidentState, float] = {
    IncidentState.RESOLVED: 0.55,
    IncidentState.CLOSED: 0.25,
    IncidentState.IN_PROGRESS: 0.10,
    IncidentState.ON_HOLD: 0.05,
    IncidentState.NEW: 0.05,
}
RESOLVED_STATES = (IncidentState.RESOLVED, IncidentState.CLOSED)


# --------------------------------------------------------------------------- #
# LLM text generation
# --------------------------------------------------------------------------- #
def _generation_system_prompt() -> str:
    return (
        "Você é um analista de operações de TI do banco fictício 'Banco "
        "Meridiano'. Você escreve chamados de incidente realistas em "
        "português do Brasil. Nunca cite empresas, produtos ou pessoas reais. "
        "Responda SEMPRE apenas com JSON válido, sem texto fora do JSON e sem "
        "cercas de código."
    )


def _archetype_user_prompt(archetype: Archetype, count: int, variation: int) -> str:
    hints = "; ".join(archetype.symptom_hints)
    return (
        f"Gere {count} variações DISTINTAS de chamados de incidente sobre a "
        f"seguinte causa-raiz:\n\n"
        f"Tema: {archetype.theme}\n"
        f"Sintomas típicos: {hints}\n"
        f"Resolução canônica (para inspirar as notas de resolução): "
        f"{archetype.canonical_resolution}\n\n"
        "Varie bastante o vocabulário, o nível de detalhe e a perspectiva "
        "(ora cliente, ora analista, ora monitoração). Mantenha todos "
        "claramente ligados à MESMA causa-raiz. "
        f"(lote {variation}) "
        "Devolva um array JSON onde cada item tem exatamente as chaves: "
        '"short_description" (uma linha, até ~80 caracteres), '
        '"description" (2 a 4 frases), '
        '"resolution_notes" (2 a 3 frases, como se escritas por quem resolveu).'
    )


def _noise_user_prompt(count: int, variation: int) -> str:
    return (
        f"Gere {count} chamados de incidente ISOLADOS e ÚNICOS de um banco "
        "fictício, cada um sobre um assunto COMPLETAMENTE DIFERENTE dos outros "
        "e que NÃO formam um grupo. Espalhe por domínios bem distintos, por "
        "exemplo: ar-condicionado da sala de reuniões, catraca/crachá, "
        "cafeteira, ramal telefônico específico, projetor, relatório de RH com "
        "coluna errada, divergência em nota fiscal de fornecedor, mouse sem "
        "fio, certificado de um sistema interno raro, vaga de garagem, "
        "elevador, água/dedetização, licença de software específica, "
        "teclado com tecla travada, câmera de segurança, etc. "
        "NÃO os agrupe sob 'suporte de TI'; cada chamado deve parecer um "
        "evento avulso e incomum. "
        f"(lote {variation}, use temas inéditos) "
        "Devolva um array JSON onde cada item tem as chaves: "
        '"short_description", "description", "resolution_notes".'
    )


def _request_items(
    client: OpenAI, model: str, system: str, user: str, *, expected: int
) -> list[dict[str, str]]:
    """Ask the LLM for a JSON array of items, with a couple of retries."""
    for attempt in range(3):
        try:
            raw = chat_text(
                client,
                model,
                [{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0.95,
                max_tokens=min(8192, 240 * expected + 256),
            )
            try:
                data = extract_json(raw)
            except ValueError:
                data = None
            if isinstance(data, dict):
                # Some models wrap the array in a key; take the first list value.
                data = next((v for v in data.values() if isinstance(v, list)), None)
            if not isinstance(data, list) or not data:
                # Salvage complete objects from a truncated/garbled array.
                data = extract_json_objects(raw)
            items = [
                {
                    "short_description": str(item["short_description"]).strip(),
                    "description": str(item["description"]).strip(),
                    "resolution_notes": str(item.get("resolution_notes", "")).strip(),
                }
                for item in data
                if isinstance(item, dict) and item.get("short_description")
            ]
            if items:
                return items
        except (ValueError, KeyError, TypeError) as exc:
            print(f"  retry {attempt + 1}/3 after parse error: {exc}", file=sys.stderr)
    return []


def generate_texts(
    client: OpenAI,
    model: str,
    system: str,
    prompt_fn: Callable[[int, int], str],
    target: int,
) -> list[dict[str, str]]:
    """Collect ``target`` unique text items, batching LLM calls and deduping."""
    batch_size = 14
    collected: list[dict[str, str]] = []
    seen: set[str] = set()
    variation = 0
    while len(collected) < target and variation < target // batch_size + 8:
        variation += 1
        remaining = target - len(collected)
        ask = min(batch_size, remaining + 4)
        user = prompt_fn(ask, variation)
        for item in _request_items(client, model, system, user, expected=ask):
            key = item["short_description"].lower()
            if key and key not in seen:
                seen.add(key)
                collected.append(item)
        print(f"  collected {len(collected)}/{target}", file=sys.stderr)
    return collected[:target]


# --------------------------------------------------------------------------- #
# Structural assembly
# --------------------------------------------------------------------------- #
def _business_datetime(rng: random.Random) -> datetime:
    """A timestamp in the last WINDOW_DAYS, skewed to weekday business hours."""
    day = REFERENCE_NOW - timedelta(days=rng.randint(0, WINDOW_DAYS))
    # Re-roll weekends most of the time so weekdays dominate.
    while day.weekday() >= 5 and rng.random() < 0.8:
        day -= timedelta(days=rng.randint(1, 3))
    hour = rng.choices(
        population=list(range(0, 24)),
        weights=[1 if h < 7 or h > 20 else 6 for h in range(24)],
    )[0]
    return day.replace(hour=hour, minute=rng.randint(0, 59), second=0, microsecond=0)


def _pick_state(rng: random.Random) -> IncidentState:
    states = list(STATE_WEIGHTS)
    return rng.choices(states, weights=[STATE_WEIGHTS[s] for s in states])[0]


def _vary_level(rng: random.Random, value: int, low: int, high: int) -> int:
    """Nudge a priority/impact/urgency by at most one step, within bounds."""
    return max(low, min(high, value + rng.choice((-1, 0, 0, 1))))


def _inject_typos(text: str, rng: random.Random) -> str:
    """Swap a couple of adjacent characters to mimic real typos."""
    chars = list(text)
    for _ in range(rng.randint(1, 2)):
        if len(chars) > 4:
            i = rng.randint(0, len(chars) - 2)
            chars[i], chars[i + 1] = chars[i + 1], chars[i]
    return "".join(chars)


def _maybe_make_messy(
    rng: random.Random,
    short_desc: str,
    description: str,
    assignment_group: str,
) -> tuple[str, str, str, bool]:
    """Optionally degrade a ticket the way real intake data is degraded."""
    messy = False
    if rng.random() < MESS_FRACTION:
        messy = True
        choice = rng.random()
        if choice < 0.4:
            short_desc = _inject_typos(short_desc, rng)
        elif choice < 0.7:
            # Truncate to the first sentence to mimic an incomplete report.
            description = description.split(".")[0].strip() + "."
        else:
            short_desc = _inject_typos(short_desc, rng)
            description = description.split(".")[0].strip() + "."
    if rng.random() < MISROUTE_FRACTION:
        messy = True
        assignment_group = rng.choice([g for g in ASSIGNMENT_GROUPS if g != assignment_group])
    return short_desc, description, assignment_group, messy


def build_incident(
    rng: random.Random,
    faker: Faker,
    number: str,
    item: dict[str, str],
    *,
    archetype: Archetype | None,
    cmdb_ci: str,
    category: str,
    subcategory: str,
    assignment_group: str,
    base_priority: Priority,
    base_impact: Impact,
    base_urgency: Urgency,
    close_code: str,
    tags: list[str],
) -> Incident:
    """Wrap one generated text item in full structural fields."""
    state = _pick_state(rng)
    opened_at = _business_datetime(rng)

    short_desc, description, assignment_group, messy = _maybe_make_messy(
        rng, item["short_description"], item["description"], assignment_group
    )

    resolved_at: datetime | None = None
    closed_at: datetime | None = None
    resolution_notes: str | None = None
    used_close_code: str | None = None
    if state in RESOLVED_STATES and item.get("resolution_notes"):
        resolved_at = opened_at + timedelta(minutes=rng.randint(20, 60 * 36))
        resolution_notes = item["resolution_notes"]
        used_close_code = close_code
        if state == IncidentState.CLOSED:
            closed_at = resolved_at + timedelta(hours=rng.randint(2, 72))

    work_notes: str | None = None
    if rng.random() < 0.5:
        work_notes = f"Acionado {faker.first_name()} ({assignment_group}) para análise."

    final_tags = [*tags]
    if messy:
        final_tags.append("dados-incompletos")

    return Incident(
        number=number,
        short_description=short_desc,
        description=description,
        category=category,
        subcategory=subcategory,
        cmdb_ci=cmdb_ci,
        assignment_group=assignment_group,
        priority=Priority(_vary_level(rng, base_priority, 1, 4)),
        impact=Impact(_vary_level(rng, base_impact, 1, 3)),
        urgency=Urgency(_vary_level(rng, base_urgency, 1, 3)),
        state=state,
        opened_at=opened_at,
        resolved_at=resolved_at,
        closed_at=closed_at,
        resolution_notes=resolution_notes,
        close_code=used_close_code,
        work_notes=work_notes,
        tags=final_tags,
    )


def planted_demo_incidents(rng: random.Random, start_number: int) -> list[Incident]:
    """The 3 hand-crafted incidents that drive the live RAG demo."""
    base = REFERENCE_NOW - timedelta(hours=3)

    def make(
        idx: int,
        *,
        priority: Priority = Priority.HIGH,
        impact: Impact = Impact.HIGH,
        urgency: Urgency = Urgency.HIGH,
        **kwargs: object,
    ) -> Incident:
        return Incident(
            number=f"INC{start_number + idx:07d}",
            state=IncidentState.NEW,
            opened_at=base + timedelta(minutes=idx * 7),
            priority=priority,
            impact=impact,
            urgency=urgency,
            **kwargs,  # type: ignore[arg-type]
        )

    return [
        make(
            0,
            short_description="Pix confirmado para o cliente mas sem comprovante há 2h",
            description=(
                "Cliente concluiu um Pix pelo app, o valor foi debitado, mas o "
                "comprovante não foi gerado e o status segue pendente há cerca "
                "de duas horas. Outros relatos parecidos chegando ao N1."
            ),
            category="Pagamentos",
            subcategory="Pix",
            cmdb_ci="PIX-Core",
            assignment_group="Service-Desk-N1",
            tags=["demo", "procedente"],
        ),
        make(
            1,
            short_description="App às vezes lento e recusa pagamento ao abrir extrato",
            description=(
                "Cliente relata que o aplicativo fica lento em alguns momentos "
                "e, ao abrir o extrato, uma compra no cartão foi recusada. Não "
                "está claro se é um problema de canal, de cartão ou de conta."
            ),
            category="Canais Digitais",
            subcategory="App Mobile",
            cmdb_ci="App-Mobile",
            assignment_group="Service-Desk-N1",
            tags=["demo", "borderline"],
        ),
        make(
            2,
            short_description="Esqueci minha senha do internet banking",
            description=(
                "Cliente diz que esqueceu a senha de acesso ao internet banking "
                "e quer saber como redefinir. Não há indício de falha técnica "
                "no serviço."
            ),
            category="Acesso",
            subcategory="Senha",
            cmdb_ci="Login-IDP",
            assignment_group="Service-Desk-N1",
            priority=Priority.LOW,
            impact=Impact.LOW,
            urgency=Urgency.LOW,
            tags=["demo", "improcedente"],
        ),
    ]


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the synthetic dataset.")
    parser.add_argument(
        "--scale", type=float, default=1.0, help="Scale counts (0-1) for quick runs."
    )
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--out", default=None, help="Output path (defaults to configured).")
    args = parser.parse_args()

    settings = get_settings()
    rng = random.Random(args.seed)
    faker = Faker("pt_BR")
    faker.seed_instance(args.seed)
    client = make_chat_client(settings)
    model = settings.llm_model
    system = _generation_system_prompt()

    incidents: list[Incident] = []
    number_counter = rng.randint(10_000, 60_000)

    def next_number() -> str:
        nonlocal number_counter
        number_counter += rng.randint(1, 4)
        return f"INC{number_counter:07d}"

    # --- Archetype incidents -------------------------------------------------
    for archetype in ARCHETYPES:
        target = max(6, int(archetype.n_variations * args.scale))
        print(f"[{archetype.id}] generating {target} incidents...", file=sys.stderr)
        items = generate_texts(
            client,
            model,
            system,
            lambda c, v, a=archetype: _archetype_user_prompt(a, c, v),
            target,
        )
        for item in items:
            incidents.append(
                build_incident(
                    rng,
                    faker,
                    next_number(),
                    item,
                    archetype=archetype,
                    cmdb_ci=archetype.cmdb_ci,
                    category=archetype.category,
                    subcategory=archetype.subcategory,
                    assignment_group=archetype.assignment_group,
                    base_priority=archetype.typical_priority,
                    base_impact=archetype.typical_impact,
                    base_urgency=archetype.typical_urgency,
                    close_code=archetype.close_code,
                    tags=list(archetype.tags),
                )
            )

    # --- Noise incidents -----------------------------------------------------
    noise_target = max(6, int(NOISE_COUNT * args.scale))
    print(f"[noise] generating {noise_target} unrelated incidents...", file=sys.stderr)
    noise_items = generate_texts(client, model, system, _noise_user_prompt, noise_target)
    for item in noise_items:
        incidents.append(
            build_incident(
                rng,
                faker,
                next_number(),
                item,
                archetype=None,
                cmdb_ci=rng.choice(
                    ("Estacao-Trabalho", "Rede-Corporativa", "Email-Corporativo", "VPN-Acesso")
                ),
                category="Suporte Interno",
                subcategory="Diversos",
                assignment_group="Service-Desk-N1",
                base_priority=Priority.LOW,
                base_impact=Impact.LOW,
                base_urgency=Urgency.MEDIUM,
                close_code="Resolvido (Contorno)",
                tags=["ruido", "suporte-interno"],
            )
        )

    # --- Planted demo incidents ---------------------------------------------
    incidents.extend(planted_demo_incidents(rng, number_counter + 100))

    # Shuffle so the file is not grouped by archetype, then sort by opened date.
    rng.shuffle(incidents)
    incidents.sort(key=lambda inc: inc.opened_at)

    out_path = settings.incidents_path if args.out is None else Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = [json.loads(inc.model_dump_json()) for inc in incidents]
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    resolved = sum(1 for inc in incidents if inc.is_resolved)
    print(
        f"\nWrote {len(incidents)} incidents to {out_path} "
        f"({resolved} resolved/with-notes for the RAG knowledge base).",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
