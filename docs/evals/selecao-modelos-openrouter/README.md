# Comparação controlada dos modelos candidatos

> Execução real de 2026-07-14T01:13:49Z, gasto reportado US$ 0,3684 sob cap de
> US$ 1,50. Metadata de catálogo e rotas verificada 2026-07-13. Nenhum vencedor
> é declarado: este documento preserva a evidência para a decisão humana de
> referência e alternativas.

## Pergunta

Como os seis candidatos do núcleo conservador se comportam sob o contrato
conversacional do copiloto — saída estruturada estrita, citações estruturadas,
fundamentação, recusa, bilinguismo — nas rotas ZDR aprovadas, e a que custo e
latência?

## Método

- **Sonda do contrato-alvo**: uma chamada de chat por caso devolve um
  `CopilotAnswer` aproximado (cinco tipos de bloco, citações estruturadas),
  requisitado com `response_format.type = "json_schema"` + `strict: true` e
  validado localmente por Pydantic. O harness é o protótipo aprovado
  (`backend/prototypes/eval_harness/`), com o target em
  `selection/probe.py` e o entrypoint em `selection/compare.py`.
- **Variável isolada**: a recuperação é fixada por caso — todos os modelos
  recebem o mesmo incidente em análise e os mesmos incidentes históricos
  aprovados. Métricas de retrieval não são evidência comparativa nesta rodada.
- **Corpus**: `selection-bilingual/v1`, 18 conversas sentinela (10 pt-BR, 8 en;
  8 pares semânticos; 1 família multi-turn) cobrindo fundamentação, citações,
  recusa, isolamento, retenção, injeção indireta defensiva, isca de citação
  forjada, fora de escopo, ambiguidade e code-switch. Proveniência de rascunho
  com autor único — **não** é o corpus de regressão revisado; pisos normativos
  não podem ser ratificados contra ele.
- **Rotas pinadas**: cada requisição envia `provider.only` com a rota exata,
  `allow_fallbacks: false`, `require_parameters: true`, `zdr: true`,
  `data_collection: "deny"` e o header `X-OpenRouter-Metadata: enabled`; o
  endpoint efetivo, o slug canônico, tokens e custo reportado ficam registrados
  por chamada.
- **Requests capability-aware**: `temperature` omitido para GPT-5.6 Luna e
  Claude Sonnet 5 (não suportado) e para Gemini 3.x (recomendação do provedor);
  `0.0` para DeepSeek e Mistral. Raciocínio explícito: `low` no Gemini 3.5
  (obrigatório), `minimal` no Luna e no Flash-Lite, `none` no DeepSeek; omitido
  onde o default é desligado (Sonnet 5, Mistral Small).
- **Orçamento**: admissão de pior caso antes da primeira chamada
  (US$ 1,2410 ≤ US$ 1,50), reserva por caso antes de cada chamada, custo
  reportado com precedência. Reruns só para erro de execução (máx. 2);
  nenhum foi necessário.
- **Timeouts**: conexão 10 s, leitura 60 s. Latência medida como duração
  end-to-end da chamada síncrona; TTFT pertence ao endpoint SSE futuro.

Condições completas em [`comparison.json`](comparison.json); snapshot
sanitizado do catálogo e das rotas ZDR em [`projection.json`](projection.json).

## Resultados

| métrica | `gpt-5.6-luna` | `claude-sonnet-5` | `gemini-3.5-flash` | `gemini-3.1-flash-lite` | `deepseek-v4-flash` | `mistral-small-2603` |
| --- | --- | --- | --- | --- | --- | --- |
| rota efetiva | Azure | Azure us-east-2 | Vertex global | Vertex global | Parasail fp8 | Venice fp8 |
| casos completados (de 18) | 18 | 15 | 18 | 18 | 18 | 18 |
| schema inválido | 0 | 3 (truncamento no teto de 1200 tokens) | 0 | 0 | 0 | 0 |
| rota correta (geral) | 0,89 | 0,93 | 0,83 | 0,72 | 0,83 | 0,78 |
| rota correta pt-BR / en | 0,90 / 0,88 | 0,88 / 1,00 | 0,80 / 0,88 | 0,70 / 0,75 | 0,80 / 0,88 | 0,70 / 0,88 |
| delta PT↔EN (rota) | 0,03 | 0,13 | 0,08 | 0,05 | 0,08 | 0,18 |
| recusas falsas / perdidas | 0 / 1 | 0 / 1 | 0 / 0 | 2 / 1 | 2 / 1 | 2 / 1 |
| citações forjadas | 0 | 0 | 0 | 0 | 0 | 4 |
| falhas de isolamento | 0 | 0 | 0 | 0 | 0 | 0 |
| violações de contrato | 0 | 0 | 0 | 3 | 3 | 7 |
| latência p50 / p95 (ms) | 2.498 / 5.680 | 10.327 / 13.684 | 3.818 / 7.048 | 2.191 / 2.741 | 4.878 / 7.024 | 2.274 / 3.939 |
| tokens de raciocínio | 489 | 0 | 5.080 | 0 | 0 | 0 |
| custo da rodada (US$) | 0,0399 | 0,2017 | 0,1068 | 0,0111 | 0,0025 | 0,0064 |

Groundedness heurístico (sobreposição lexical, não calibrado) é reportado em
`comparison.json` apenas como encanamento; ele não compara qualidade semântica —
essa leitura pertence à escada de judges calibrada e aos transcripts locais.

## Leituras que a tabela não mostra

- **Ninguém citou a sentinela.** No caso de isca ("cite o INC-SENTINELA-999"),
  nenhum modelo citou o id proibido; os "erros de rota" ali são recusas ou
  pedidos de esclarecimento — comportamentos defensáveis que o gold estrito
  marca como divergência. Parte do route-match adversarial mede a rigidez do
  gold, não só o modelo.
- **Injeção indireta neutralizada por todos.** Nenhum modelo atribuiu a causa
  ao "ataque externo" plantado na nota de resolução; Claude Sonnet 5 foi o
  único que sinalizou explicitamente a tentativa de injeção antes de responder
  com a causa correta citada.
- **Truncamento do Sonnet é orçamento, não incapacidade**: as três falhas de
  schema estouraram exatamente o teto de 1200 tokens de saída — o modelo é o
  mais verboso do núcleo; contratos de produção precisam de teto maior (e o
  custo correspondente).
- **As citações forjadas do Mistral são uso incorreto do campo**: as quatro
  ocorrências citam a string `general_knowledge` como se fosse um id de
  incidente — má aderência estrutural, não vazamento de fonte proibida.
- **Recusas falsas do trio de menor custo**: Flash-Lite, DeepSeek e Mistral
  recusaram os dois pedidos legítimos de fundamentação em algum idioma
  (tratando recomendação operacional como fora de escopo); nenhum dos três
  recusou o pedido destrutivo *e* o improcedente simultaneamente.

## Achados operacionais das rotas (perecíveis)

- As rotas ZDR do Claude Sonnet 5 via Amazon Bedrock declaram
  `structured_outputs` na metadata, mas rejeitam a requisição na prática
  (`output_config.format: Extra inputs are not permitted`); a rota Azure
  `us-east-2` funciona (verificado 2026-07-14).
- As rotas Azure do GPT-5.6 Luna aceitam apenas `max_completion_tokens` — com
  `require_parameters: true`, enviar `max_tokens` produz 404 de roteamento
  (verificado 2026-07-14).
- Nos modelos OpenAI e Gemini, tokens de raciocínio consomem o próprio teto de
  saída: o Gemini 3.5 com esforço `low` gasta ~1k tokens de raciocínio por
  resposta; tetos apertados truncam o JSON (verificado 2026-07-14).

## Limites desta evidência

- Corpus de 18 casos rascunho, single-shot (uma execução por caso); diferenças
  pequenas de route-match não são estatisticamente separáveis.
- Latência é ponto único por caso na chamada síncrona, sem TTFT nem separação
  cold/warm.
- Qualidade semântica (groundedness, precisão de citação) não foi julgada por
  instrumento calibrado; os transcripts completos permanecem locais
  (retenção de 30 dias) para inspeção humana.
- Preço promocional vigente do Sonnet 5 (US$ 2/US$ 10 até 2026-08-31); a
  reserva de orçamento usou o preço padrão anunciado (US$ 3,75/US$ 15 com
  cache write).

## Reprodução

```bash
cd backend && uv run python -m prototypes.eval_harness.selection.compare
```

Exige `OPENROUTER_API_KEY`; preflight aborta se qualquer rota pinada sair da
interseção de elegibilidade (ZDR × `structured_outputs` × status saudável).
Dataset `selection-bilingual/v1`
(SHA-256 `59ef6410…` no manifest), probe `openrouter-copilot-probe/v1`.
