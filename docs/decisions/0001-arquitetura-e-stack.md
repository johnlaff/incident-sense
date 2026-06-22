# ADR 0001 — Arquitetura e stack

- Status: Aceito
- Data: 2026-06-22

## Contexto

O `incident-sense` precisa entregar duas capacidades — sugestão de resolução
(RAG) e detecção de recorrência (clustering) — rodando 100% localmente, com
um único comando, e ser legível tanto para iniciantes quanto para engenheiros
seniores.

## Decisão

Adotar um **monólito simples** com três peças:

- **API** em Python 3.12 + FastAPI (backend RAG e serviço de clusters).
- **Frontend** em Next.js (App Router) + TypeScript + Tailwind + shadcn/ui.
- **Qdrant** como banco vetorial, em container.

Tudo orquestrado por `docker compose up`. Sem microsserviços, sem serviços
gerenciados, sem nuvem. As únicas chamadas externas são às APIs de LLM e
embedding.

## Consequências

- Onboarding trivial: clonar, copiar `.env`, subir.
- Menos partes móveis para entender e manter.
- Não escala horizontalmente "de fábrica" — aceitável por ser um demo/portfólio.

## Alternativas consideradas

- Separar serviços (ingestão, RAG, clustering): rejeitado por _over-engineering_
  para o escopo.
- Banco vetorial gerenciado (nuvem): rejeitado pela exigência de execução local.
