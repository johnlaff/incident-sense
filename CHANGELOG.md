# Changelog

Todas as mudanças notáveis deste projeto são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [1.0.0] - 2026-06-25

### Adicionado

- Renderização **markdown** da sugestão da Aurora (`react-markdown` + `remark-gfm`),
  com as citações `[INC…]` como **botões clicáveis** e tom **didático** (siglas
  explicadas via glossário no prompt, ex.: DICT).
- **Seletor de modelo real**: `POST /api/suggest` aceita um campo `model` mapeado
  para um modelo da OpenRouter via a allow-list `SELECTABLE_MODELS` (`openrouter/auto`,
  `deepseek-v4`, `qwen3-max`, `gemini-flash`, `claude-haiku`), todos testados.

### Alterado

- A **classificação** passou a julgar se o chamado é **um incidente de verdade**
  (independente de haver casos parecidos): `IMPROCEDENTE` = autoatendimento/não
  incidente; um incidente real **sem** base parecida vira `PROCEDENTE` sem sugestão.

### Corrigido

- Copy do caso improcedente (orienta autoatendimento, não mais "sem base
  operacional") e legibilidade da sugestão (lista numerada com espaçamento).

## [0.1.0] - 2026-06-22

### Adicionado

- Sugestão de resolução (RAG) em `POST /api/suggest`: resumo → embed →
  pré-filtro → busca vetorial → pós-filtro por LLM → classificação → sugestão
  fundamentada, com transparência de scores e decisões.
- Detecção de recorrência em `GET /api/clusters`: resultado de clustering
  (BERTopic) pré-computado e servido offline.
- Gerador de dataset sintético (arquétipos bancários + ruído + 3 incidentes-demo)
  e artefatos commitados (`incidents.json`, embeddings, clustering).
- Mapa animado em WebGL (regl-scatterplot): "Cluster Reveal" e "RAG Neighbor
  Flight" com painel de transparência.
- Stack local via Docker Compose (Qdrant + API + web), com auto-seed na subida.
- CI (backend e frontend), release por tag para o GHCR e Dependabot.
- Documentação em PT-BR e ADRs.

[1.0.0]: https://github.com/johnlaff/incident-sense/releases/tag/v1.0.0
[0.1.0]: https://github.com/johnlaff/incident-sense/releases/tag/v0.1.0
