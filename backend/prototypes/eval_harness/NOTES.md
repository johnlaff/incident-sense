# Protótipo — harness bilíngue de evals conversacionais

> **PROTOTYPE — throwaway.** Código descartável que responde ao ticket #22 do
> mapa #13. Não é o backend de produção; é evidência concreta para fixar a
> **forma** do harness. Absorver a decisão e apagar.

## Pergunta (ticket #22)

Qual formato concreto de **dataset, adapter, runner, graders, relatórios e
integração de CI** torna o contrato de avaliação (#20) executável, reproduzível e
provider-neutral *nesta* codebase?

## Como rodar

```bash
cd backend
uv run python -m prototypes.eval_harness.build_manifest        # (re)gera dataset/manifest.json
uv run python -m prototypes.eval_harness.run                   # runner real: sem chaves, custo ~0
uv run python -m pytest prototypes/eval_harness/test_metrics.py -q   # gate hermético (12 testes)
```

O runner grava o bundle em `_artifacts/` (gitignored) e imprime `summary.md` +
a comparação de juízes.

## O que foi construído (a forma)

| Peça | Arquivo | Estado |
| --- | --- | --- |
| Schemas Pydantic (dataset + observação + artifacts) | `schema.py` | contrato canônico |
| Métricas determinísticas puras | `metrics.py` | retrieval (P/R/hit/MRR/nDCG 0-2) + citações estruturais |
| `TargetAdapter` | `adapters.py` | in-process **implementado**, replay **implementado**, http-sse **stub** |
| Cenários que dirigem o pipeline real | `fixtures.py` | replica os fakes e reusa os **seams de DI** (`RagDeps`, o pipeline) de `tests/` |
| `JudgeAdapter` | `judges.py` | fake stub + heurístico real **implementados**, LLM ladder **stub** |
| Runner assíncrono | `runner.py` | orçamento (reserva pior-caso), concorrência, checkpoint, vetor de gates |
| Writers do bundle | `writers.py` | manifest/cases/summary(.json/.md)/junit/checksums |
| Dataset exemplo bilíngue | `dataset/` | 6 conversas PT-BR+en com `pair_id` e manifest com SHA-256 |
| Tabela de preços versionada | `pricing.py` | estimativa carimbada; reserva de orçamento + fallback quando não há custo reportado |
| Gate hermético (PR) | `test_metrics.py` | testes offline |
| Demo runnable (RC-like) | `run.py` | não é `test_*`; fora de `testpaths` |

## Alternativas realmente avaliadas (não hipotéticas) e evidência

1. **Dataset: JSONL + `manifest.json` com hashes** vs. um blob único.
   Adotado JSONL por caso + manifest com SHA-256 e `created` fixo. **Evidência**:
   `load_manifest` rejeita corpus adulterado (`test_manifest_integrity_fails_on_tamper`);
   `build_manifest` valida cada linha contra `EvalCase` e falha alto na linha ruim.

2. **TargetAdapter: in-process sobre os seams existentes** vs. esperar o endpoint
   conversacional. Adotado começar in-process: o adapter dirige o **pipeline real**
   `run_suggestion` com os fakes de `tests/conftest.py`. **Evidência**: as 6
   conversas atravessam o pipeline de verdade; o caso `general.*` **expõe** que o
   pipeline single-turn não alcança a rota `answer-general` (route mismatch
   honesto, não escondido). `HttpSseTarget` fica stub com a forma documentada
   (mapear `CopilotAnswer` → `EvalExecution`) até o #18 existir. `ReplayTarget` é
   real (reavaliar métricas sem repetir chamadas).

3. **Métricas: núcleo próprio** vs. framework como autoridade (já decidido em #16;
   o protótipo **valida**). Funções puras, nDCG conferido à mão
   (`test_ndcg_uses_graded_relevance`), denominador-zero → `not_applicable`
   (nunca 0/1 de conveniência). Citações medidas sobre a **estrutura tipada**,
   não regex — id forjado reprova o gate duro (`test_forged_citation_fails_hard_gate`).

4. **JudgeAdapter: stub determinístico vs. função heurística real** (a comparação
   que o ticket pede). **Ambos implementados e comparados na mesma porta**:

   | claim | fake-deterministic | heuristic-overlap |
   | --- | --- | --- |
   | claim fundamentado | grounded | grounded (0.43) |
   | claim alucinado | **grounded** | **ungrounded** (0.0) |

   **Evidência/veredito**: o stub aprova tudo (serve só de encanamento do gate de
   PR); o heurístico pega a alucinação **mas é cego demais** (média 0.14 nos casos
   fundamentados, porque mede sobreposição lexical). Conclusão: a porta funciona
   com grader não-trivial, e nenhum dos dois pode **gatilhar qualidade** —
   confirma a exigência de #20 de uma **escada de LLM calibrada** (stub para PR,
   LLM calibrado só no RC). O `groundedness_mean` é reportado **por juiz**, nunca
   médio entre juízes.

5. **Runner: reserva de pior-caso antes da chamada** vs. contabilizar depois.
   `BudgetLedger` mantém `committed + reserved ≤ cap` e reserva o envelope
   16k/2k tokens (#20 §12) **antes** de rodar. **Evidência**: cap zero aborta a
   suíte com resultados parciais preservados (`test_run_suite_aborts_on_tiny_budget`);
   custo reportado tem precedência, estimativa só para reserva.

6. **CI: runner real fora dos gates que custam dinheiro/tempo** vs. dentro.
   `run.py`/`runner.py` não são `test_*` e não entram em `testpaths`; `prototypes/`
   está fora de `mypy src`. **Ruff, porém, linta o protótipo**: `ruff check .` e
   `ruff format --check .` (Makefile) cobrem todo o `backend/`, e o per-file-ignore
   só relaxa docstrings dos testes (espelha `tests/*`) — então o protótipo é
   mantido lint-limpo de propósito (e o Ruff já pegou nits reais aqui). Fronteira
   exata: **fora de `pytest`/`mypy src`; dentro de `ruff`/`format`**. **Evidência**:
   `uv run pytest` (sem args) coleta só os 27 testes de `tests/` — o protótipo não
   roda no `make test`; `ruff check .`, `ruff format --check .`, `mypy src` e
   `pytest` do backend ficam **verdes** com o protótipo presente.

## Recomendação para a especificação

Adotar exatamente esta forma como contrato do harness de produção:

- **Contrato tipado próprio** (`schema.py`) como fonte de verdade; frameworks só
  atrás de adapters.
- **Três adapters de target** (in-process/http-sse/replay) sob uma porta única;
  construir na ordem in-process → replay → http-sse (após #18).
- **Métricas determinísticas puras** no gate de PR + **escada de judges calibrada**
  (nunca o heurístico) como único gatilho de qualidade semântica no RC.
- **Runner com reserva de pior-caso** e cap duro; custo de avaliação é critério de
  primeira classe.
- **Bundle sanitizado por padrão** (texto integral redigido do `cases.jsonl`
  público; diagnóstico com retenção curta).
- **Separação de CI**: gate de PR hermético; runner real como comando/target
  explícito. Alvo de Makefile sugerido (a fiar na implementação, não no protótipo):

  ```makefile
  eval-smoke: ## Roda a suíte de smoke do harness (env protegido; cap $0.10).
  	cd backend && uv run python -m incident_sense.evals.run --mode smoke
  ```

## O que permanece aberto (produção, não protótipo)

- Corpus real (~120 conversas) com revisão humana, gold graduado e calibração dos
  judges — pertence a #20/#23, não ao protótipo.
- `HttpSseTarget` real depende do endpoint conversacional (#18).
- Citações **estruturadas** de verdade (hoje o adapter faz parse de `[INC…]` do
  Markdown como stand-in) chegam com o `CopilotAnswer` do #18.
- `events.jsonl` (spans SSE) e `calibration.json` (acordo do judge) ficam como
  stubs documentados até haver stream e judge calibrado.

### Enforcement de gates: o que o veredito do protótipo cobre

O runner demonstra o **mecanismo** de vetor de gates, não a matriz de produção
inteira. Enforçado aqui: gates duros `execution`/`citation-structural`/`isolation`
por caso + **um** piso de qualidade representativo (`retrieval-recall` ≥ 0,80).
Deferido para produção (mesmo padrão, fiado quando os pisos forem ratificados
pós-baseline — #20 §7): a matriz completa de pisos (nDCG, groundedness, citation
precision/coverage, policy recall, false-refusal, retenção, contradição, delta
PT↔EN, latência), o gate duro **P0/P1 de segurança** (famílias adversariais, fora
do corpus benigno) e o regime de erro/rerun de execução (≤2% + suíte inválida).
Groundedness **não** pode gatilhar aqui: o único judge real do protótipo é o
heurístico não-calibrado.

## Veredito do protótipo

_A preencher por João:_ a forma está aprovada para virar spec (`to-spec`)?
Ajustes antes de absorver? Após o aceite, apagar `prototypes/eval_harness/`.
