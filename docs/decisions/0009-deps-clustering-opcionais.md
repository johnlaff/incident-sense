# ADR 0009 — Dependências de clustering como extra opcional

- Status: Aceito
- Data: 2026-06-22

## Contexto

BERTopic/UMAP/HDBSCAN são pesados, mas a rota `GET /api/clusters` apenas serve
um JSON pré-computado e commitado — não precisa dessas bibliotecas em tempo de
execução.

## Decisão

Declarar `bertopic`, `umap-learn`, `hdbscan`, `scikit-learn`, `numba` e
`pynndescent` como o extra opcional **`clustering`** no `pyproject.toml`. Elas só
são necessárias para **recomputar** os artefatos (`scripts/precompute.py`).

O CI e a imagem de runtime instalam sem o extra; os imports pesados são feitos
**lazy** dentro das funções que os usam.

## Consequências

- Imagem e ambiente de testes mais leves e rápidos.
- Quem vai recomputar instala com `uv sync --all-extras`.

## Nota de versões

Foi necessário fixar pisos modernos de `numba`/`pynndescent`: sem isso o
resolvedor regredia para uma `llvmlite` antiga que não compila em Python 3.12.
