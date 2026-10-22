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

## A demo pública: o que protege e o que não protege

A demo fica aberta na internet, sem login, com uma única chave da OpenRouter.
O risco que ela gerencia é alguém **gastar essa chave** ou **derrubar a
instância**; não há dado a proteger. As barreiras, da mais externa para a mais
interna ([ADR 0023](docs/decisions/0023-guarda-de-uso-confiavel-e-limites-de-tamanho.md)):

1. **Limite de gasto na chave da OpenRouter.** Fica fora do código e é o teto
   financeiro de verdade. Mantenha um limite mensal na chave e confira o saldo
   antes de cada apresentação: com o limite esgotado, a demo responde 503 ("A
   IA está sem cota agora") em vez de cobrar.
2. **Corpo da requisição até 64 KB** (`MAX_BODY_BYTES`). Acima disso, 413 antes
   de ler o JSON.
3. **Tamanho máximo de todo texto que vai ao modelo**: descrição do incidente
   4000 caracteres, título 300, cada campo editado de Mudança e o plano de
   retorno 6000, pergunta 600. Acima disso, 422 sem chamada ao modelo. Os
   maiores textos da base cabem com folga (281 e 1864).
4. **Guarda de uso por visitante, por rede e por dia**, antes de qualquer
   chamada ao provedor. Janela de 10 minutos: 20 análises e 40 perguntas por
   visitante (`X-Client-Id`), 300 análises e 1200 perguntas por rede, e um teto
   diário de 3000 análises. A rede é o endereço que **o proxy acrescentou** a
   `X-Forwarded-For` depois de descartar os saltos da plataforma no fim da
   lista (endereços privados e as faixas publicadas da Cloudflare, que o
   Render usa como borda), nunca o primeiro, que o cliente pode escrever. Acima do limite, 429 com o motivo em português, e um
   evento `ai_quota_refused` no log com o limite que segurou, o começo do
   identificador e o endereço resolvido.
5. **Memória com teto.** Guarda, trava de conteúdo, notas e análises guardadas
   vivem em memória, com no máximo alguns milhares de chaves cada; a mais
   antiga sai primeiro, e as janelas vazias são removidas.
6. **Saída validada e prompts blindados.** Toda resposta do modelo é lida como
   JSON e validada; citações fora do contexto são removidas; o markdown é
   renderizado sem HTML. Os prompts de sistema dizem ao modelo que o texto do
   visitante é material a analisar, não instrução. Uma injeção de prompt afeta
   só a resposta que o próprio visitante vê: notas e análises são por
   visitante.
7. **Modelos só da lista permitida** (`SELECTABLE_MODELS`): um id desconhecido
   cai no padrão. **CORS** aceita só as origens de `FRONTEND_ORIGIN`. O site
   envia `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` e
   `Permissions-Policy`.

**Risco residual, aceito:** o `X-Client-Id` é um id gerado pelo navegador, não
autenticação. Quem roda um script na mesma rede pode trocar o id e chegar ao
limite por rede (300 análises em 10 minutos) e, em seguida, ao teto diário.
Impedir isso exigiria login, que a demo não tem por decisão
([ADR 0015](docs/decisions/0015-uma-chave-e-demo-publica-gratuita.md)). O
limite de gasto da chave fecha a conta.

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
- Defina um limite de gasto na chave da OpenRouter e confira o saldo antes de
  uma apresentação.
- As chamadas externas se limitam à OpenRouter (chat e embeddings), ou ao
  gateway compatível configurado em `LLM_BASE_URL` e `EMBEDDING_BASE_URL`.
