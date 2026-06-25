# ADR 0004 — Divisão OpenRouter (chat) + OpenAI (embeddings)

- Status: Aceito
- Data: 2026-06-22

## Contexto

Precisamos de um LLM de chat/raciocínio e de um modelo de embeddings. Queremos
flexibilidade de modelo de chat sem abrir mão de embeddings de alta qualidade.

## Decisão

- **Embeddings** sempre na **OpenAI** (`text-embedding-3-large`, 3072 dimensões;
  o tamanho do vetor da coleção Qdrant é fixado em 3072).
- **Chat/raciocínio e rotulagem de clusters** via **OpenRouter** (API
  compatível com a OpenAI, `base_url=https://openrouter.ai/api/v1`). Modelo
  padrão configurável por env (`LLM_MODEL`, padrão `deepseek/deepseek-v4-flash`).
- **Seleção de modelo por requisição:** o `POST /api/suggest` aceita um campo
  `model` (id público) que o backend mapeia para um modelo real da OpenRouter via
  a allow-list `SELECTABLE_MODELS` (`config.py`) — hoje `openrouter/auto`,
  `deepseek-v4`, `qwen3-max`, `gemini-flash` e `claude-haiku`, cada um testado
  ponta a ponta. Ids fora da allow-list caem no padrão (limita custo e abuso).

Como OpenRouter é compatível com a OpenAI, o **mesmo** cliente (`openai.OpenAI`)
atende aos dois — muda apenas `base_url`, chave e nome do modelo. O `base_url`
do chat é configurável (`LLM_BASE_URL`), então o código aponta para OpenRouter,
OpenAI ou qualquer gateway compatível sem alteração.

## Consequências

- Troca de modelo de chat por variável de ambiente **e por requisição** (o
  seletor da Aurora na UI), sem mudar o código.
- Custo baixo (centavos); só o caminho "suggest" faz chamadas ao vivo.
- Requer `OPENAI_API_KEY` e `OPENROUTER_API_KEY`.

## Alternativas consideradas

- Tudo na OpenAI: menos flexibilidade de modelo de chat.
- Tudo no OpenRouter (inclusive embeddings): preferimos os embeddings nativos
  da OpenAI e a dimensionalidade conhecida (3072).
