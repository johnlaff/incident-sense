# Contribuindo

Obrigado pelo interesse! Este é um projeto de demonstração open-source, e
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

> A API precisa de um Qdrant. O jeito mais simples é `QDRANT_URL=:memory:` no
> `.env`: o Qdrant roda dentro da API e é semeado no boot com os vetores
> commitados, como na demo pública. Para usar o servidor, suba só ele com
> `docker compose up qdrant` (a API se semeia sozinha no boot; `make seed`
> recarrega à mão, sem chamadas de API).

As rotas de IA (`/api/suggest`, `/api/incidents/{n}/ask` e
`/api/changes/{n}/evaluate`) precisam de `OPENROUTER_API_KEY`; sem ela,
respondem 503 e o resto do app funciona.

## Comandos (Makefile)

| Comando           | O que faz                                            |
| ----------------- | ---------------------------------------------------- |
| `make setup`      | Instala dependências de backend e frontend           |
| `make up` / `down`| Sobe / derruba o stack via Docker Compose            |
| `make seed`       | Carrega dataset + embeddings no Qdrant               |
| `make generate`   | Regenera o dataset sintético (usa LLM)               |
| `make precompute` | Recomputa embeddings + clustering + rótulos          |
| `make api` / `web`| Sobe a API (:8000) / o frontend (:3000) sem Docker   |
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
  eslint + tsc + vitest no frontend). O CI roda os mesmos gates, mais
  `ruff format --check` e o build do Next.js. No frontend, rode também
  `npx prettier --check .`.
- **Texto**: copy e docs em PT-BR simples, sem travessões, e só o banco
  fictício "Banco Meridiano".
- **IA nos testes**: LLM, embeddings e Qdrant entram por injeção de dependência
  e são falsos nos testes. Nenhum teste chama a OpenRouter.
- **Tipos**: Python com type hints e `mypy` limpo; TypeScript em modo `strict`,
  sem `any`.

## Pull Requests

1. Crie um branch a partir de `main`.
2. Faça `make check` passar.
3. Abra o PR descrevendo o **porquê** da mudança (antes, depois e como
   verificar), seguindo o modelo em `.github/pull_request_template.md`.
4. Mudança visível ao usuário entra no `CHANGELOG.md`, em `[Unreleased]`.

Um merge em `main` publica sozinho: o site pelo workflow `frontend-deploy` e a
API pelo `backend-deploy`. Uma versão nova sai com uma tag `vX.Y.Z`: o workflow
`release` cria a GitHub Release com a seção do `CHANGELOG.md` e publica as
imagens no GHCR.

Ao participar, você concorda com o nosso
[Código de Conduta](CODE_OF_CONDUCT.md).
