> 🇺🇸 English version: [README.en.md](README.en.md)

# incident-sense

[![backend-ci](https://github.com/johnlaff/incident-sense/actions/workflows/backend-ci.yml/badge.svg)](https://github.com/johnlaff/incident-sense/actions/workflows/backend-ci.yml)
[![frontend-ci](https://github.com/johnlaff/incident-sense/actions/workflows/frontend-ci.yml/badge.svg)](https://github.com/johnlaff/incident-sense/actions/workflows/frontend-ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Quando um banco grande tem um problema de TI — o Pix parando, o app recusando
login, o boleto não saindo — duas perguntas surgem na operação:

1. **Já resolvemos isso antes? Como?** O analista perde tempo procurando um
   chamado antigo parecido em meio a milhares.
2. **Isso está virando recorrência?** Vários incidentes parecidos podem ser, na
   verdade, o **mesmo** problema de fundo — e ninguém percebe no meio do volume.

O **incident-sense** ataca as duas:

- **Sugestão de resolução (RAG):** para um novo incidente, recupera incidentes
  passados **resolvidos** semelhantes e sugere uma resolução **fundamentada**,
  mostrando em quais chamados se baseou e por quê.
- **Detecção de recorrência (clustering):** agrupa os incidentes recentes e
  revela os problemas recorrentes num **mapa animado**, com nomes de grupo
  gerados por IA.

> Tudo com dados **sintéticos** de um banco **fictício** ("Banco Meridiano").
> Nenhum dado real, nenhuma empresa real.

## Demo

| Detecção de recorrência (clustering) | Sugestão de resolução (RAG) |
| --- | --- |
| ![Mapa de recorrência](docs/assets/cluster-reveal.png) | ![Sugestão RAG](docs/assets/rag-suggest.png) |

À esquerda, os incidentes recentes agrupados num mapa animado com nomes de grupo
gerados por IA. À direita, um novo incidente "voa" até seus vizinhos mais
parecidos enquanto o painel mostra cada passo do raciocínio.

## Começar (um comando)

Pré-requisitos: Docker. Só isso.

```bash
git clone https://github.com/johnlaff/incident-sense.git
cd incident-sense
cp .env.example .env      # adicione suas chaves (OpenAI + OpenRouter)
docker compose up         # abra http://localhost:3000
```

O dataset e os resultados de clustering já vêm **commitados**, então o mapa de
recorrência funciona **na hora**, offline. Só a sugestão interativa (RAG) faz
chamadas de API ao vivo (custo de centavos).

> Sem as chaves no `.env`, o mapa de clusters funciona normalmente; o "suggest"
> mostra uma mensagem amigável pedindo as chaves.

## Como funciona

Este README é sobre o **problema**. Para o _como_ — stack, os dois fluxos e as
decisões de arquitetura — veja:

- [docs/architecture.md](docs/architecture.md) — visão geral e stack
- [docs/rag-flow.md](docs/rag-flow.md) — o fluxo de sugestão (RAG)
- [docs/clustering-flow.md](docs/clustering-flow.md) — a detecção de recorrência
- [docs/data-generation.md](docs/data-generation.md) — como os dados sintéticos
  são gerados
- [docs/decisions/](docs/decisions/) — ADRs (por que LlamaIndex, BERTopic,
  Qdrant, etc.)

## Desenvolvimento

```bash
make setup    # instala backend (uv) e frontend (npm)
make check    # lint + typecheck + test (backend e frontend)
```

Veja [CONTRIBUTING.md](CONTRIBUTING.md) para todos os comandos.

## Licença

[MIT](LICENSE).
