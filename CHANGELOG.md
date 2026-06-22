# Changelog

Todas as mudanças notáveis deste projeto são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

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

[0.1.0]: https://github.com/johnlaff/incident-sense/releases/tag/v0.1.0
