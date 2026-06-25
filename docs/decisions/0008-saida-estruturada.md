# ADR 0008 — Saída estruturada via JSON no prompt + pydantic

- Status: Aceito
- Data: 2026-06-22

## Contexto

O pós-filtro e a classificação precisam de saída estruturada (JSON). Testamos o
`response_format` (JSON mode) e o _function calling_, mas o provedor que o
OpenRouter roteia para o `deepseek-v4-flash` **não os suporta de forma
confiável** (retorna conteúdo vazio).

## Decisão

Instruir o modelo a responder **apenas com JSON no prompt** e validar a saída
com **pydantic**. Um extrator tolerante (`extract_json` / `extract_json_objects`
em `providers.py`) lida com cercas de código, prosa ao redor e até arrays
truncados (recupera os objetos completos).

## Consequências

- Portável entre provedores (não depende de recursos específicos da API).
- A validação pydantic dá a mesma garantia de esquema que o _structured output_
  nativo daria.
- Em caso de falha de parsing, há _fallbacks_ seguros (ex.: se o JSON da
  classificação não validar, usa-se o sinal de recuperação como heurística —
  com candidato sobrevivente trata como incidente real, senão `IMPROCEDENTE`).

## Alternativas consideradas

- `response_format={"type":"json_object"}`: indisponível no provedor padrão.
- _Function calling_ / `structured_predict` do LlamaIndex: mesma limitação do
  provedor; ver [[0002-llamaindex-no-rag]].
