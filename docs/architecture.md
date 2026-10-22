# Arquitetura

> O **problema** e o caso de uso ficam no [README](../README.md). Aqui está
> _como_ o sistema é construído.

## Visão geral

O `incident-sense` é um monólito simples: um site Next.js e uma API FastAPI. A
API carrega os dados commitados no boot, semeia o Qdrant e chama a OpenRouter
para chat e embeddings.

![Arquitetura](assets/architecture-pt.svg)

O diagrama acima é gerado a partir de [`diagrams/arch-pt.mmd`](diagrams/arch-pt.mmd)
(e `arch-en.mmd`). Para regerar:

```bash
npx -y @mermaid-js/mermaid-cli -i docs/diagrams/arch-pt.mmd -o docs/assets/architecture-pt.svg -b white
```

### Onde cada peça roda

| Peça | Demo pública | Local |
| --- | --- | --- |
| Site (`frontend/`) | Cloudflare Workers via OpenNext, publicado pelo workflow `frontend-deploy` | `make web` ou o serviço `web` do Docker Compose |
| API (`backend/`) | Render, plano Free, pelo Blueprint `render.yaml`; o workflow `backend-deploy` chama o deploy hook a cada merge, e o Worker `keep-awake` faz ping a cada 10 min por cron da Cloudflare | `make api` ou o serviço `api` do Docker Compose |
| Qdrant | em memória dentro da API (`QDRANT_URL=:memory:`), semeado no boot | servidor `qdrant` do Docker Compose, ou `:memory:` |
| Modelos | OpenRouter, uma chave (`OPENROUTER_API_KEY`) | o mesmo |

```mermaid
flowchart LR
    V[Visitante] --> W[Cloudflare Workers<br/>Next.js 16]
    W -- "HTTPS + X-Client-Id" --> API[Render: FastAPI]
    API -- "busca vetorial" --> Q[(Qdrant em memória)]
    API -- "chat e embeddings" --> OR[(OpenRouter)]
    D[Dados commitados] -- "boot" --> API
    GH[GitHub Actions] -. "frontend-deploy" .-> W
    GH -. "deploy hook" .-> API
    K[Cloudflare cron<br/>keep-awake] -. "ping 10 min" .-> API
```

## Stack (resumo)

| Camada | Tecnologia |
| --- | --- |
| API | Python 3.12, FastAPI, pydantic-settings, structlog |
| RAG | LlamaIndex (pós-filtro como _node postprocessor_), `openai/text-embedding-3-large` via OpenRouter (3072d) |
| Chat/LLM | OpenRouter (compatível com OpenAI), padrão `anthropic/claude-haiku-5.5`, trocável por requisição |
| Vetorial | Qdrant (cosseno, 3072d), coleções `incidents_resolved` e `problems` |
| Clustering | BERTopic (HDBSCAN nos embeddings + rótulos por LLM; UMAP 2D só no mapa), offline |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind v4, Motion, regl-scatterplot, react-markdown |
| Qualidade | ruff, mypy, pytest · eslint, tsc, prettier, vitest |

As decisões por trás de cada escolha estão em [decisions/](decisions/).

## Rotas da API

Todas sob `/api`. As marcadas com IA chamam modelo e passam pela guarda de uso.

| Rota | IA | O que faz |
| --- | --- | --- |
| `GET /health` | | status, versão e se a chave está configurada |
| `GET /incidents`, `GET /incidents/{number}` | | lista com filtros e detalhe; o detalhe traz as notas publicadas **por este visitante** |
| `POST /suggest` | sim | o pipeline de sete etapas ([rag-flow.md](rag-flow.md)) |
| `POST /incidents/{number}/ask` | sim | pergunta de acompanhamento sobre a análise ([rag-flow.md](rag-flow.md#perguntas-ao-assistente)) |
| `GET /problems`, `GET /problems/{number}` | | os 10 Problemas sintéticos |
| `GET /changes`, `GET /changes/{number}`, `GET /changes/rubric` | | as 18 Changes e a grade versionada |
| `POST /changes/{number}/evaluate` | sim | avaliação da Change ([abaixo](#3-avaliação-de-mudanças)) |
| `GET /clusters` | | o agrupamento pré-computado ([clustering-flow.md](clustering-flow.md)) |

Sem `OPENROUTER_API_KEY`, as rotas de IA respondem 503 com uma mensagem clara e
o resto funciona.

## Os fluxos

### 1. Incidentes: `POST /api/suggest`

Recupera incidentes resolvidos e Problemas parecidos, decide se o chamado é
procedente e, se for, sugere uma resolução com fontes e publica nas notas de
trabalho. Detalhes em [rag-flow.md](rag-flow.md).

```mermaid
flowchart TD
    A[1. Carregar o incidente] --> B[2. Resumo por IA]
    B --> C[3. Embedding: resumo + categoria, subcategoria, empresa]
    C --> D[4. Tags, vetor 0,8 top-K 5/10, pós-filtro LLM]
    D --> E[5. Contexto: incidentes + problemas]
    E --> G{Procedente?}
    G -- PROCEDENTE + contexto --> H[6. Sugestão com fontes validadas]
    H --> P[7. Publicação nas notas de trabalho do visitante]
    G -- PROCEDENTE sem contexto --> J[Sem sugestão: tratar manualmente]
    G -- IMPROCEDENTE --> I[Sem sugestão: autoatendimento]
```

### 2. Perguntas ao assistente: `POST /api/incidents/{number}/ask`

Depois da análise, cada pergunta digitada no assistente da IA é uma chamada ao
modelo com o incidente e só os casos que a análise manteve. Ela cita só esses
casos, diz quando eles não respondem e nunca publica nota. Detalhes em
[rag-flow.md](rag-flow.md#perguntas-ao-assistente) e no
[ADR 0021](decisions/0021-pergunta-de-acompanhamento-so-com-casos-mantidos.md).

### 3. Avaliação de Mudanças

`POST /api/changes/{number}/evaluate` é um LLM-como-juiz que segue Freitas Neto
(2026). A lógica está em `backend/src/incident_sense/changes/evaluator.py` e a
grade em `changes/rubrica.toml` (versão `2026-10-19`, pesos somando 13,5, corte
8,0).

1. **Escopo.** Só Changes `Normal`, no estado `New`, do Banco Meridiano são
   avaliadas. As outras aparecem como "não avaliada", nunca como nota zero.
2. **Trava de conteúdo.** Cada campo tem uma chave `(visitante, versão da
   grade, modelo, Change, campo, hash do texto normalizado)`. Se o texto não
   mudou, a nota volta do cache sem chamar o modelo (`reused: true`). Com
   `fresh: true` ("Avaliar de novo, sem reaproveitar") tudo volta ao modelo e a
   leitura nova substitui a anterior.
3. **Um juiz por campo**, os 7 em paralelo. Resposta fora do formato ganha uma
   nova tentativa; se a chamada falhar ou a segunda resposta também vier fora
   do formato, o campo vira `score: null, failed: true` e fica fora da média. A
   avaliação volta 200 e só falha inteira quando todos os campos falham.
4. **Média ponderada** pelos pesos da grade, com duas casas.
5. **Conferência de coerência** só com média a partir de 8,0 e nenhum campo
   faltando: nota de consistência, pontos tipados (`contradicao`, `lacuna`,
   `sugestao`) e aderência do plano de retorno às tarefas, em
   percentual (`ADERENTE` a partir de 80%, `PARCIAL` a partir de 50%,
   `NAO_ADERENTE` abaixo).
6. **Decisão.** `decide()` calcula o campo `decision` uma vez, e todas as telas
   leem só ele ([ADR 0019](decisions/0019-backend-fonte-unica-do-veredito-da-mudanca.md)).

```mermaid
flowchart TD
    S{No escopo?<br/>Normal, New, Banco Meridiano} -- não --> N[Não avaliada]
    S -- sim --> F[7 campos em paralelo<br/>trava de conteúdo por visitante]
    F --> M{Algum campo sem nota?}
    M -- "sim, e nem 10 nele alcança 8,0" --> R1[average_below]
    M -- sim --> R2[field_missing]
    M -- não --> A{Média >= 8,0?}
    A -- não --> R3[average_below]
    A -- sim --> C[Conferência de coerência]
    C -- "não voltou: timeout, cota, formato" --> R4[semantic_missing]
    C -- voltou --> G{Portas da coerência}
    G -- "coerência < 8,0" --> X1[coherence_below]
    G -- "contradição real" --> X2[contradictions]
    G -- "retorno < 50% NAO_ADERENTE" --> X3[backout_not_adherent]
    G -- "todas passam" --> OK[passes: pode seguir para aprovação humana]
```

O resultado tem a forma:

```json
"decision": {
  "passes": false,
  "reason_code": "coherence_below",
  "failed": ["coherence_below", "contradictions"],
  "reason": "A média passou (9,04), mas as partes do pedido não combinam: coerência 4,0, abaixo de 8,0; e a IA encontrou 1 contradição entre as partes do pedido."
}
```

`failed` lista todas as portas que reprovaram, na ordem; `reason_code` é a
primeira. A leitura das respostas do modelo é tolerante: "8/10", "9.0 (bom)" e
"Nota: 9" viram número, 0,8 e 1.0 viram percentual, `null` vira lista vazia, e
itens como "Nenhuma contradição encontrada" não contam como contradição.

A conferência roda **três vezes em paralelo** (temperatura 0), porque um
juízo isolado ainda oscila entre execuções. A nota de consistência e o
percentual de aderência são a **mediana** das três; uma contradição só conta
quando pelo menos duas execuções acharam contradição no **mesmo par de
partes** (com duas execuções de volta, as duas; com uma, ela vale sozinha). As
outras viram pontos de atenção. Texto, raciocínio e orientação vêm da execução
cuja nota é a mediana. Se uma execução falhar, valem as que voltaram; se as
três falharem, `semantic_missing`. O tempo é o de uma chamada, e
`model_calls` conta as três (7 campos + 3).

Só reprova um ponto do tipo `contradicao` que nomeia duas partes diferentes do
pedido e afirma fatos incompatíveis; ele vai para `problems`. O que falta (uma
tarefa, um detalhe, um responsável) é sempre `lacuna`, mesmo tipado como
contradição e citando duas partes. Lacunas, sugestões e observações sobre uma
parte só vão para `attention` ("Pontos de atenção" na tela) e nunca reprovam.
Um item sem tipo (respostas antigas, em texto) passa pela mesma regra das duas
partes, exceto quando o próprio juiz diz que está alinhado (coerência a partir
de 8,0 e retorno aderente): aí ele também vira ponto de atenção. Para conferir a
calibragem contra o modelo real, `scripts/calibrar_mudanca.py` repete a
avaliação N vezes com `fresh: true` e mostra o veredito, as portas que
reprovaram e os pontos por tipo. O
juiz pede à OpenRouter para não usar raciocínio oculto
([ADR 0022](decisions/0022-raciocinio-oculto-desligado.md)).

### 4. Repetições (clustering): `GET /api/clusters`

Serve o resultado **pré-computado e commitado**: cada incidente como um ponto
2D com seu grupo e rótulo. Detalhes em [clustering-flow.md](clustering-flow.md).

## Uma demo aberta para a plateia

- **Guarda de uso** (`backend/src/incident_sense/guard.py`): antes de qualquer
  chamada de modelo, janela de 10 minutos por visitante (`AI_MAX_PER_CLIENT`,
  20), por IP (`AI_MAX_PER_IP`, 300; uma sala inteira divide o mesmo NAT) e
  teto diário (`AI_MAX_PER_DAY`, 3000). Acima do limite, 429 com o motivo em
  português. As perguntas de acompanhamento têm limite próprio
  (`AI_ASK_MAX_PER_CLIENT`, 40, e `AI_ASK_MAX_PER_IP`, 1200), para que uma
  conversa não gaste a cota das análises.
- **Quem é o visitante.** O site gera um id aleatório por navegador
  (`localStorage`) e o envia em `X-Client-Id`. `client_key()` usa os primeiros
  64 caracteres desse cabeçalho ou, sem ele, o IP. A cota, a trava de conteúdo
  das Mudanças e as notas de trabalho usam a mesma chave
  ([ADR 0020](decisions/0020-escopo-por-visitante.md)).
- **Qual é a rede.** `client_ip()` lê `X-Forwarded-For` do fim para o
  começo: `TRUSTED_PROXY_HOPS` (padrão 1) diz quantos endereços no fim da
  lista o proxy confiável acrescentou, e o visitante é o último deles;
  endereços privados no fim da lista (o proxy interno do Render) são
  descartados antes. No Render a cadeia é `visitante, borda da Cloudflare,
  10.x`, e o `render.yaml` define `TRUSTED_PROXY_HOPS=2`. O primeiro
  endereço é do cliente e não conta. A guarda remove janelas vazias,
  guarda no máximo 10.000 chaves por tabela e registra cada recusa como
  `ai_quota_refused` ([ADR 0023](decisions/0023-guarda-de-uso-confiavel-e-limites-de-tamanho.md)).
- **Tamanhos.** Todo texto que vai ao modelo tem máximo: descrição 4000,
  título 300, campo de Mudança e plano de retorno 6000, pergunta 600. Acima
  disso, 422 sem chamada ao modelo. Um middleware responde 413 a corpos acima
  de 64 KB (`MAX_BODY_BYTES`) antes do parse.
- **Prompts.** Os sete prompts de sistema terminam com a frase de
  `prompts.py`: o texto do visitante é material a analisar, não instrução.
  A saída continua validada (JSON, citações contra o contexto, markdown sem
  HTML).
- **Prazos.** O cliente da OpenRouter (chat e embeddings) desiste em 20 s, sem
  nova tentativa de rede, para que o pior caminho (campo, reparo de formato,
  coerência, reparo de formato) termine antes dos 90 s em que o site desiste. Timeout vira 504, falta de cota
  vira 503 e outras falhas viram 502, sempre com mensagem em português.
- **Estado em memória.** Qdrant, cota, trava de conteúdo e notas de trabalho
  vivem no processo e somem num reinício, o que é aceitável para uma instância
  única de demonstração.

## Dados e determinismo

O dataset sintético e os artefatos pré-computados (vetores e agrupamento) são
**gerados uma vez e commitados**. A navegação e as Repetições funcionam sem
nenhuma chamada de API; só a análise, as perguntas e a avaliação de Mudanças
chamam o modelo ao vivo. Veja [data-generation.md](data-generation.md) e o
[ADR 0006](decisions/0006-execucao-local-e-determinismo.md).

## Layout do repositório

```
backend/    API FastAPI: pipeline de incidentes, ask, Changes, Problemas, scripts e dados commitados
frontend/   app Next.js: telas, assistente da IA, modo aula, mapa WebGL e cliente de API tipado
contracts/  fixtures do contrato de streaming do copiloto, lidas por pytest e Vitest
docs/       esta documentação (PT-BR), diagramas e ADRs
```

## Configuração

Tudo por variáveis de ambiente (12-factor) via pydantic-settings, em
`backend/src/incident_sense/config.py`; ver `.env.example`. Segredos nunca são
commitados; o `.env` real é gitignored.
