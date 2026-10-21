# ADR 0017: Hospedagem no Render e na Cloudflare Workers, com deploy por GitHub Actions

- Status: Aceito
- Data: 2026-10-21
- Complementa: [ADR 0015](0015-uma-chave-e-demo-publica-gratuita.md)

## Contexto

O ADR 0015 colocou a demo pública em serviços gratuitos. Na prática apareceram
três atritos antes da primeira demonstração ao vivo: o site começou no Netlify, que exigia um desvio
no `next.config.ts`; a API no Render só atualizava com um clique em "Deploy
latest commit"; e a instância gratuita dorme depois de 15 minutos parada e leva
cerca de um minuto para acordar, justamente quando a plateia abre o site.

## Decisão

- **Site na Cloudflare Workers** pelo adaptador OpenNext
  (`@opennextjs/cloudflare`, `frontend/wrangler.jsonc`,
  `frontend/open-next.config.ts`). O workflow `frontend-deploy` publica a cada
  push em `main` que mexe em `frontend/`, com os segredos
  `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` e a variável
  `NEXT_PUBLIC_API_URL`. Sem o token, o job é pulado. O Netlify saiu.
- **API no Render, plano Free**, pelo Blueprint `render.yaml` (Docker, Qdrant
  em memória, `FRONTEND_ORIGIN` com a URL do Workers e `localhost:3000`).
- **Deploy contínuo da API**: o workflow `backend-deploy` chama o deploy hook
  do serviço (segredo `RENDER_DEPLOY_HOOK_URL`) a cada push em `main` que mexe
  em `backend/`, no `render.yaml` ou no próprio workflow. Sem o segredo, o
  passo é pulado.
- **Instância acordada**: o mesmo workflow faz um ping em `/api/health` a cada
  10 minutos (cron), abaixo dos 15 minutos que fazem a instância dormir.

URLs publicadas: https://incident-sense.joaoaraxaiba.workers.dev (site) e
https://incident-sense-api.onrender.com (API).

## Consequências

- Um merge em `main` publica o site e a API sem passo manual.
- O site não espera a API acordar durante a demo; o aviso "Ligando o servidor
  da demonstração" e a nova tentativa automática continuam para o caso de o
  ping falhar.
- O ping consome minutos de GitHub Actions e horas da instância gratuita; é
  aceitável para uma demo, e basta desligar o cron quando a demo não estiver em uso.
- O Next.js precisa ficar numa versão aceita pelo OpenNext (16.4.2 ou mais).

## Alternativas consideradas

- Netlify para o site: funcionava, mas com desvio no `next.config.ts` e sem
  vantagem sobre o Workers.
- Plano pago do Render para não dormir: custo fixo que a demo não precisa.
