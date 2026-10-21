# Changelog

Todas as mudanças notáveis deste projeto são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Unreleased]

### Alterado

- O repositório e a demo não citam mais nenhum evento: o texto fala em
  demonstração ao vivo, apresentações e aulas.
- As fontes viram referências no padrão autor-data, como "(Ferreira, 2026)", com
  a lista completa em "Referências" na tela Como a IA funciona e nos READMEs. Sai
  a linha de créditos com os nomes de quem apresenta.
- Os valores de "ensaio" passam a ser de uma execução real de referência.

### Alterado

- **Perguntas partem da análise guardada no servidor**: `/api/suggest` guarda,
  por visitante e incidente, o veredito, a justificativa, a sugestão mostrada e
  os casos mantidos com o motivo de cada um. `/ask` responde a partir disso,
  segue os passos da sugestão na mesma ordem e ignora os `context_ids` do
  navegador. Sem análise guardada, responde 409 e a tela roda a análise antes
  da pergunta; uma saudação continua respondida na hora.
- Perguntas têm limite de uso próprio (`AI_ASK_MAX_PER_CLIENT`,
  `AI_ASK_MAX_PER_IP`), separado das análises, com frase própria.
- O prompt das perguntas usa os rótulos da tela ("Crítica", "Em andamento").
- Analisar de novo substitui a nota da IA no lugar, sem empilhar outra.
- Com o rail completo, o botão "Perguntar à IA" fica no rail e não cobre o
  texto do registro.

### Corrigido

- Pergunta com mais de 600 caracteres derrubava a tela do incidente: o campo
  para em 600 com contador, e todo erro de validação vira uma frase em
  português.
- Chat: resposta com `kind` fora do padrão ou vazia, pergunta perdida quando a
  análise falhava, pergunta ignorada enquanto a análise rodava, "Tentar de
  novo" que mudava a pergunta de lugar, texto do campo cortado em 360 e que
  oferecia sugestão no improcedente, palavras longas fora do balão.
- Sair do incidente e voltar na mesma aba mantém a análise e a conversa.
- O filtro de contradições só descarta frases inteiras de negação; uma
  contradição curta e real conta.
- Campo que volta a um texto já avaliado não aparece como "Nada mudou".
- Média inalcançável não pede "Avalie de novo"; nomes de campos em "A e B".
- Coerência que reprova aparece em vermelho no cartão, como na pergunta 2; o
  último passo da aula aponta para "Ver onde".
- "3.072 dimensões" no passo do embedding; INC0053082 com prioridade Crítica,
  como pedem Impacto e Urgência altos.

## [1.1.0] - 2026-10-21

Versão pronta para demonstração ao vivo em apresentações e aulas. Tudo o que
mudou na API é aditivo: rotas e campos novos, nenhum removido ou renomeado.

### Adicionado

- **Avaliação de Mudanças** (`/changes`, `POST /api/changes/{number}/evaluate`):
  18 Changes sintéticas, IA juíza que dá nota de 0 a 10 a cada um dos 7 campos
  contra uma grade versionada (`rubrica.toml`, pesos somando 13,5), média
  ponderada e, a partir de 8,0, conferência de coerência entre as partes e do
  plano de retorno contra as tarefas. Trava de conteúdo reaproveita a nota do
  campo que não mudou; `fresh: true` ("Avaliar de novo, sem reaproveitar")
  manda tudo de novo ao modelo. A tela repassa a avaliação em etapas reais.
- **Veredito único da Mudança**: o backend devolve `decision`
  (`passes`, `reason_code`, `failed`, `reason`) e todas as telas leem só ele.
  Portas: média e coerência a partir de 8,0, nenhuma contradição real e plano
  de retorno não `NAO_ADERENTE`; campo sem nota vira `field_missing`.
- **Pipeline de incidentes em sete etapas**, como em Ferreira (2026): carregar,
  resumo por IA, embedding do resumo com categoria, subcategoria e empresa,
  recuperação em três camadas (tags semânticas, vetor com cosseno mínimo 0,8 e
  top-K 5/10, pós-filtro por LLM com volta à lista original), contexto, decisão
  de procedência, sugestão com citações validadas e publicação nas notas de
  trabalho. Aba "Análise da IA" no detalhe do incidente com cada etapa, régua de
  similaridade e funil das camadas.
- **Perguntas de acompanhamento** no assistente da IA:
  `POST /api/incidents/{number}/ask` responde com o incidente e só os casos que
  a análise manteve, cita só esses casos, diz quando eles não respondem, nunca
  publica nota e usa o mesmo limite de uso. Saudações não chamam a IA.
- **Problemas**: base de 10 Problemas sintéticos em coleção própria do Qdrant,
  `GET /api/problems` e `GET /api/problems/{number}`, tela `/problemas` e
  prévia em toda menção a PRB.
- **Repetições** (`/recorrencias`, também `/repeticoes`): demonstração do
  agrupamento em cinco passos sobre um mapa com os 431 incidentes, ranking
  "Falhas que mais se repetem", filtros por serviço e mês.
- **Como a IA funciona** (`/como-funciona`): o processo ponta a ponta em sete
  capítulos animados, com resumo de 30 segundos.
- **Modo aula** (`?aula=1`, botão no topo ou `/aula` com o roteiro): cada tela
  avança passo a passo com legenda, por toque, setas ou passador de slides.
- **Demo pública gratuita**: API no Render (Blueprint `render.yaml`, Qdrant em
  memória), site na Cloudflare Workers via OpenNext (workflow
  `frontend-deploy`), deploy da API a cada merge pelo deploy hook e ping a cada
  10 minutos (workflow `backend-deploy`). Uma única chave da OpenRouter cobre
  chat e embeddings.
- Guarda de uso para as rotas de IA: limite por visitante (`X-Client-Id`), por
  IP e teto diário.
- Contrato SSE v1 do copiloto (`contracts/copilot-stream/`) com modelos
  Pydantic, tipos TS e fixtures lidas pelas duas suítes, e a pesquisa dos
  modelos candidatos da OpenRouter para o copiloto contextual.
- ADRs 0017 a 0022, diagramas de arquitetura e do fluxo de decisão da Mudança.

### Alterado

- Interface toda revista: layout mobile first (sem rolagem lateral de 360 a
  1920 px), visual "Claro" com violeta só para a IA, cor, ícone e forma fixos
  por conceito, copy em português simples com o jargão em "Ver detalhes
  técnicos", contraste AA e alvos de toque de 44 px.
- O assistente da IA (antes "Aurora") ganhou o botão "Perguntar à IA", sempre
  alcançável, e a resposta vem primeiro: uma frase, passos numerados, fontes
  clicáveis, confiança em palavras e o Erro conhecido no topo.
- Vetores do RAG regerados a partir dos resumos (`summary_embeddings.npz`,
  `problem_embeddings.npz`), como em Ferreira (2026).
- O agrupamento roda o HDBSCAN nos embeddings normalizados e deixa o ruído como
  casos isolados (9 grupos e 78 casos isolados); o UMAP 2D só desenha o mapa.
- Notas de trabalho, trava de conteúdo e cota valem por visitante.
- O pós-filtro lê título, descrição e resolução de cada caso, e não só o título.
- Chamadas à IA sem raciocínio oculto (`reasoning.enabled=false`), com prazo de
  20 s e sem nova tentativa; o site desiste em 90 s com aviso em português.
- Modelos selecionáveis: Claude Haiku 5.5 (padrão), GPT-6 Luna, Gemini 3.8
  Flash, DeepSeek V4.1 Flash e Qwen 3.7 Flash. Os ids da 1.0.0
  que saíram (`auto`, `deepseek-v4`, `qwen3-max`) caem no modelo padrão, como
  qualquer id desconhecido.
- Next.js 16.4.2. Embeddings passam pela OpenRouter; `OPENAI_API_KEY` não é
  mais usada.

### Corrigido

- Avaliação de Mudança não quebra com JSON cortado nem com resposta fora do
  formato: leitura tolerante de notas e percentuais, nova tentativa de formato,
  campo que falha vira "sem nota" em vez de derrubar a avaliação.
- Itens como "Nenhuma contradição encontrada" ou "N/A" não contam mais como
  contradição.
- Manchete, barra, fórmula e veredito da Mudança saem da mesma conta; o motivo
  de corte usa duas casas ("7,96", não "8.0 abaixo de 8.0").
- O pós-filtro não descarta mais os casos mais parecidos do incidente da aula.
- Timeout da sugestão devolve 504 com mensagem clara; falta de cota vira 503.
- CORS para o site na Cloudflare; `/?aula=1` mantém o parâmetro ao redirecionar.
- Correções das revisões independentes de UI, das auditorias de lógica e dos
  testes E2E: nomes inteiros a 360 px, modo aula sem cobrir conteúdo, abas com
  o mesmo nome do título, Mudanças avaliadas em "Avaliadas", entre outras.

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

[Unreleased]: https://github.com/johnlaff/incident-sense/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/johnlaff/incident-sense/releases/tag/v1.1.0
[1.0.0]: https://github.com/johnlaff/incident-sense/releases/tag/v1.0.0
[0.1.0]: https://github.com/johnlaff/incident-sense/releases/tag/v0.1.0
