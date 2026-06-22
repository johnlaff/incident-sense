# ADR 0005 — Qdrant como banco vetorial

- Status: Aceito
- Data: 2026-06-22

## Contexto

O RAG precisa de busca por similaridade sobre incidentes resolvidos, rodando
localmente em container e com filtro por metadados (categoria, serviço, tags).

## Decisão

Usar **Qdrant** local (Docker). A coleção é criada com vetores de **3072**
dimensões e distância **cosseno**. Cada ponto guarda no _payload_ os metadados
do incidente, permitindo o **pré-filtro** opcional antes da busca vetorial.

A busca usa a API **`query_points`** (a `search` foi descontinuada no cliente).
A ingestão usa os embeddings já commitados, então **semear o Qdrant não faz
nenhuma chamada de API**; na subida da API há um _self-seeding_ idempotente.

## Consequências

- Sobe junto no `docker compose`, sem serviço externo.
- IDs dos pontos são UUIDs determinísticos derivados do número do incidente
  (Qdrant exige id inteiro ou UUID; o número legível fica no payload).

## Alternativas consideradas

- FAISS/Chroma em processo: Qdrant oferece API HTTP, filtros ricos e dashboard,
  melhores para demonstrar o fluxo.
- pgvector: traria um Postgres só para isso; mais peso do que o necessário.
