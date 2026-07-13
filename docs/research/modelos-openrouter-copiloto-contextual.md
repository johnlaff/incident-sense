# Modelos OpenRouter para o copiloto contextual

> Catálogo, preços, rotas e documentação de terceiros verificados em
> 2026-07-13. A metadata foi coletada em
> `2026-07-13T15:06:21Z`. Nenhuma chamada de inferência paga foi executada.

## Pergunta

Quais modelos do catálogo do OpenRouter formam uma shortlist tecnicamente
defensável para selecionar, por evals, o modelo de referência e as alternativas
do **copiloto contextual de incidentes** em PT-BR e inglês?

A comparação cobre estabilidade de disponibilidade, evidência multilíngue,
janela de contexto, streaming, saída estruturada, segurança, latência e preço.
Ela não escolhe um vencedor: qualidade fundamentada, paridade bilíngue e
comportamento sob o contrato real pertencem ao harness.

## Recomendação executiva

Enquanto a política de ZDR não é ratificada, levar seis IDs exatos ao núcleo
conservador da seleção controlada, sem hierarquia prévia:

- `openai/gpt-5.6-luna`, como candidato de alta escala e custo intermediário;
- `anthropic/claude-sonnet-5`, como teto de qualidade com custo maior;
- `google/gemini-3.5-flash`, como candidato geral GA com contexto longo;
- `google/gemini-3.1-flash-lite`, como âncora de custo e latência;
- `deepseek/deepseek-v4-flash`, como controle incumbente de custo mínimo;
- `mistralai/mistral-small-2603`, como alternativa aberta, multilíngue e
  eficiente.

Esses papéis são **hipóteses de avaliação**, não rankings. Todos os seis IDs
aparecem sem `expiration_date` no catálogo, declaram `response_format` e
`structured_outputs`, e possuem ao menos uma rota que combina ZDR e
`structured_outputs` no snapshot. A API de modelos documenta que `id` é o
identificador de requisição, `canonical_slug` é o slug permanente e `pricing`
representa a menor estrutura de preço disponível
([OpenRouter: Models API](https://openrouter.ai/docs/guides/overview/models),
verificado 2026-07-13).

Cinco candidatos mais o controle incumbente formam o menor núcleo que mantém seis
eixos não redundantes sob a trilha ZDR: teto de qualidade, frontier sensível a
custo, modelo geral GA, âncora GA de custo/latência, custo de migração e
alternativa aberta com evidência explícita de português. Remover uma entrada
elimina um desses controles; adicionar outra variante premium, especializada ou
da mesma família duplica um eixo sem uma falha observada que justifique o custo.
Essa composição é mínima para o harness atual, não uma afirmação de que o catálogo
só contém seis modelos capazes.

`qwen/qwen3.7-plus` permanece como sétimo candidato **condicional**. O modelo traz
evidência multilíngue e preço competitivo, mas zero endpoint apareceu em
`GET /api/v1/endpoints/zdr`. O ticket
[Definir o threat model e os gates de segurança do release](https://github.com/johnlaff/incident-sense/issues/19)
deve ratificar se ZDR é requisito para o escopo sintético. Até essa decisão, Qwen
fica fora apenas do núcleo executável conservador; isso não é exclusão normativa
nem julgamento de qualidade
([OpenRouter: ZDR](https://openrouter.ai/docs/guides/features/zdr),
[endpoint público ZDR](https://openrouter.ai/api/v1/endpoints/zdr), verificado
2026-07-13).

Enquanto a política normativa permanece aberta, a trilha conservadora só admite
uma requisição quando ela intersecta:

1. ID de modelo em allowlist;
2. provider em allowlist;
3. `provider.zdr: true` e `provider.data_collection: "deny"`;
4. suporte ao schema solicitado por `provider.require_parameters: true`;
5. plugins e tools desativados;
6. limites de tokens, custo, timeout e retry do turno.

O ticket de threat model ratifica o requisito de ZDR, a allowlist exata de
providers e quando fallback é permitido. Esta pesquisa preserva o filtro seguro
para comparação; não fecha essas decisões de segurança.

Essa interseção importa porque `supported_parameters` no nível do modelo não
garante que todo endpoint do modelo aceite o parâmetro. No snapshot, por exemplo,
Claude Sonnet 5 declara `structured_outputs`, mas apenas cinco de sete endpoints
gerais e quatro de seis endpoints ZDR o oferecem. O OpenRouter documenta
`require_parameters`, `only`, `allow_fallbacks` e demais controles de roteamento
por requisição
([provider routing](https://openrouter.ai/docs/guides/routing/provider-selection),
[structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs),
verificado 2026-07-13).

## Escopo, contratos e método

O objeto avaliado é o copiloto definido em [`CONTEXT.md`](../../CONTEXT.md):
read-only, limitado ao incidente em análise, ao histórico efêmero do mesmo
incidente e aos incidentes históricos recuperados. O fluxo permanece fixo e
não-agentic. Conhecimento geral pode explicar conceitos; diagnóstico, causa,
comando e resolução exigem evidência permitida e citada.

Isso produz quatro consequências para a seleção:

- capacidade de tools ou desempenho agentic não contam como benefício para este
  caso; tools e plugins permanecem desligados;
- contexto nominal grande não compensa groundedness, cobertura de citação ou
  isolamento ruins;
- saída estruturada nativa reduz falhas de forma, mas Pydantic e o validador de
  citações continuam sendo a autoridade, conforme o
  [ADR 0008](../decisions/0008-saida-estruturada.md) e a
  [arquitetura conversacional](arquitetura-conversacional-e-streaming.md);
- a política de provider e retenção é parte do contrato de segurança, não uma
  preferência de custo, conforme o
  [threat model](threat-model-e-controles-do-copiloto-contextual.md).

Foram usadas apenas fontes primárias:

- `GET /api/v1/models`, `GET /api/v1/models/:author/:slug/endpoints` e
  `GET /api/v1/endpoints/zdr`, todos públicos e read-only;
- documentação oficial do OpenRouter sobre schema, roteamento, streaming,
  structured outputs, privacidade e ZDR;
- model cards, system cards, changelogs e documentação dos provedores.

Nenhum benchmark agregador de terceiro foi usado para decidir qualidade. Quando
uma fonte do provedor não cobre PT-BR, o relatório preserva a lacuna em vez de
extrapolar um benchmark em inglês ou um rótulo genérico de “multilingual”.

As afirmações usam três classes:

- **documentado**: consta em documentação ou model card do provedor;
- **metadata**: consta no snapshot público do OpenRouter;
- **inferência**: hipótese que o harness precisa confirmar.

## Shortlist comparativa

### Metadata técnica e evidência do provedor

Preços são dólares por um milhão de tokens de entrada/saída e correspondem ao
menor preço anunciado pelo OpenRouter, não necessariamente à rota que sobreviverá
à allowlist e ao ZDR. `n/d` significa que a API não publicou o valor; não significa
zero.

| ID OpenRouter | Disponibilidade documentada | Evidência bilíngue | Contexto / saída máxima | Preço OpenRouter entrada / saída | Hipótese de papel |
| --- | --- | --- | ---: | ---: | --- |
| `openai/gpt-5.6-luna` | Família lançada GA em 2026-07-09; sem expiração na metadata | A documentação declara capabilities multilíngues para os modelos mais recentes, sem slice publicado de PT-BR para Luna | 1.050.000 / 128.000 | US$ 1,00 / US$ 6,00 | Escala e custo intermediário |
| `anthropic/claude-sonnet-5` | Modelo lançado em 2026-06-30; sem expiração na metadata | A documentação de Claude cobre PT-BR explicitamente; o system card de Sonnet 5 inclui avaliações multilíngues | 1.000.000 / 128.000 | US$ 2,00 / US$ 10,00 promocional | Teto de qualidade dentro do cap |
| `google/gemini-3.5-flash` | GA; sem data de shutdown anunciada | Model card inclui avaliação multilíngue, sem resultado específico de PT-BR publicado | 1.048.576 / 65.536 | US$ 1,50 / US$ 9,00 | Geral e contexto longo |
| `google/gemini-3.1-flash-lite` | GA; earliest shutdown em 2027-05-07 | Model card reporta MMMLU e otimização para tradução, sem slice específico de PT-BR | 1.048.576 / 65.536 | US$ 0,25 / US$ 1,50 | Custo e latência |
| `deepseek/deepseek-v4-flash` | API vigente, mas o provedor denomina a família “preview”; sem expiração na metadata | Model card reporta MMMLU e MGSM; não publica slice específico de português brasileiro | 1.048.576 / 65.536 no top provider | US$ 0,09 / US$ 0,18 | Controle incumbente e piso de custo |
| `mistralai/mistral-small-2603` | Modelo versionado v26.03; sem expiração na metadata | Model card oficial lista inglês e português entre dezenas de línguas | 262.144 / n/d | US$ 0,15 / US$ 0,60 | Alternativa aberta e eficiente |

Fontes por linha:

- GPT-5.6 Luna: [página do modelo](https://developers.openai.com/api/docs/models/gpt-5.6-luna),
  [catálogo e suporte multilíngue](https://developers.openai.com/api/docs/models),
  [lançamento GA](https://openai.com/index/gpt-5-6/) e
  [system card](https://deploymentsafety.openai.com/gpt-5-6) (verificado
  2026-07-13).
- Claude Sonnet 5:
  [mudanças e limites](https://platform.claude.com/docs/en/docs/about-claude/models/whats-new-sonnet-5),
  [suporte multilíngue](https://platform.claude.com/docs/pt-BR/build-with-claude/multilingual-support),
  [system card](https://www-cdn.anthropic.com/73ad94ca3c0502e75e46637cc62c8bd9532a7f2c/Claude%20Sonnet%205%20System%20Card.pdf)
  e [release notes](https://platform.claude.com/docs/en/release-notes/overview)
  (verificado 2026-07-13).
- Gemini 3.5 Flash:
  [página do modelo](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash),
  [guia de lançamento](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5),
  [model card](https://deepmind.google/models/model-cards/gemini-3-5-flash/)
  e [lifecycle](https://ai.google.dev/gemini-api/docs/deprecations)
  (verificado 2026-07-13).
- Gemini 3.1 Flash-Lite:
  [página do modelo](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite),
  [model card](https://deepmind.google/models/model-cards/gemini-3-1-flash-lite/),
  [lançamento GA](https://ai.google.dev/gemini-api/docs/changelog) e
  [lifecycle](https://ai.google.dev/gemini-api/docs/deprecations) (verificado
  2026-07-13).
- DeepSeek V4 Flash:
  [modelos e preços](https://api-docs.deepseek.com/quick_start/pricing),
  [changelog](https://api-docs.deepseek.com/updates/),
  [anúncio de preview](https://api-docs.deepseek.com/news/news260424/) e
  [model card oficial da família](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro)
  (verificado 2026-07-13).
- Mistral Small 4:
  [página do modelo](https://docs.mistral.ai/models/model-cards/mistral-small-4-0-26-03),
  [model card oficial](https://huggingface.co/mistralai/Mistral-Small-4-119B-2603)
  e [anúncio](https://mistral.ai/news/mistral-small-4/) (verificado
  2026-07-13).

### Transporte, schema e rotas elegíveis

O streaming é suportado pelo gateway para qualquer modelo e usa SSE quando
`stream: true`; essa propriedade é comum aos seis candidatos
([OpenRouter: streaming](https://openrouter.ai/docs/api/reference/streaming),
verificado 2026-07-13). O runtime vigente responde de forma síncrona. A
[arquitetura-alvo](arquitetura-conversacional-e-streaming.md) transmite progresso
tipado e só publica a resposta depois da validação; portanto, “streaming” aqui
significa capacidade de consumir o upstream e coletar telemetria, não exibir
tokens não validados.

| ID | Endpoints gerais / com `structured_outputs` | Endpoints ZDR / com `structured_outputs` | Providers ZDR observados | `temperature` na metadata |
| --- | ---: | ---: | --- | :---: |
| `openai/gpt-5.6-luna` | 5 / 5 | 2 / 2 | Azure | não |
| `anthropic/claude-sonnet-5` | 7 / 5 | 6 / 4 | Azure, Amazon Bedrock, Google Vertex | não |
| `google/gemini-3.5-flash` | 6 / 6 | 3 / 3 | Google Vertex | sim |
| `google/gemini-3.1-flash-lite` | 6 / 6 | 3 / 3 | Google Vertex | sim |
| `deepseek/deepseek-v4-flash` | 17 / 13 | 12 / 10 | doze rotas de terceiros; first-party DeepSeek ausente | sim |
| `mistralai/mistral-small-2603` | 2 / 2 | 1 / 1 | Venice | sim |

Contagens e nomes são **metadata perecível** dos endpoints públicos
([OpenAPI oficial](https://openrouter.ai/openapi.json),
[endpoint ZDR](https://openrouter.ai/api/v1/endpoints/zdr), verificado
2026-07-13). “Provider ZDR observado” não equivale a aprovação: a allowlist
normativa ainda precisa decidir quais processadores e quantizações são aceitos.

O campo de modelo `top_provider.is_moderated` foi `true` apenas para GPT-5.6
Luna e `false` para os outros cinco candidatos no snapshot. Esse booleano é uma
propriedade de roteamento, não uma escala comparável de segurança nem prova de
adequação ao threat model. A seleção deve manter policy gate, red-team,
fundamentação e validação idênticos para todos os modelos.

### Compatibilidade com o adapter

O adapter vigente sempre inclui `temperature` na chamada de chat, e o pipeline
usa valores como `0.0` e `0.2`
([`providers.py`](../../backend/src/incident_sense/providers.py),
[`pipeline.py`](../../backend/src/incident_sense/rag/pipeline.py)). GPT-5.6 Luna
e Claude Sonnet 5 não listam esse parâmetro no OpenRouter. A Anthropic documenta
que valores de sampling não default em Sonnet 5 retornam `400`
([mudanças de Sonnet 5](https://platform.claude.com/docs/en/docs/about-claude/models/whats-new-sonnet-5),
verificado 2026-07-13).

Nos Gemini 3.x, `temperature` aparece como suportado na metadata, mas a Google
recomenda remover `temperature`, `top_p` e `top_k` e controlar o raciocínio pelo
`thinking_level`. Suporte no gateway não equivale a configuração recomendada
([guia do Gemini 3.5](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5),
verificado 2026-07-13).

Isso não desqualifica os modelos; torna obrigatório que o adapter-alvo monte
parâmetros por capability e policy do provider. Enviar parâmetros incompatíveis e
depender do gateway para ignorá-los entraria em conflito com
`require_parameters: true`. O contract test deve provar que `temperature` é
omitido para GPT-5.6 Luna, Claude Sonnet 5 e Gemini 3.x, e que esforço de
raciocínio, `max_tokens`, schema e policy de provider chegam exatamente ao
OpenRouter.

O caminho preferencial usa `response_format.type = "json_schema"`, `strict: true`
e `additionalProperties: false`, com `require_parameters: true`. O mesmo schema
Pydantic valida a resposta localmente. JSON instruído permanece como piso de
compatibilidade somente onde a decisão normativa o permitir; a existência de
`structured_outputs` não autoriza afrouxar citações ou publicar resposta parcial
([OpenRouter: structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs),
verificado 2026-07-13).

## Leitura por candidato

### `openai/gpt-5.6-luna`

**Documentado.** GPT-5.6 Luna é a variante da família otimizada para workloads de
alto volume e sensíveis a custo. A página oficial publica contexto de 1,05 milhão,
saída de 128 mil, streaming e structured outputs. A família foi lançada GA quatro
dias antes do snapshot e possui system card próprio
([modelo](https://developers.openai.com/api/docs/models/gpt-5.6-luna),
[lançamento](https://openai.com/index/gpt-5-6/),
[system card](https://deploymentsafety.openai.com/gpt-5-6), verificado
2026-07-13).

**Metadata.** O catálogo publica US$ 1/US$ 6 por milhão, sem expiração, cinco
endpoints com structured outputs e duas rotas ZDR, ambas Azure. `temperature` não
é suportado. O `canonical_slug` é `openai/gpt-5.6-luna-20260709`.

**Inferência e lacuna.** É um candidato econômico dentro de uma família frontier,
mas quatro dias de GA não fornecem histórico operacional suficiente. O harness
precisa medir estabilidade, PT-BR, groundedness e latência no provider Azure
permitido. A avaliação deve registrar o slug canônico para detectar drift, mas
enviar o `id` público no campo `model`.

### `anthropic/claude-sonnet-5`

**Documentado.** Sonnet 5 é apresentado como combinação de velocidade e
inteligência, com contexto de um milhão e saída de 128 mil. A documentação de
Claude cobre português brasileiro explicitamente e o system card de Sonnet 5
inclui avaliações multilíngues e de segurança
([modelo](https://platform.claude.com/docs/en/docs/about-claude/models/whats-new-sonnet-5),
[multilíngue](https://platform.claude.com/docs/pt-BR/build-with-claude/multilingual-support),
[system card](https://www-cdn.anthropic.com/73ad94ca3c0502e75e46637cc62c8bd9532a7f2c/Claude%20Sonnet%205%20System%20Card.pdf),
verificado 2026-07-13).

**Metadata.** O preço OpenRouter é US$ 2/US$ 10 por milhão, sem expiração. Quatro
das seis rotas ZDR também suportam structured outputs. `temperature` não aparece
entre os parâmetros suportados.

**Risco de custo e compatibilidade.** O preço de US$ 2/US$ 10 é promocional até
2026-08-31; a Anthropic anuncia US$ 3/US$ 15 depois dessa data. Sonnet 5 também
usa tokenizer que produz aproximadamente 30% mais tokens que Sonnet 4.6 para o
mesmo texto, variando por conteúdo, e rejeita sampling parameters não default
([release notes](https://platform.claude.com/docs/en/release-notes/overview),
[mudanças do modelo](https://platform.claude.com/docs/en/docs/about-claude/models/whats-new-sonnet-5),
verificado 2026-07-13). O preflight financeiro deve usar o preço padrão já
anunciado ou um teto mais conservador, e contar prompts reais em PT-BR e inglês.

### `google/gemini-3.5-flash`

**Documentado.** Gemini 3.5 Flash é GA e pronto para escala, com contexto de
1.048.576, saída de 65.536 e structured outputs. O model card cobre desempenho
multilíngue, long-context, limitações e segurança
([modelo](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash),
[guia](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.5),
[model card](https://deepmind.google/models/model-cards/gemini-3-5-flash/),
verificado 2026-07-13).

**Metadata.** O OpenRouter publica US$ 1,50/US$ 9 por milhão, seis endpoints com
structured outputs e três rotas ZDR Google Vertex. O raciocínio é obrigatório;
`internal_reasoning` tem o mesmo preço unitário da saída no snapshot.

**Inferência e lacuna.** O rótulo Flash não prova menor latência end-to-end para
este workflow. Reasoning obrigatório pode aumentar tempo e custo mesmo em tarefas
simples. O harness deve comparar `reasoning_effort` permitido sem misturar tokens
internos com resposta útil nem com o custo do judge.

### `google/gemini-3.1-flash-lite`

**Documentado.** Gemini 3.1 Flash-Lite é GA, otimizado para alto volume,
classificação, tradução e tarefas sensíveis a latência. Seu earliest shutdown é
2027-05-07. O model card publica 363 tokens/s na configuração avaliada e MMMLU de
88,9%, mas esses números pertencem ao ambiente do Google e não predizem a rota do
OpenRouter
([modelo](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite),
[model card](https://deepmind.google/models/model-cards/gemini-3-1-flash-lite/),
[lifecycle](https://ai.google.dev/gemini-api/docs/deprecations), verificado
2026-07-13).

**Metadata.** O preço é US$ 0,25/US$ 1,50 por milhão; os seis endpoints gerais e
as três rotas ZDR declaram structured outputs. O raciocínio não é obrigatório e o
esforço default é `minimal`.

**Inferência e lacuna.** É a âncora natural para descobrir se um modelo menor
cumpre os gates sem pagar raciocínio desnecessário. O harness precisa provar
groundedness e cobertura de citações, especialmente em follow-ups, hard negatives
e code-switch; MMMLU não mede o contrato do copiloto.

### `deepseek/deepseek-v4-flash`

**Documentado.** A API do DeepSeek oferece V4 Flash com modos thinking e
non-thinking, contexto de um milhão e JSON Output. O model card oficial publica
MMMLU e MGSM, mas chama a família de preview. A documentação de JSON alerta que o
modo pode ocasionalmente devolver conteúdo vazio
([preços e capacidades](https://api-docs.deepseek.com/quick_start/pricing),
[model card da família](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro),
[JSON Output](https://api-docs.deepseek.com/guides/json_mode/), verificado
2026-07-13).

**Metadata.** O ID é o default vigente da aplicação
([`config.py`](../../backend/src/incident_sense/config.py)). O catálogo publica o
menor preço da shortlist, US$ 0,09/US$ 0,18 por milhão. Há 17 endpoints gerais,
mas apenas 13 declaram structured outputs; entre as 12 rotas ZDR, dez o declaram.
A rota first-party DeepSeek não está no conjunto ZDR. Contexto, quantização e
saída máxima variam por endpoint.

**Inferência e lacuna.** O modelo é necessário como controle de migração e piso de
custo, não como vencedor presumido. “Structured output” na metadata do gateway e
JSON mode first-party não provam aderência ao JSON Schema completo. Provider,
tag, quantização, modo de raciocínio e schema precisam ser fixados e registrados;
o harness deve detectar conteúdo vazio e diferença comportamental entre rotas.

### `mistralai/mistral-small-2603`

**Documentado.** Mistral Small 4 é um modelo aberto v26.03 com contexto de 256 mil,
structured outputs e reasoning configurável. O model card lista português e
inglês explicitamente. A Mistral reporta redução de 40% no tempo de completion em
setup otimizado contra Mistral Small 3, uma comparação interna que não equivale à
latência OpenRouter
([modelo](https://docs.mistral.ai/models/model-cards/mistral-small-4-0-26-03),
[model card](https://huggingface.co/mistralai/Mistral-Small-4-119B-2603),
[anúncio](https://mistral.ai/news/mistral-small-4/), verificado 2026-07-13).

**Metadata.** O OpenRouter publica US$ 0,15/US$ 0,60 por milhão, dois endpoints
com structured outputs e uma única rota ZDR, via Venice. Essa rota expõe contexto
de 256 mil; o máximo de saída não foi publicado no agregado do modelo.

**Inferência e lacuna.** A evidência de português e o custo justificam a inclusão.
Como a rota first-party Mistral não aparece no conjunto ZDR, a elegibilidade
depende de um único provider third-party, Venice: um failure domain único de
disponibilidade e comportamento. A rota ZDR única impede fallback sem mudar a
política. O harness precisa medir o contexto efetivamente necessário, truncamento,
latência p95 e comportamento quando a rota fica indisponível.

## Segurança e privacidade

O OpenRouter não armazena prompts ou respostas salvo opt-in, mas conserva metadata
como tokens e latência. Providers têm políticas próprias; quando utilizado, ZDR
precisa ser imposto por rota, e ausência de política clara é tratada
conservadoramente pelo gateway
([data collection](https://openrouter.ai/docs/guides/privacy/data-collection),
[provider logging](https://openrouter.ai/docs/guides/privacy/provider-logging/),
[ZDR](https://openrouter.ai/docs/guides/features/zdr), verificado 2026-07-13).

Sujeita à ratificação do ticket de threat model, a trilha conservadora usa no
request candidato a produção e no smoke, no mínimo:

```json
{
  "provider": {
    "zdr": true,
    "data_collection": "deny",
    "require_parameters": true,
    "only": ["<providers aprovados>"],
    "allow_fallbacks": false
  },
  "plugins": [
    {"id": "context-compression", "enabled": false}
  ]
}
```

Toda chamada também envia o header opt-in:

```http
X-OpenRouter-Metadata: enabled
```

Sem ele, o OpenRouter não devolve `openrouter_metadata` por default. O contract
test deve provar o header e o smoke deve falhar quando não conseguir validar
provider, modelo efetivo, attempts e pipeline. Como replay de cache omite essa
metadata, a evidência de release precisa garantir cache miss
([router metadata](https://openrouter.ai/docs/guides/features/router-metadata),
verificado 2026-07-13).

Para selecionar e versionar o modelo de referência, a configuração segura fixa
`allow_fallbacks: false`. Ela é mais restritiva que o default do OpenRouter, que
permite fallback; uma troca silenciosa pode alterar provider, quantização,
retenção e comportamento. Se redundância for aprovada, todos os destinos devem
permanecer na mesma interseção de ZDR, structured outputs e allowlist, e o
provider efetivo deve ser registrado
([provider routing](https://openrouter.ai/docs/guides/routing/provider-selection),
verificado 2026-07-13).

Model cards e moderação upstream são defesa em profundidade. Nenhum substitui o
policy gate local, a ausência de tools, o schema fechado, a validação de citações,
o isolamento entre incidentes ou os gates P0/P1. O harness deve aplicar os mesmos
ataques e critérios a todos os candidatos, independentemente do
`top_provider.is_moderated`.

## Latência: sinal disponível e limite da evidência

A Models API aceita ordenação por `latency-low-to-high`, definida como TTFT p50
recente, e `throughput-high-to-low`, definido como throughput p50 das heurísticas
de roteamento. Ela não devolveu os valores brutos nessas respostas, e os campos
`latency_last_30m`/`throughput_last_30m` dos endpoints examinados vieram `null`
([OpenRouter: Models API](https://openrouter.ai/docs/guides/overview/models),
verificado 2026-07-13).

O rank abaixo é, portanto, apenas **metadata direcional** entre 343 modelos do
catálogo. Menor rank significa posição anterior na ordenação; não significa
milissegundos nem garante a rota permitida:

| ID | Rank de TTFT p50 | Rank de throughput p50 |
| --- | ---: | ---: |
| `mistralai/mistral-small-2603` | 56 | 19 |
| `google/gemini-3.1-flash-lite` | 137 | 57 |
| `deepseek/deepseek-v4-flash` | 174 | 254 |
| `google/gemini-3.5-flash` | 176 | 79 |
| `openai/gpt-5.6-luna` | 225 | 144 |
| `anthropic/claude-sonnet-5` | 275 | 110 |

Rank verificado 2026-07-13 na mesma janela do snapshot. A seleção mede no
workflow completo, por modelo e provider permitidos: TTFT upstream, duração da
chamada, duração end-to-end, p50, p95, máximo, reasoning tokens, retries, erros e
cancelamento. Cold start e warm run permanecem separados, conforme o
[contrato de evals](evals-rag-conversacional-bilingue.md).

## Preço e limite de seleção

O teto de US$ 1,50 cobre a seleção inteira — sistema avaliado e judges — e deve
ser aplicado antes e durante a execução. O custo reportado pelo OpenRouter tem
precedência; uma estimativa prévia reserva o pior caso permitido por
`max_tokens`. Nenhuma chamada inicia se a reserva puder ultrapassar o saldo
restante, conforme o
[contrato de evals](evals-rag-conversacional-bilingue.md) e a
[documentação de usage](https://openrouter.ai/docs/cookbook/administration/usage-accounting).
Prompt caching pode ser automático, e cache write pode custar mais que input
comum; o preflight também precisa reservar essas categorias
([prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching),
verificado 2026-07-13).

Para tornar os preços comparáveis sem inventar um custo de suíte, a tabela abaixo
usa uma hipótese explícita: **uma única chamada**, 10.000 tokens de entrada,
1.000 de saída, sem cache, tools, web search, retries, markup de rota ou tokens
adicionais de raciocínio. Não é estimativa de turno nem de eval; o workflow faz
várias chamadas e cada tokenizer conta PT-BR e inglês de forma diferente.

| ID | Custo ilustrativo da chamada |
| --- | ---: |
| `openai/gpt-5.6-luna` | US$ 0,01600 |
| `anthropic/claude-sonnet-5` | US$ 0,03000 promocional; US$ 0,04500 no preço padrão anunciado |
| `google/gemini-3.5-flash` | US$ 0,02400 + reasoning não incluído |
| `google/gemini-3.1-flash-lite` | US$ 0,00400 + reasoning não incluído |
| `deepseek/deepseek-v4-flash` | US$ 0,00108 na rota de menor preço |
| `mistralai/mistral-small-2603` | US$ 0,00210 |

O preflight real usa a rota permitida, os prompts completos, o schema, o número
de etapas, `max_tokens`, reasoning e judge. Se a matriz bilíngue mínima não couber
no cap, o conjunto de casos é reduzido simetricamente antes da primeira chamada;
não se mascara estouro removendo retroativamente execuções caras. Smokes futuros
continuam limitados a US$ 0,10 e a suíte completa a US$ 0,50 por execução.

Sem assumir tamanho de corpus ou quantidade de casos, a condição de admissão da
execução é:

```text
Pentrada_pior_i = max(
  Pentrada_i,
  Pleitura_cache_i,
  Pescrita_cache_i
)

reserva = sum_i(
  (I_i * Pentrada_pior_i + O_i * Psaida_i + R_i * Preasoning_i) / 1_000_000
  + F_i
) <= US$ 1,50
```

`i` percorre **todas** as chamadas planejadas do sistema avaliado, judges e
retries autorizados; `I_i`, `O_i` e `R_i` são seus limites máximos de tokens;
`Pentrada_pior_i` é o maior preço **total** aplicável a um token de entrada entre
input comum, cache read e cache write na rota elegível. Se o provider publicar um
surcharge separado, ele compõe o preço total antes do `max`; preço ausente não
vira zero e bloqueia a rota até existir um limite conservador. `F_i` agrega tarifa
fixa, storage ou outra unidade não-token. Cada chamada só começa se seu pior caso
couber no saldo restante. O custo reportado após a chamada substitui a reserva
correspondente, e a execução para antes da próxima chamada quando a desigualdade
deixa de ser satisfeita. Assim, o cap limita o plano executável sem pressupor
quantos incidentes ou turnos existem.

## Candidato condicional e exclusões justificadas

### `qwen/qwen3.7-plus`: candidato condicional à decisão de ZDR

O catálogo publica contexto de um milhão, US$ 0,32/US$ 1,28 e
`structured_outputs`. A documentação oficial da família Qwen3 inclui português
entre 119 línguas e dialetos; a documentação do Qwen3.7 Plus confirma o modelo e
o preço. Porém, o único endpoint geral observado foi Alibaba e nenhum endpoint
ZDR apareceu
([Qwen3](https://qwenlm.github.io/blog/qwen3/),
[preços oficiais](https://help.aliyun.com/en/model-studio/model-pricing),
[OpenRouter ZDR](https://openrouter.ai/api/v1/endpoints/zdr), verificado
2026-07-13).

Além disso, a documentação first-party garante JSON mode com
`response_format.type = "json_object"` para Qwen3.7 Plus em non-thinking mode;
ela não documenta enforcement de JSON Schema. A metadata do OpenRouter pode
representar uma adaptação do endpoint, mas esse desvio precisa de contract test
antes de elegibilidade
([Alibaba: structured output](https://help.aliyun.com/en/model-studio/qwen-structured-output),
verificado 2026-07-13).

Critério para entrar no núcleo executável conservador: ao menos uma rota que passe
simultaneamente por ZDR, data-collection deny, provider allowlist, structured
outputs e contexto mínimo do harness. Se o ticket de threat model não exigir ZDR
para o escopo sintético, a elegibilidade deve ser recalculada pelos demais
controles antes do harness.

### Routers, aliases móveis e variantes gratuitas

`openrouter/auto`, `*-latest`, routers, variantes `:free`, preview e experimental
não servem como modelo de referência versionado. Eles podem mudar modelo efetivo,
provider, rate limit ou lifecycle fora do controle do manifest. Preview só deve
entrar como experimento comparativo com risco explícito; variante gratuita não é
base de disponibilidade nem custo de release. O OpenRouter documenta que model
fallback tenta IDs diferentes em ordem, o que exige registrar o modelo efetivo
([model fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks),
verificado 2026-07-13).

DeepSeek V4 Flash é a exceção controlada a essa regra por ser o default vigente e
necessário à comparação de migração. Seu status de preview permanece um risco
explícito e pode impedi-lo de se tornar referência mesmo que passe qualidade.

### Modelos premium e especializados

Variantes Pro, Opus, Fable, GPT-5.6 Terra/Sol, modelos de coding, visão, search e
reasoning dedicado ficam fora da seleção inicial. O fluxo é limitado,
text-to-text e grounded; não existe evidência de que custo e latência adicionais
sejam necessários. Se os seis candidatos falharem um gate de qualidade, o finding
do harness fornece a pergunta precisa para graduar outro modelo, preservando YAGNI
e o teto de US$ 1,50.

## Gaps que o harness precisa fechar

Nenhum item abaixo pode ser inferido de contexto, preço, nome comercial ou
benchmark geral:

1. **PT-BR e inglês por separado.** Medir rota, groundedness, correção,
   completude, citações, recusa e retenção em pares revisados; expor o pior idioma
   e code-switch.
2. **Schema real.** Exercitar o `CopilotAnswer` fechado com streaming,
   `strict: true`, citações estruturadas e falha segura; contar resposta vazia,
   truncada, reparada ou inválida.
3. **Fundamentação.** Verificar que diagnóstico, causa, comando e resolução usam
   apenas o incidente em análise ou incidentes históricos realmente recuperados e
   citados; contexto grande não altera essa invariante.
4. **Policy e segurança.** Executar injection direta e indireta, fora de escopo,
   isolamento, falsa citação, over-refusal e ausência legítima de evidência. Uma
   falha P0/P1 não é compensada por média.
5. **Capability-aware requests.** Confirmar omissão de `temperature` onde não
   suportado, reasoning effort explícito, `max_tokens`, data collection, provider
   allowlist, plugins desativados e `require_parameters` em cada chamada; confirmar
   ZDR quando exigido pela política ratificada.
6. **Roteamento efetivo.** Enviar `X-OpenRouter-Metadata: enabled` e registrar
   `model_requested`, modelo/provider efetivos, tag, quantização, contexto,
   generation ID, attempts e custo. Divergência ou campo ausente invalida o smoke
   de referência; replay de cache não serve como evidência.
7. **Variação entre providers.** Repetir casos sentinela nas rotas aprovadas do
   mesmo ID; detectar regressão de schema, qualidade, contexto e custo antes de
   autorizar fallback.
8. **Latência e disponibilidade.** Medir TTFT e end-to-end p50/p95, erros,
   timeouts, cancelamento e retry na rota permitida pela política ratificada. Rank
   global do gateway não substitui esses dados.
9. **Tokens e custo.** Contar input, output, cached e reasoning tokens por etapa,
   nas duas línguas; incluir judges e reservar pior caso antes da chamada.
10. **Long context útil.** Medir recuperação e uso de evidência nas janelas
    realmente necessárias. O modelo não recebe contexto excedente só porque a
    janela nominal comporta.
11. **Drift.** Comparar ID, `canonical_slug`, providers, parâmetros, preços,
    lifecycle e ZDR contra o manifest antes de smoke/full. Mudança não promove
    baseline silenciosamente.
12. **Maturidade.** Tratar GPT-5.6 Luna como GA recente, DeepSeek V4 como preview,
    Sonnet 5 com preço/tokenizer em transição e Mistral com rota ZDR única.

O harness não produz placar único. Invariantes duras passam por caso; qualidade,
latência e custo permanecem dimensões separadas, conforme
[`evals-rag-conversacional-bilingue.md`](evals-rag-conversacional-bilingue.md).

## Coleta da metadata

O relatório preserva os valores derivados, as fontes e o instante da coleta, mas
não versiona as respostas brutas do catálogo. Portanto, as tabelas são observações
datadas, não uma reconstrução histórica reproduzível depois de ocorrer drift. O
harness deve arquivar suas próprias projeções sanitizadas no manifest de cada
seleção.

### Projeção de modelos

Fonte: [`GET /api/v1/models`](https://openrouter.ai/api/v1/models), capturada em
`2026-07-13T15:06:21Z` (verificado 2026-07-13).

- modelos no catálogo: `343`;
- IDs projetados: os seis candidatos mais `qwen/qwen3.7-plus`;
- campos projetados: `id`, `canonical_slug`, `created`, `context_length`,
  `pricing.prompt`, `pricing.completion`, `pricing.internal_reasoning`,
  `pricing.input_cache_read`, `pricing.input_cache_write`, `top_provider`,
  `supported_parameters`, `expiration_date` e `reasoning`.

| `id` | `canonical_slug` | `context_length` | `expiration_date` | `response_format` / `structured_outputs` | `temperature` |
| --- | --- | ---: | :---: | :---: | :---: |
| `openai/gpt-5.6-luna` | `openai/gpt-5.6-luna-20260709` | 1.050.000 | `null` | sim / sim | não |
| `anthropic/claude-sonnet-5` | `anthropic/claude-sonnet-5-20260630` | 1.000.000 | `null` | sim / sim | não |
| `google/gemini-3.5-flash` | `google/gemini-3.5-flash-20260519` | 1.048.576 | `null` | sim / sim | sim |
| `google/gemini-3.1-flash-lite` | `google/gemini-3.1-flash-lite-20260507` | 1.048.576 | `null` | sim / sim | sim |
| `deepseek/deepseek-v4-flash` | `deepseek/deepseek-v4-flash-20260423` | 1.048.576 | `null` | sim / sim | sim |
| `mistralai/mistral-small-2603` | `mistralai/mistral-small-2603` | 262.144 | `null` | sim / sim | sim |
| `qwen/qwen3.7-plus` | `qwen/qwen3.7-plus-20260602` | 1.000.000 | `null` | sim / sim | sim |

O `id` é o valor a enviar. O `canonical_slug` entra no manifest como fingerprint
de versão e não substitui silenciosamente o ID público.

### Projeção de rotas ZDR

Fonte: [`GET /api/v1/endpoints/zdr`](https://openrouter.ai/api/v1/endpoints/zdr),
capturada na mesma janela (verificado 2026-07-13).

- endpoints projetados: `27`;
- campos projetados: `model_id`, `provider_name`, `tag`, `quantization`,
  `context_length`, preços de entrada/saída, `supported_parameters` e `status`.

O snapshot não contém endpoint para `qwen/qwen3.7-plus`. Entre os outros seis, a
contagem total de endpoints ZDR foi 27; 23 declararam `structured_outputs`. Uma
implementação deve recalcular a interseção, nunca copiar essa lista como allowlist
permanente.

### Método de nova coleta

O comando abaixo não executa inferência e não exige chave. Ele consulta as quatro
superfícies usadas nas tabelas: catálogo, ZDR, endpoints gerais e ordenações de
latência/throughput. Uma execução posterior mostra o estado do catálogo naquele
novo instante e pode divergir dos valores datados deste relatório.

```bash
set -euo pipefail

ids='[
  "openai/gpt-5.6-luna",
  "anthropic/claude-sonnet-5",
  "google/gemini-3.5-flash",
  "google/gemini-3.1-flash-lite",
  "deepseek/deepseek-v4-flash",
  "mistralai/mistral-small-2603",
  "qwen/qwen3.7-plus"
]'

models_projection="$({
  curl --fail --silent --show-error https://openrouter.ai/api/v1/models
} | jq -e --argjson ids "$ids" -S -c '
  if (.data | type) != "array" then
    error("models: data must be an array")
  else
    [.data[]
      | select(.id as $id | $ids | index($id))
      | {
          id,
          canonical_slug,
          created,
          context_length,
          pricing: {
            prompt: .pricing.prompt,
            completion: .pricing.completion,
            internal_reasoning: .pricing.internal_reasoning,
            input_cache_read: .pricing.input_cache_read,
            input_cache_write: .pricing.input_cache_write
          },
          top_provider,
          supported_parameters,
          expiration_date,
          reasoning
        }
    ] | sort_by(.id)
    | if length != ($ids | length) then
        error("models: candidate set is incomplete")
      elif all(.[];
        (.id | type) == "string"
        and (.canonical_slug | type) == "string"
        and (.context_length | type) == "number"
        and (.pricing.prompt | type) == "string"
        and (.pricing.completion | type) == "string"
        and (.supported_parameters | type) == "array"
      ) then .
      else error("models: required candidate fields are missing")
      end
  end
')"

zdr_projection="$({
  curl --fail --silent --show-error https://openrouter.ai/api/v1/endpoints/zdr
} | jq -e --argjson ids "$ids" -S -c '
  if (.data | type) != "array" then
    error("zdr: data must be an array")
  else
    [.data[]
      | select(.model_id as $id | $ids | index($id))
      | {
          model_id,
          provider_name,
          tag,
          quantization,
          context_length,
          pricing: {
            prompt: .pricing.prompt,
            completion: .pricing.completion
          },
          supported_parameters,
          status
        }
    ] | sort_by(.model_id, .provider_name, .tag)
    | if all(.[];
        (.model_id | type) == "string"
        and (.provider_name | type) == "string"
        and (.supported_parameters | type) == "array"
      ) then .
      else error("zdr: required endpoint fields are missing")
      end
  end
')"

readarray -t model_ids < <(jq -er '.[]' <<<"$ids")
test "${#model_ids[@]}" -eq 7

endpoints_projection=""
for id in "${model_ids[@]}"; do
  endpoint_projection="$({
    curl --fail --silent --show-error \
      "https://openrouter.ai/api/v1/models/${id}/endpoints"
  } | jq -e --arg id "$id" -S -c '
      if .data.id != $id or (.data.endpoints | type) != "array" then
        error("endpoints: response is incomplete for \($id)")
      else
        {
          id: $id,
          endpoints: [
            .data.endpoints[]
            | {
                provider_name,
                tag,
                quantization,
                context_length,
                pricing,
                supported_parameters,
                status
              }
          ] | sort_by(.provider_name, .tag)
        }
        | if all(.endpoints[];
            (.provider_name | type) == "string"
            and (.supported_parameters | type) == "array"
          ) then .
          else error("endpoints: required fields are missing for \($id)")
          end
      end
    ')"
  endpoints_projection+="${endpoint_projection}"$'\n'
done

rankings_projection=""
for sort in latency-low-to-high throughput-high-to-low; do
  ranking_projection="$({
    curl --fail --silent --show-error \
      "https://openrouter.ai/api/v1/models?sort=${sort}"
  } | jq -e --argjson ids "$ids" --arg sort "$sort" -S -c '
      if (.data | type) != "array" then
        error("ranking: data must be an array")
      else
        {
          sort: $sort,
          total: (.data | length),
          ranks: [
            .data
            | to_entries[]
            | select(.value.id as $id | $ids | index($id))
            | {id: .value.id, rank: (.key + 1)}
          ]
        }
        | if (.ranks | length) == ($ids | length) then .
          else error("ranking: candidate set is incomplete")
          end
      end
    ')"
  rankings_projection+="${ranking_projection}"$'\n'
done

printf '%s\n' "$models_projection"
printf '%s\n' "$zdr_projection"
printf '%s' "$endpoints_projection"
printf '%s' "$rankings_projection"
```

## Riscos de volatilidade

- preço do catálogo é o menor preço do modelo e pode mudar com provider,
  promoção, contexto, cache, reasoning ou política de rota;
- endpoints, ZDR, quantização, contexto e parâmetros suportados mudam sem alterar
  o ID público;
- rankings de latência e throughput refletem uma janela recente, não SLA;
- alias público pode continuar igual enquanto o slug canônico ou comportamento
  muda;
- model cards de provedores usam datasets, modos e harnesses diferentes e não são
  comparáveis como um ranking único;
- GA reduz risco de lifecycle, mas não prova estabilidade do gateway ou qualidade
  no domínio; `expiration_date: null` não é compromisso de disponibilidade;
- structured output do provider, do gateway e do endpoint específico são camadas
  distintas;
- políticas de retenção e provider logging são perecíveis e precisam ser
  revalidadas antes de cada mudança de portfólio e release candidate.

O manifest da seleção deve arquivar a projeção sanitizada, seus hashes, o momento,
o ID solicitado, slug canônico, provider/tag efetivos, parâmetros, preços, tokens
e custo reportado. Metadata ausente permanece desconhecida; nunca vira zero nem é
inferida do nome do modelo.

## Resultado

A rota está clara para o próximo passo: implementar o harness provider-neutral e
executar os seis candidatos sob os mesmos casos, providers permitidos e gates,
dentro de US$ 1,50. A pesquisa não sustenta promover qualquer modelo a referência
antes desses evals. Qwen3.7 Plus permanece condicional à ratificação de ZDR ou a
uma rota que satisfaça esse controle; modelos fora da shortlist graduam apenas
diante de uma falha observável que os seis não consigam fechar.
