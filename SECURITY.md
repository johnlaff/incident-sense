# Política de Segurança

## Sobre este projeto

O `incident-sense` é um **demo educacional**. Todos os dados são **sintéticos** e
o banco ("Banco Meridiano") é **fictício**: não há dados reais, pessoais ou
sensíveis no repositório.

As únicas informações sensíveis são as **chaves e tokens** que você fornece:

- `OPENROUTER_API_KEY`: localmente só no `.env` (gitignored); na demo pública,
  como variável de ambiente do serviço no Render.
- `RENDER_DEPLOY_HOOK_URL`, `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`:
  segredos do repositório no GitHub Actions.

Nenhum deles deve ser commitado. O repositório versiona somente o
`.env.example`, com placeholders.

## A demo pública

- Não há login. O cabeçalho `X-Client-Id` é um id aleatório do navegador que
  separa visitantes (cota, trava de conteúdo e notas de trabalho); não é
  autenticação nem protege dados.
- As rotas que chamam modelos passam por uma guarda de uso por visitante, por
  IP e por dia antes de qualquer chamada ao provedor, para limitar custo e
  abuso. Acima do limite, a API responde 429.
- Notas, cota e avaliações reaproveitadas ficam em memória no processo e somem
  a cada reinício.
- CORS aceita só as origens de `FRONTEND_ORIGIN`.

## Reportando uma vulnerabilidade

Se encontrar um problema de segurança (por exemplo, vazamento acidental de
segredos, dependência vulnerável ou falha no fluxo de dados):

- Prefira o **GitHub Security Advisory** privado do repositório
  (_Security_ > _Report a vulnerability_), **ou**
- envie um e-mail para **joaoaraxaiba@gmail.com**.

Por favor, **não** abra uma issue pública para vulnerabilidades. Faremos o
possível para responder rapidamente e creditar quem reportar, se desejado.

## Boas práticas ao usar

- Nunca commite o `.env` real nem cole chaves em issues/PRs.
- Rotacione qualquer chave que tenha sido exposta acidentalmente.
- As chamadas externas se limitam à OpenRouter (chat e embeddings), ou ao
  gateway compatível configurado em `LLM_BASE_URL` e `EMBEDDING_BASE_URL`.
