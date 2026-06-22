# Contribuindo

Obrigado pelo interesse! Este é um projeto de demonstração open-source, mas
contribuições são bem-vindas.

## Pré-requisitos

- Docker + Docker Compose (para rodar tudo junto)
- Para desenvolvimento local: [`uv`](https://docs.astral.sh/uv/) (backend) e
  Node 24+ (frontend)

## Rodando localmente

```bash
cp .env.example .env     # preencha suas chaves
docker compose up        # abra http://localhost:3000
```

Sem Docker, em dois terminais:

```bash
make setup    # instala backend (uv) e frontend (npm)
make api      # API em http://localhost:8000
make web      # frontend em http://localhost:3000
```

> O Qdrant precisa estar de pé para o "suggest". Suba só ele com
> `docker compose up qdrant` e rode `make seed` (carrega os dados commitados,
> sem chamadas de API).

## Comandos (Makefile)

| Comando           | O que faz                                            |
| ----------------- | ---------------------------------------------------- |
| `make setup`      | Instala dependências de backend e frontend           |
| `make up` / `down`| Sobe / derruba o stack via Docker Compose            |
| `make seed`       | Carrega dataset + embeddings no Qdrant               |
| `make generate`   | Regenera o dataset sintético (usa LLM)               |
| `make precompute` | Recomputa embeddings + clustering + rótulos          |
| `make lint`       | ruff (backend) + eslint (frontend)                   |
| `make fmt`        | Formata backend (ruff) e frontend (prettier)         |
| `make typecheck`  | mypy (backend) + tsc (frontend)                      |
| `make test`       | pytest (backend) + vitest (frontend)                 |
| `make check`      | `lint` + `typecheck` + `test`                        |

## Convenções

- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:`, …), pequenos e lógicos.
- **Código, comentários e docstrings em inglês** (padrão de codebase). A
  documentação conceitual (README, `docs/`) é em **português**.
- **Qualidade**: `make check` precisa passar (ruff + mypy + pytest no backend;
  eslint + tsc + vitest no frontend). O CI roda os mesmos gates.
- **Tipos**: Python com type hints e `mypy` limpo; TypeScript em modo `strict`,
  sem `any`.

## Pull Requests

1. Crie um branch a partir de `main`.
2. Faça `make check` passar.
3. Abra o PR descrevendo o **porquê** da mudança.

Ao participar, você concorda com o nosso
[Código de Conduta](CODE_OF_CONDUCT.md).
