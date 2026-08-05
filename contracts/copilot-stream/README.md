# Contrato do protocolo SSE do copiloto — fixtures compartilhadas

Fonte única de verdade do protocolo de streaming v1 do copiloto contextual de
incidentes. As fixtures deste diretório são lidas pelas duas suítes de teste —
pytest (`backend/tests/test_copilot_stream_contract.py`) e Vitest
(`frontend/tests/copilot-stream.test.ts`) — sem cópia duplicada: um contrato,
dois leitores.

## Protocolo v1

Todo evento viaja num envelope discriminado:

| Campo | Tipo | Regra |
|---|---|---|
| `protocol_version` | `"1"` | Versão desconhecida rejeita o stream inteiro. |
| `turn_id` | UUID | Constante dentro do stream. |
| `sequence` | inteiro ≥ 1 | Estritamente monotônica, começa em 1. |
| `type` | discriminador | Um dos seis tipos abaixo. |

Seis tipos de evento — e somente estes (não existe `answer.delta`):

| `type` | Payload | Terminal? |
|---|---|---|
| `turn.accepted` | `incident_number`, `locale` (`pt-BR`\|`en`), `model_requested` | não |
| `phase.changed` | `phase` (`policy`\|`classify`\|`rewrite`\|`retrieve`\|`answer`\|`validate`), `status` (`started`\|`completed`), `duration_ms` (só em `completed`) | não |
| `retrieval.completed` | `query`, `candidates[]` (`number`, `short_description`, `similarity`, `survived_postfilter`, `postfilter_reason`) | não |
| `answer.completed` | `answer` (`CopilotAnswer`), `sources[]` (derivadas dos blocos), `telemetry[]` (por chamada; campos ausentes ficam nulos, nunca inferidos) | **sim** |
| `turn.failed` | `code`, `message` segura, `retryable`, `retry_after_ms?` | **sim** |
| `turn.cancelled` | `reason` | **sim** |

Exatamente um evento terminal por stream, sempre o último.

`CopilotAnswer` tem três dimensões ortogonais e cinco tipos de bloco:

- `kind`: `general_explanation` | `grounded_answer` | `no_evidence` | `refusal`
- `incident_classification`: `verdict` (`PROCEDENTE`\|`IMPROCEDENTE`) + `justification`
- `grounding`: `cited` | `no_historical_evidence` | `not_required`
- `blocks[]`: `explanation` | `diagnosis` | `action` | `caveat` | `question`,
  cada um com `text` e `citations[]`
- Invariante estrutural: blocos `diagnosis` e `action` exigem ≥ 1 citação;
  `question` é não-operacional e dispensa citações.

## Formato das fixtures

Cada arquivo JSON descreve um stream como chegaria no fio:

```json
{
  "description": "…",
  "chunks": ["event: …\nid: …\ndata: {…}\n\n", "…"],
  "expect": { "outcome": "ok", "event_count": 15, "terminal_type": "answer.completed" }
}
```

- `chunks` são fatias de texto SSE na ordem de chegada. Um chunk pode conter
  vários eventos ou terminar no meio de uma linha (`valid/split-chunks-mid-event.json`)
  — o leitor remonta antes de interpretar. Só as linhas `data:` carregam o
  payload; `event:` e `id:` são diagnóstico.
- `expect.outcome` é `"ok"` (stream aceito; confira `event_count` e
  `terminal_type`) ou `"error"` com um `error_code` do contrato:

| `error_code` | Quando |
|---|---|
| `unknown_protocol_version` | `protocol_version` fora do contrato |
| `unknown_event_type` | `type` fora dos seis tipos |
| `invalid_event` | payload que viola o schema ou uma invariante estrutural |
| `out_of_order_sequence` | `sequence` menor que a anterior |
| `duplicate_sequence` | `sequence` igual à anterior |
| `missing_terminal` | EOF sem evento terminal |
| `event_after_terminal` | qualquer evento depois do terminal |

Os dois leitores devem aceitar todos os casos de `valid/` e rejeitar cada caso
de `invalid/` com o `error_code` esperado.
