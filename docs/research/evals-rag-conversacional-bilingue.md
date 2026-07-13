# Evals para RAG conversacional bilíngue

> Fontes externas e comportamentos de terceiros verificados em 2026-07.

## Pergunta

Quais ferramentas, métricas e padrões devem compor um harness provider-neutral
para avaliar o copiloto contextual em PT-BR e inglês, cobrindo fundamentação,
citações, recuperação, conversa, segurança, robustez, eficiência e custo sem
misturar testes determinísticos de pull request com evals reais de release
candidate?

Este relatório recomenda a arquitetura do harness e o vocabulário de medição.
Os thresholds numéricos de qualidade, o tamanho final do corpus e as rubricas
normativas pertencem à decisão de contrato de avaliação. Nenhuma chamada paga foi
executada para esta pesquisa.

## Recomendação executiva

Adotar um **núcleo fino, próprio e tipado em Python** como contrato canônico dos
evals. O núcleo deve usar Pydantic para datasets e artifacts versionados, funções
puras para métricas determinísticas, `pytest` para gates offline e portas pequenas
para o sistema avaliado e para juízes semânticos. Evals reais usam um runner
assíncrono explícito, separado da descoberta de testes, e exercitam a aplicação
completa em vez de chamar apenas o modelo.

Essa direção combina:

- **métricas determinísticas próprias** para schema, protocolo, policy,
  recuperação por IDs, citações estruturais, isolamento, limites e custo;
- **rubricas semânticas bilíngues próprias**, calibradas contra anotação humana e
  executadas por adapters substituíveis;
- as definições de retrieval do Ragas e as decomposições de claims e citações de
  RAGChecker e ALCE como referências metodológicas, sem tornar seus schemas a
  fonte de verdade;
- um adapter opcional de DeepEval como primeira experiência para juízes de
  faithfulness e conversa, desde que telemetria, carregamento de `.env` e saída
  local sejam controlados;
- Promptfoo apenas como ferramenta complementar de descoberta adversarial
  black-box, com geração remota desativada e resultados traduzidos para o
  artifact canônico;
- Inspect AI e Phoenix fora do baseline: são competentes, mas acrescentam uma
  abstração geral ou um serviço de observabilidade que o escopo local não exige.

O harness não produz um placar único. A aceitação é um **vetor de gates**:
invariantes duras passam por caso; métricas de qualidade mantêm threshold e
intervalo de confiança por dimensão; PT-BR e inglês aparecem separadamente; P0 e
P1 de segurança nunca são compensados por médias melhores em outros cenários.

Testes de PR permanecem herméticos, offline e determinísticos. O release candidate
executa o modelo de referência versionado em ambiente protegido, no mesmo commit
que se pretende promover. Modelos secundários geram comparação informativa e não
alteram o veredito. Os limites financeiros do mapa — US$ 1,50 para seleção,
US$ 0,10 por smoke e US$ 0,50 por suíte completa — abrangem sistema e juízes e são
aplicados antes e durante a execução.

## Por que um núcleo próprio e fino

Escolher um framework pronto como autoridade do contrato parece mais simples, mas
transfere para ele decisões que são específicas do domínio:

- quais afirmações operacionais exigem evidência e quais explicações gerais são
  permitidas;
- quais incidentes podem fundamentar cada claim;
- como fontes citadas derivam da resposta estruturada;
- como um turno se ancora no incidente em análise e não herda contexto de outro;
- quais falhas são P0/P1 e bloqueiam por ocorrência;
- como o modelo efetivamente usado, tokens e custo atravessam OpenRouter e OpenAI;
- quais dados podem ser persistidos em artifacts públicos.

Frameworks também mudam APIs, templates de judge e formatos de resultado em ritmos
independentes do produto. O guia oficial de migração do Ragas, por exemplo,
documenta mudanças amplas entre 0.3 e 0.4 em datasets, métricas e experimentos
([Ragas: migração 0.3 → 0.4](https://docs.ragas.io/en/stable/howtos/migrations/migrate_from_v03_to_v04/)).

A divergência de uma solução turnkey é intencional. O padrão aplicado é **híbrido**:
contrato e métricas verificáveis pertencem ao produto; bibliotecas especializadas
entram atrás de adapters. Isso preserva DRY no que é commodity sem terceirizar
invariantes de segurança, linguagem ou evidência.

## Restrições e termos

O harness avalia o **copiloto contextual de incidentes** descrito em
[`CONTEXT.md`](../../CONTEXT.md), não um chatbot genérico:

- memória é efêmera e isolada pelo incidente em análise;
- o workflow é limitado e não-agentic;
- conhecimento geral pode explicar conceitos;
- diagnóstico, causa, comandos e passos de resolução exigem evidência permitida;
- ausência de incidente histórico semelhante não transforma uma falha técnica em
  `IMPROCEDENTE`;
- a aplicação é read-only e usa exclusivamente dados sintéticos.

Neste relatório:

- **groundedness** é a proporção de claims verificáveis sustentadas pelo conjunto
  de evidências permitido;
- **faithfulness** é usado como sinônimo operacional de groundedness somente quando
  a implementação da métrica adota essa mesma definição;
- **correção de citação** mede se uma fonte citada sustenta a claim associada;
- **cobertura de citação** mede se toda claim que exige evidência tem pelo menos
  uma citação correta;
- **correção de resposta** mede aderência ao resultado esperado e permanece
  separada de groundedness: uma resposta pode ser fiel a evidência insuficiente e
  ainda estar errada;
- **retenção** mede o uso correto de fatos necessários de turnos do mesmo
  incidente;
- **isolamento** mede a ausência de influência ou vazamento entre incidentes;
- **provider-neutral** qualifica os contratos do harness. O runtime continua com
  chat via OpenRouter e embeddings via OpenAI conforme o
  [ADR 0004](../decisions/0004-openrouter-mais-openai.md).

## Estado do repositório

### Seams aproveitáveis

`RagDeps` injeta `LLMClient`, `EmbeddingClient` e `VectorRetriever` por
`Protocol` ([`rag/clients.py`](../../backend/src/incident_sense/rag/clients.py)). O
pipeline separa resumo, embedding, pré-filtro, busca, pós-filtro, classificação e
geração ([`rag/pipeline.py`](../../backend/src/incident_sense/rag/pipeline.py)).
Esses seams permitem medir recuperação antes e depois do pós-filtro e executar
testes com fakes sem rede.

`RetrievedHit`, `RetrievedCandidate` e `SuggestResponse` carregam IDs, scores,
payloads e parte das decisões intermediárias
([`models/suggest.py`](../../backend/src/incident_sense/models/suggest.py)). Os
embeddings e clusters commitados mantêm o seed local determinístico. Os testes do
backend demonstram injeção hermética e respostas controladas.

O contrato `LLMClient.complete(...) -> str`, porém, descarta mensagens, modelo
efetivo, identificadores, uso e custo. O harness conversacional não deve ampliar
esse retorno com objetos de SDK. O contrato futuro precisa de request/result
tipados, com extensões do provider em um campo isolado, e instrumentação por
decorator ou adapter.

### Material de avaliação e lacunas

O corpus commitado contém 431 incidentes, dos quais 326 têm notas de resolução,
70 carregam a tag `ruido` e três carregam a tag `demo`. Os oito arquétipos possuem
resolução canônica e são material útil para criar casos. Eles não constituem, por
si só, um dataset de eval:

- `archetype_id` não é preservado no schema persistido de `Incident`;
- tags compartilhadas são proxies frágeis de relevância;
- não há queries com conjuntos gold de evidências relevantes, inclusive relevância
  graduada;
- faltam mapeamentos claim→fonte e claims obrigatórias para medir citações;
- somente as demos trazem intenção explícita de classificação, e `borderline` não
  fixa um veredito normativo;
- prompts, arquétipos e casos são PT-BR; não existem pares em inglês, code-switch ou
  cenários multi-turn;
- não há casos adversariais de isolamento, injeção, citação forjada ou abuso de
  limites.

`referenced_incidents` também corresponde aos sobreviventes do pós-filtro, não às
citações realmente validadas no texto. O contrato alvo de citações estruturadas
definido na
[pesquisa de arquitetura](arquitetura-conversacional-e-streaming.md) é uma
pré-condição para gates estruturais completos.

O dataset de produção pode fornecer candidatos, mas o gold de avaliação precisa
ser curado e versionado separadamente. Inferir o gold das próprias respostas do
pipeline criaria um teste circular.

### CI e release

`backend-ci` executa Ruff, mypy e pytest sem credenciais. `pytest` descobre apenas
`backend/tests`, e `make check` mantém as duas stacks offline. Esse caminho é o
gate correto de PR.

O workflow de release aceita tags finais, mas não associa a publicação a uma
evidência de eval do mesmo SHA. O runner real deve ficar em workflow próprio e
protegido; a promoção posterior verifica commit, dataset, modelo de referência e
artifact, sem transformar uma chamada externa flakey em required check de todo PR.

## Comparação de ferramentas

| Alternativa | Pontos fortes | Limites para este produto | Papel recomendado |
| --- | --- | --- | --- |
| Python + Pydantic + `pytest` | Pertence à stack; tipos, fixtures, parametrização, plugins JUnit; execução local e controle integral de privacidade | Métricas, runner, comparação e relatório precisam de implementação pequena | **Contrato canônico e gates determinísticos** |
| DeepEval | Integração com pytest, modelos customizados, métricas RAG e conversacionais, execução local | Templates genéricos; OpenAI é default; telemetria e `.env` exigem hardening; retenção genérica não prova isolamento | Adapter experimental para judges semânticos calibrados |
| Ragas | Vocabulário maduro de context precision/recall e faithfulness; métricas baseadas em IDs; adapters de modelos | Não cobre o workflow, protocolo, segurança ou artifacts normativos; API passou por migração ampla | Referência metodológica e adapter opcional, não autoridade |
| Promptfoo | Testes black-box HTTP, sessões multi-turn, assertions, JUnit e catálogo amplo de red team | Segunda stack; cache/retry alteram medições; estimativa de tokens por palavras é fraca em PT-BR; geração remota pode sair do boundary | Descoberta adversarial opcional, sempre normalizada |
| Inspect AI | Tasks/datasets/solvers/scorers, logs portáveis, muitos providers e estatística customizável | Abstração voltada a evals gerais e agentic; exige solver para a aplicação e duplica o núcleo | Diferir até existir programa de eval mais amplo |
| Phoenix | Datasets, experiments, anotações, traces OpenTelemetry e integrações com Ragas/DeepEval | Serviço e armazenamento adicionais; superfície operacional e licença Elastic 2.0 | Visualização opcional futura, fora do gate |
| LlamaIndex eval | Proximidade com primitivas presentes no runtime e avaliadores de RAG | Expandiria o boundary estreito do ADR 0002; não resolve contrato conversacional, segurança ou CI | Não adotar como harness |

### Python, Pydantic e pytest

O núcleo canônico precisa de poucos componentes:

1. schemas Pydantic para caso, suite, resultado, manifest e comparação;
2. loader que valida versões, IDs, referências e hashes antes de executar;
3. `TargetAdapter` para execução in-process, HTTP real e replay;
4. `JudgeAdapter` para função determinística, humano e LLM;
5. funções puras de métrica;
6. runner assíncrono com orçamento, concorrência limitada e checkpoint;
7. writers para JSON/JSONL, Markdown e JUnit.

`pytest` valida schemas, métricas e cenários gravados. O runner real não recebe nome
`test_*.py`, não entra em `testpaths` e exige comando explícito. Assim, importar um
módulo ou executar `make test` nunca dispara cobrança.

### DeepEval

DeepEval oferece execução local, integração com pytest e modelos customizados
([guia de início](https://deepeval.com/docs/getting-started)). Suas métricas de
[Faithfulness](https://deepeval.com/docs/metrics-faithfulness),
[Contextual Precision](https://deepeval.com/docs/metrics-contextual-precision),
[Contextual Recall](https://deepeval.com/docs/metrics-contextual-recall),
[Conversation Completeness](https://deepeval.com/docs/metrics-conversation-completeness)
e [Knowledge Retention](https://deepeval.com/docs/metrics-knowledge-retention) dão
um bom ponto de partida para prototipar um judge.

Os scores não devem entrar diretamente no gate. Prompts e critérios precisam ser
adaptados ao vocabulário do domínio, às duas línguas e à separação entre explicação
geral e orientação operacional. `KnowledgeRetentionMetric` mede perda de
informação no diálogo, mas não testa contaminação entre dois incidentes; o harness
mantém cenários sentinela próprios.

Se o adapter for usado, o ambiente fixa `DEEPEVAL_TELEMETRY_OPT_OUT=1`,
`DEEPEVAL_DISABLE_DOTENV=1` e `DEEPEVAL_RESULTS_FOLDER` para uma pasta temporária
controlada. Esses comportamentos são documentados nas
[variáveis de ambiente do DeepEval](https://deepeval.com/docs/environment-variables).
O adapter converte apenas score, razão, erro e metadados permitidos para o schema
canônico. Login e upload para serviço hospedado não fazem parte do gate.

### Ragas, RAGChecker e ALCE

Ragas oferece versões com e sem LLM de
[context precision](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/)
e [context recall](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_recall/).
As variantes baseadas em IDs são especialmente adequadas a PRs determinísticos.
O artigo do sistema descreve a avaliação orientada a referências e sem referências
([EACL 2024](https://aclanthology.org/2024.eacl-demo.16/)).

[RAGChecker](https://arxiv.org/abs/2408.08067) decompõe o resultado por claims e
separa falhas do retriever das do generator. Seu valor aqui é a taxonomia — claim
recall, context precision, context utilization, noise sensitivity e hallucination
— e não a dependência: o repositório de referência traz premissas linguísticas e
uma superfície maior do que o harness necessita
([código primário](https://github.com/amazon-science/RAGChecker)).

[ALCE](https://arxiv.org/abs/2305.14627) separa correctness, completeness e quality
de citações. Essa separação evita o erro de chamar uma citação sintaticamente
válida de fundamentação correta. O harness adota as categorias, adaptadas a IDs de
incidentes e ao contrato estruturado
([implementação de referência](https://github.com/princeton-nlp/ALCE)).

### Promptfoo

Promptfoo pode tratar a aplicação como alvo HTTP e manter sessão entre turnos
([provider HTTP](https://www.promptfoo.dev/docs/providers/http/)). Produz JSON,
JSONL e JUnit, entre outros formatos
([outputs](https://www.promptfoo.dev/docs/configuration/outputs/)), e seu catálogo
de red team inclui testes de RAG, atribuição de fontes e cross-session
([plugins](https://www.promptfoo.dev/docs/red-team/plugins/)).

O uso recomendado é exploratório e sanitizado:

- `PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION=true` impede a geração remota
  padrão descrita na
  [configuração de red team](https://www.promptfoo.dev/docs/red-team/configuration/);
- retries automáticos ficam desativados ou explicitamente contabilizados;
- cache fica desativado em medições de latência e repetição
  ([caching](https://www.promptfoo.dev/docs/configuration/caching/));
- tokens e custo vêm do provider ou do adapter, não da estimativa por contagem de
  palavras do provider HTTP;
- outputs brutos não são publicados, pois podem incluir configuração e conteúdo;
- toda descoberta vira um caso defensivo curado no dataset canônico.

Promptfoo não decide o release. A regra impede que uma atualização de plugin, uma
chamada remota implícita ou um formato externo altere silenciosamente o contrato.

### Inspect AI e Phoenix

Inspect AI estrutura evals como dataset, solver, scorer e metrics e suporta
providers variados ([documentação](https://inspect.aisi.org.uk/)). Seus
[eval logs](https://inspect.aisi.org.uk/eval-logs.html) e
[scorers customizados](https://inspect.aisi.org.uk/scorers.html) são adequados a
programas amplos de avaliação de modelos. Para este produto, um solver precisaria
recriar o adapter da aplicação e os logs tenderiam a duplicar artifacts próprios.
Recursos de agents e sandboxes também ficam fora do escopo não-agentic.

Phoenix combina observabilidade OpenTelemetry, datasets, experiments e anotações
humanas ([visão geral](https://arize.com/docs/phoenix)). Também integra traces de
avaliadores e bibliotecas externas
([evaluation](https://arize.com/docs/phoenix/evaluation/llm-evals)).
A contrapartida é operar outro processo, banco e interface, além da licença
[Elastic License 2.0](https://arize.com/docs/phoenix/self-hosting/license). O
baseline local não justifica esse custo. Um export futuro pode alimentar Phoenix
sem torná-lo dependência do gate.

Serviços gerenciados e suites ligadas a um único provider não entram na shortlist
canônica. Eles podem consumir o artifact aberto, mas credenciais, disponibilidade
externa e schema proprietário não podem determinar a aceitação do release.

## Contrato provider-neutral

### Portas

O núcleo deve depender de estruturas próprias, não de respostas de SDK:

```text
TargetAdapter.run(EvalInput) -> EvalExecution
JudgeAdapter.score(JudgeInput, RubricVersion) -> JudgeResult
Metric.evaluate(Expected, Actual) -> MetricResult
ArtifactWriter.write(EvalRun) -> ArtifactSet
```

`TargetAdapter` possui três implementações conceituais:

- **in-process** para etapas do pipeline com dependências fake;
- **HTTP/SSE** para o release candidate, exercitando serialização, policy,
  retrieval, validação e transporte;
- **replay** para reavaliar métricas e rubricas sem repetir chamadas pagas.

`JudgeAdapter` recebe apenas os campos necessários à rubrica. O resultado contém
`rubric_version`, `judge_requested`, `judge_effective`, provider, score, classe,
razão estruturada, erro, latência, uso e custo. Um adapter nunca decide threshold
nem escreve diretamente no artifact final.

Provider-neutralidade não apaga proveniência. O envelope preserva o identificador
pedido e o modelo/provider efetivamente reportados. Campos ausentes permanecem
`null`; não são inferidos do nome solicitado.

### Versionamento

Cada execução fixa e registra:

- versão do schema do harness;
- versão e SHA-256 do dataset e do corpus;
- commit da aplicação e indicador de worktree limpa;
- versão do prompt, policy, rubrica e judge;
- modelo solicitado, modelo efetivo, provider e parâmetros;
- configuração de retrieval e pós-filtro;
- seeds, número de repetições e ordem dos casos;
- versões do runner, adapters e bibliotecas opcionais.

Mudanças em prompt de judge, parser, normalization ou fórmula de métrica são
mudanças de instrumento, não simples refactors. Elas exigem nova versão, nova
calibração e uma baseline produzida pelo mesmo instrumento. Comparar scores de
instrumentos diferentes como uma série contínua é inválido.

## Dataset de eval

### Unidade e schema

A unidade estatística é uma **conversa**, mesmo quando contém vários turnos. Um
caso precisa ter ID imutável, idioma, família, severidade e proveniência sintética.
Um manifest versionado referencia os JSONL e seus hashes.

Exemplo conceitual reduzido:

```json
{
  "schema_version": "eval-case/v1",
  "case_id": "citation.pix-timeout.pt-BR.001",
  "locale": "pt-BR",
  "pair_id": "citation.pix-timeout.001",
  "family": "grounded-answer",
  "severity": "P2",
  "incident_id": "INC-ANALISE-001",
  "turns": [
    {"role": "user", "content": "..."}
  ],
  "expected": {
    "route": "retrieve-and-answer",
    "relevant_evidence": [
      {"incident_id": "INC-0042", "relevance": 3}
    ],
    "required_claims": [
      {"claim_id": "claim-1", "kind": "operational", "rubric": "..."}
    ],
    "allowed_sources": ["INC-ANALISE-001", "INC-0042"],
    "forbidden_sources": ["SENTINEL-OTHER-INCIDENT"],
    "refusal": "must-not-refuse"
  },
  "tags": ["pix", "citation", "paired"]
}
```

Texto esperado integral deve ser evitado. Claims atômicas, rotas, evidências,
ações proibidas e rubricas aceitam formulações corretas diferentes sem transformar
similaridade lexical em qualidade.

### Composição mínima

O corpus precisa cruzar, em PT-BR e inglês:

- perguntas de primeiro turno e follow-ups com anáfora;
- explicação conceitual sem retrieval, pergunta operacional com retrieval e casos
  `PROCEDENTE` sem base histórica;
- casos `IMPROCEDENTE`, fora de escopo e benignos que não devem ser recusados;
- todos os arquétipos, ruído, typos, dados incompletos e evidência conflitante;
- relevância fácil, hard negatives, distractors e ausência legítima de evidência;
- claims suportadas, parcialmente suportadas e não suportadas;
- citações corretas, incompletas, forjadas e apontando para fonte errada;
- retenção no mesmo incidente, troca explícita de incidente, compactação e
  sentinelas de isolamento;
- prompt injection e abuso em cada campo não confiável, sem registrar payloads ou
  bypasses sensíveis em artifact público;
- cancelamento, retry, timeout, sequência SSE inválida e falha de provider;
- paráfrases, ordem alterada, ruído ortográfico e code-switch.

Casos semanticamente pareados vinculam PT-BR e inglês por `pair_id`, mas não
substituem casos originalmente escritos em cada idioma. Tradução automática não é
gold: uma pessoa fluente revisa equivalência de intenção, evidência e dificuldade.
Termos técnicos e IDs permanecem inalterados quando essa é a linguagem do domínio.

[MIRAGE-Bench](https://arxiv.org/abs/2410.13716) demonstra avaliação de RAG em 18
idiomas e reforça a necessidade de medir por língua em vez de assumir que um score
em inglês se transfere. O harness reporta `pt-BR`, `en`, pares e code-switch como
slices distintos.

### Splits e proveniência

Recomenda-se separar:

- `development`: exemplos visíveis para construir rubricas e adapters;
- `regression`: conjunto estável usado nos gates;
- `challenge`: casos rotativos para detectar overfitting ao conjunto estável;
- `calibration`: amostra duplamente anotada para validar os judges.

Em um repositório público, um split commitado não é um holdout secreto. O relatório
e o manifest não devem alegar cegueira que não existe. A defesa é processual:
prompts não são otimizados apenas contra IDs estáveis, challenge sets mudam de forma
versionada e resultados são confirmados por revisão humana estratificada.

Cada caso registra se deriva de arquétipo, incidente sintético, falha de regressão
ou cenário de threat model. IDs não são reutilizados. Alterar o comportamento
esperado cria nova revisão do dataset e deixa a baseline anterior reproduzível.
Dados reais, traces de contas privadas e conteúdo copiado de sistemas externos são
proibidos.

## Métricas canônicas

### Regras de agregação

Toda métrica precisa declarar unidade, denominador, tratamento de ausência e
direção desejada. O resultado inclui contagem bruta, `n`, score, casos inválidos e
slice. Denominador zero produz `not_applicable`, não zero ou um por conveniência.

O relatório de release mostra:

- valor por caso quando a falha é uma invariante;
- macroagregado por família para evitar que famílias numerosas dominem o score;
- PT-BR e inglês separadamente, além do pior slice;
- pares bilíngues e variantes metamórficas como deltas pareados;
- intervalo de confiança para métricas amostrais;
- contagem e IDs dos casos que falharam, sem publicar detalhe sensível.

Não se usa média de scores heterogêneos, nem um índice ponderado de “qualidade
geral”. Um índice permite compensar uma citação inventada com menor latência e
esconde exatamente a falha que um gate deve expor.

### Saúde da execução e protocolo

Antes de avaliar conteúdo, o harness mede validade da execução:

- taxa de casos iniciados, concluídos, cancelados, inválidos e com erro;
- schema válido em request, evento e resposta terminal;
- sequência e cardinalidade dos eventos SSE;
- correlação por `client_turn_id`, `turn_id` e conversa;
- exatamente um terminal por turno e nenhum evento após o terminal;
- timeout, cancelamento e retry sem tarefa órfã ou resposta duplicada;
- modelo solicitado e efetivo registrados;
- telemetria completa ou campos explicitamente desconhecidos.

Esses itens são assertions determinísticas. Falha de transporte não vira resposta
ruim com score zero: permanece erro de execução e bloqueia o gate correspondente.

### Policy, classificação e roteamento

Cada caso declara a rota esperada, como `answer-general`,
`retrieve-and-answer`, `answer-without-historical-suggestion`, `refuse` ou
`request-clarification`. O harness produz matriz de confusão, precision, recall e
F1 por rota, com atenção especial a:

- `PROCEDENTE` sem evidência histórica;
- pergunta geral que não deve consumir retrieval;
- conteúdo fora de escopo que deve ser recusado;
- pergunta benigna e em escopo que não deve sofrer over-refusal;
- falha de parser ou provider, que não pode inferir procedência pela presença de
  hits.

A última condição captura uma contradição observável do pipeline vigente: o
fallback de classificação usa a existência de candidatos, embora procedência e
existência de base sejam conceitos independentes.

### Retrieval

Com `rel(i) > 0` indicando que o incidente na posição `i` é relevante:

- `Precision@k = relevantes recuperados no top-k / k`;
- `Recall@k = relevantes gold recuperados no top-k / relevantes gold`;
- `Hit@k = 1` quando pelo menos um relevante aparece no top-k;
- `MRR = média de 1 / posição do primeiro relevante`;
- `nDCG@k` preserva os graus de relevância e penaliza ordenação ruim;
- taxa de false retrieval mede casos sem evidência gold que ainda retornam fonte;
- recall de claim mede a fração de claims gold coberta pelo contexto recuperado.

Precision, recall e ranking são calculados separadamente na saída do vector store
e após o pós-filtro. Sem essa separação, um retriever saudável pode receber culpa
por um postfilter agressivo, ou o inverso. O relatório também segmenta por idioma,
arquétipo, ruído, hard negative, ausência de evidência e quantidade de candidatos.

Gold de retrieval usa IDs e relevância graduada atribuída por revisão. Similaridade
vetorial, cluster e tags não são labels. Em casos com várias evidências aceitáveis,
o gold lista alternativas e o conjunto mínimo necessário.

### Groundedness, correção e completude

A resposta é decomposta em claims atômicas. Cada claim recebe uma classe:

- `operational`: diagnóstico, causa, comando ou passo de resolução; exige fonte;
- `incident-fact`: fato do incidente em análise; exige o contexto autoritativo;
- `general-explanation`: explicação conceitual permitida sem incidente histórico;
- `unsupported-or-prohibited`: não pode aparecer naquela resposta.

Métricas principais:

- **groundedness de claims** = claims verificáveis produzidas e suportadas /
  claims verificáveis produzidas;
- **completude da resposta** = claims gold necessárias cobertas corretamente /
  claims gold necessárias;
- **correção da resposta** = claims produzidas corretas em relação à rubrica /
  claims avaliadas;
- **utilização de contexto** = claims suportadas que usam contexto recuperado /
  claims recuperáveis presentes no contexto;
- **sensibilidade a ruído** = claims influenciadas por distractors / claims
  avaliadas.

Groundedness não avalia somente sobreposição lexical. O judge recebe claim, fonte,
contexto do incidente em análise, regra de policy e idioma. Generalizações que
ultrapassam a fonte são falhas mesmo quando compartilham vocabulário.

Uma resposta sem claims verificáveis recebe `not_applicable` para groundedness e é
avaliada por rota, recusa e utilidade. Uma resposta que deveria trazer orientação,
mas se omite, falha em completude; não ganha groundedness perfeito por ter
denominador vazio.

### Citações

As métricas de citação operam sobre a estrutura validada, não por regex sobre o
Markdown final:

- **validade estrutural** = citações com ID conhecido e permitido / citações;
- **citation precision/correctness** = pares claim→fonte em que a fonte sustenta a
  claim / pares claim→fonte avaliados;
- **citation recall/coverage** = claims que exigem evidência e têm ao menos uma
  citação correta / claims que exigem evidência;
- **qualidade da fonte** verifica se a evidência mais direta e autoritativa foi
  usada quando há várias fontes;
- **fonte espúria** conta incidente citado sem relação com qualquer claim;
- **fonte omitida** conta claim operacional sustentada no texto, mas sem vínculo
  estruturado.

`sources` da resposta é derivado das citações validadas. Ele não pode ser uma lista
independente preenchida com todos os hits. Citação ao incidente em análise e
citação a histórico mantêm tipos distintos para que o judge não trate descrição
do problema como evidência de uma resolução passada.

Validade estrutural e ausência de ID forjado são gates de 100% por caso. Correção
semântica e cobertura usam judge calibrado e thresholds definidos no contrato de
avaliação.

### Conversa, retenção e isolamento

Uma conversa declara fatos requeridos, intenção e resposta esperada por turno. As
métricas são:

- **turn goal success**: objetivo do turno atendido sem violar policy;
- **conversation completeness**: intenções necessárias atendidas / intenções
  declaradas;
- **retenção**: fatos necessários de turnos válidos usados corretamente / fatos
  necessários;
- **contradição**: fatos do mesmo incidente contraditos após serem estabelecidos;
- **resolução de referência**: anáforas e elipses associadas ao referente correto;
- **isolamento**: sentinelas, fatos ou fontes de outro incidente presentes na
  execução corrente;
- **estabilidade de compactação**: decisão, rota, fontes e constraints preservadas
  antes e depois do resumo determinístico do histórico.

Retenção alta não implica isolamento. O primeiro é um score de utilidade; o segundo
é uma invariante de segurança com tolerância zero. A unidade de bootstrap e gate é
a conversa completa, evitando tratar turnos correlacionados como amostras
independentes.

### Recusa e segurança

Para casos que exigem ou proíbem recusa:

- `refusal recall = recusas corretas / casos que exigem recusa`;
- `refusal precision = recusas corretas / todas as recusas`;
- false-refusal rate mede recusas em solicitações benignas e em escopo;
- resposta segura porém inútil é reportada separadamente de recusa correta;
- evasão parcial conta como falha, não como meio acerto.

Segurança segue as severidades e invariantes da
[pesquisa de threat model](threat-model-e-controles-do-copiloto-contextual.md):

- `attack success rate = compromissos bem-sucedidos / tentativas`;
- taxa de isolamento mede qualquer influência cross-incident;
- vazamento de sentinela, segredo, configuração ou instrução interna é binário;
- citação forjada, orientação operacional sem evidência e renderização ativa
  insegura mantêm gates próprios;
- injeção é segmentada por origem, turno, idioma e posição no ranking.

Qualquer caso P0/P1 bem-sucedido bloqueia o release. ASR agregado serve para
diagnóstico e comparação, não para autorizar uma ocorrência crítica. Payload,
cadeia de exploração e remediação de vulnerabilidade concreta permanecem em canal
privado.

### Robustez e paridade bilíngue

Casos metamórficos preservam a intenção e variam um fator: paráfrase, typo, ordem,
ruído, distractor, posição da evidência, alternância de idioma ou compactação. O
harness mede:

- consistência de rota e policy;
- diferença pareada de retrieval e groundedness;
- pior resultado entre variantes equivalentes;
- taxa de regressão introduzida pela transformação;
- diferença PT-BR↔inglês em pares semanticamente equivalentes.

Uma transformação só é válida quando revisão humana confirma que não mudou a
resposta esperada. Paridade não exige texto idêntico nem força scores exatamente
iguais; exige thresholds por língua e limite explícito para a diferença pareada.
O pior idioma permanece visível mesmo quando a média combinada passa.

### Latência, tokens e custo

Cada execução mede duração end-to-end e por etapa (`policy`, `classify`, `rewrite`,
`embed`, `retrieve`, `postfilter`, `generate`, `validate`). Reporta distribuição,
`p50`, `p95`, máximo, taxa de erro e número de retries. Cold start e warm run não
são misturados.

Por chamada externa, registra:

- propósito da chamada;
- modelo solicitado e efetivo, provider e generation/request ID;
- input, output, cached e reasoning tokens quando fornecidos;
- duração total e tempo até o primeiro evento ou byte quando observável;
- finish reason, retry e erro;
- custo, moeda e origem do valor.

OpenRouter retorna uso com tokens e custo no response e no chunk final de streaming
([usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)).
Esse valor tem precedência sobre estimativa. Se o provider não fornecer custo após
uma falha, o campo fica `unknown`; zero significaria uma medição que não existe.
Estimativa usa tabela de preços versionada e marcada como estimativa, nunca dados
privados de billing.

O harness separa consumo do **system under test** e do **judge**, mas o cap da
execução considera a soma. Antes de iniciar uma chamada, o runner reserva o pior
caso permitido por `max_tokens`; concorrência limitada impede várias chamadas em
voo de ultrapassarem o orçamento. Divergência entre reserva, estimativa e custo
reportado fica no artifact.

As convenções GenAI do OpenTelemetry definem métricas como uso de tokens e duração
([semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md)).
Como esse conjunto permanece em status de desenvolvimento, o schema próprio é a
autoridade e oferece um mapping versionado para OpenTelemetry, não o inverso.

## Calibração humana dos judges

Um LLM judge é um instrumento probabilístico. O score só pode bloquear release
depois de demonstrar concordância aceitável com humanos no mesmo domínio, língua e
rubrica. Estudos de LLM-as-a-judge documentam vieses de posição, verbosidade e
autopreferência
([Judging LLM-as-a-Judge](https://arxiv.org/abs/2306.05685),
[estudo de position bias](https://arxiv.org/abs/2406.07791)).

O processo recomendado:

1. selecionar amostra estratificada por idioma, família, severidade e dificuldade;
2. anonimizar modelo, provider e ordem das respostas;
3. fazer duas anotações independentes por pessoas fluentes e treinadas na rubrica;
4. adjudicar divergências e registrar a razão normativa;
5. medir concordância humana antes de usar o gold;
6. comparar judge contra gold com matriz de confusão, precision, recall, F1 e taxa
   de falso positivo/negativo por slice;
7. inspecionar erros críticos individualmente;
8. congelar modelo, prompt, temperatura, parser e versão da rubrica;
9. repetir a calibração quando qualquer componente do instrumento mudar.

Para labels binários, percentual de acordo e Cohen's kappa tornam visível o acordo
além do acaso. Para escalas ordinais ou anotadores múltiplos, usa-se estatística
compatível, como weighted kappa ou Krippendorff's alpha, declarando pesos e dados
ausentes. Nenhum coeficiente substitui a análise de falsos negativos críticos.

Rubricas devem conter critérios observáveis, exemplos positivos e negativos nas
duas línguas, regra para evidência parcial e opção `cannot-determine`. A razão do
judge precisa apontar claim e evidência; raciocínio livre não é gold.

Um judge diferente do sistema avaliado reduz autopreferência, mas não garante
independência. Casos próximos ao threshold, discordâncias entre judges e toda
falha crítica recebem revisão humana. O contrato de avaliação define o tamanho da
amostra e os níveis mínimos de concordância.

## Incerteza e regressão

Métricas agregadas reportam estimativa pontual e intervalo de confiança de 95%.
Bootstrap é feito por conversa, estratificado ou clusterizado por família quando a
amostra exigir, conforme o contrato. A implementação pode usar o método BCa
disponível no
[`scipy.stats.bootstrap`](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html),
com seed e número de reamostragens registrados.

Comparações entre candidate e baseline usam os **mesmos casos** e delta pareado.
O veredito considera:

- regressão absoluta contra threshold;
- delta e intervalo de confiança contra a baseline;
- pior slice e diferença entre idiomas;
- número de casos que mudaram de pass→fail;
- falhas duras, independentemente do intervalo.

Repetições são reservadas a etapas estocásticas e casos limítrofes. Temperatura
zero e seed solicitado reduzem variação, mas não provam determinismo em serviços
externos. O manifest registra cada tentativa. Resultado de judge inválido entra na
taxa de erro; não é descartado silenciosamente nem convertido em score favorável.

O NIST AI RMF recomenda TEVV repetível, documentação de datasets, ferramentas,
métricas, limitações e incerteza, além de revisão independente e de domínio
([MEASURE](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/),
[programa TEVV](https://www.nist.gov/ai-test-evaluation-validation-and-verification-tevv)).
O manifest e a calibração tornam essa orientação verificável no repositório.

## Três modos de execução

| Modo | Rede e credenciais | Conteúdo | Veredito |
| --- | --- | --- | --- |
| PR determinístico | Proibidos | Schemas, fakes, replays e métricas puras | Required gate em todo PR |
| RC smoke/full | Environment protegido e allow-list | Aplicação real, modelo de referência e judges calibrados | Gate do mesmo SHA antes da promoção |
| Agendado | Environment protegido, somente com orçamento | Suíte de drift e adversarial definida | Abre regressão; não altera release publicado |

### Pull request

O gate de PR inclui:

- validação de JSONL, manifest, hashes, IDs e referências;
- testes unitários de todas as fórmulas e casos de denominador zero;
- contract tests de adapters e resposta estruturada;
- protocolo SSE, cancelamento, timeout e retry com fakes;
- routes de policy e classificação gravadas;
- retrieval por IDs antes/depois do pós-filtro;
- validade e cobertura estrutural das citações;
- isolamento por sentinela e proibição de conteúdo entre incidentes;
- redaction e ausência de segredo/conteúdo integral em logs;
- geração de artifacts e comparação com baseline gravada.

Não há `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, acesso externo ou fallback live. Um
adapter que não encontra fixture falha com mensagem explícita. Snapshots armazenam
estruturas estáveis, não prose integral sensível nem respostas aceitas por mera
semelhança textual.

Mudanças em prompt, policy, corpus, modelo allow-listed ou rubrica passam pelo gate
offline e marcam o commit como requerendo RC; elas não tentam simular qualidade
real apenas com mocks.

### Release candidate

O workflow RC:

1. recebe SHA imutável, versão do dataset e modo `smoke` ou `full`;
2. exige approval de um GitHub Environment e usa secrets somente nesse job;
3. confirma worktree limpa e allow-list de modelos;
4. sobe Qdrant local com artifacts commitados;
5. estima e reserva o orçamento total antes de qualquer chamada;
6. executa o modelo de referência e os judges calibrados com concorrência limitada;
7. compara com baseline do mesmo instrumento;
8. publica artifacts sanitizados mesmo em falha;
9. produz veredito legível e status de custo;
10. permite promoção apenas do mesmo SHA com todos os gates verdes.

O smoke seleciona casos sentinela de todas as dimensões críticas e para antes de
US$ 0,10. A suíte completa respeita US$ 0,50. Seleção controlada de modelos respeita
US$ 1,50. O contrato normativo fixa moeda, arredondamento, reserva e comportamento
quando o provider não retorna custo.

Modelo secundário roda somente quando o orçamento autoriza e aparece em seção
comparativa não bloqueante. Trocar silenciosamente o modelo de referência por
fallback invalida a execução; `model_effective` divergente é falha de configuração.

### Execução agendada

Execução recorrente só existe com orçamento recorrente aprovado. Ela usa o mesmo
schema e pode ampliar repetições, challenge set e descoberta adversarial. Mudança
de comportamento externo abre um finding reproduzível com manifest e caso mínimo;
não reescreve artifacts ou thresholds de releases publicados.

## Artifacts e CI

O bundle canônico contém:

| Arquivo | Conteúdo |
| --- | --- |
| `manifest.json` | SHA, hashes, versões, modelos, parâmetros, ambiente, orçamento e timestamps |
| `cases.jsonl` | expected/actual normalizado, métricas, razões, fontes e status por conversa |
| `events.jsonl` | eventos e spans sanitizados necessários para diagnóstico |
| `summary.json` | agregados, slices, intervalos, deltas e veredito legível por máquina |
| `summary.md` | resumo humano para GitHub Actions/PR |
| `junit.xml` | gates e falhas compactas para integração com CI |
| `calibration.json` | versão do gold humano, acordo e desempenho dos judges |
| `checksums.sha256` | integridade dos arquivos publicados |

Artifacts do GitHub Actions são adequados para compartilhar resultados entre jobs
e manter evidência de workflow
([workflow artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts)).
Retenção e acesso são configurados explicitamente; credenciais e dados privados
nunca entram no bundle. GitHub Environments fornecem regras de proteção e secrets
escopados ao job
([deployment environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments)).

Conteúdo integral de conversa fica desativado por padrão mesmo com dados
sintéticos. O artifact normalizado preserva IDs, claims necessárias, hashes e
trechos mínimos permitidos. Diagnóstico que depende do texto integral usa artifact
de retenção curta e acesso restrito. Findings exploráveis ficam fora de artifacts
públicos.

O summary precisa responder de imediato:

- qual SHA, dataset, modelo e instrumento foram avaliados;
- quanto foi gasto e qual parcela veio do SUT e dos judges;
- quais gates passaram, falharam ou não puderam ser executados;
- quais slices regrediram e qual a incerteza;
- se o artifact pode promover exatamente aquele SHA.

## Gates recomendados para o contrato normativo

O contrato de avaliação deve transformar esta pesquisa em thresholds concretos.
A estrutura recomendada é:

| Gate | Forma | Pode ser compensado? |
| --- | --- | --- |
| Schema, protocolo, IDs e citações estruturais | Todos os casos passam | Não |
| Isolamento e P0/P1 | Zero ocorrência por caso | Não |
| Policy e recusa | Threshold por classe + teto de false refusal | Não entre classes |
| Retrieval | Recall, precision e nDCG pré/pós-filtro por slice | Não entre idiomas |
| Groundedness e cobertura | Threshold + CI por idioma/família | Não por latência |
| Conversa e retenção | Threshold por cenário + sentinelas duras | Isolamento não compensa |
| Robustez e paridade | Teto de delta pareado e pior slice | Não pela média global |
| Latência | p50/p95 end-to-end e por etapa | Não por qualidade |
| Tokens e custo | Cap duro por execução e relatório por chamada | Não |
| Calibração do judge | Acordo e erros por idioma/família | Não por score do SUT |

Thresholds devem ser sustentados por baseline, risco e tamanho de amostra; números
arbitrários copiados de um framework não constituem decisão. O contrato também
define quais falhas permitem rerun, quantos reruns, quem adjudica e como uma
exceção expira.

## Sequência de construção recomendada

Esta pesquisa não implementa o harness. Um protótipo descartável pode validar a
direção na seguinte ordem:

1. fechar o contrato de avaliação, rubricas, corpus e thresholds;
2. criar schemas próprios e um dataset mínimo bilíngue com hashes;
3. implementar métricas determinísticas e gerar o bundle sem chamadas externas;
4. conectar replay e os seams existentes do pipeline;
5. adicionar target HTTP/SSE quando o contrato conversacional estiver definido;
6. calibrar uma rubrica semântica pequena contra humanos;
7. experimentar DeepEval atrás de `JudgeAdapter` e comparar com uma implementação
   direta;
8. executar smoke real protegido dentro do cap;
9. adicionar Promptfoo somente se a descoberta adversarial trouxer casos que o
   dataset canônico não representa;
10. promover o harness após demonstrar reprodutibilidade, privacidade e artifacts.

A primeira entrega deve aprofundar um módulo pequeno. Não introduz serviço de
eval, banco de traces, broker, memória persistente, framework agentic ou segundo
gateway de chat. Isso preserva os ADRs
[0001](../decisions/0001-arquitetura-e-stack.md),
[0002](../decisions/0002-llamaindex-no-rag.md),
[0005](../decisions/0005-qdrant-como-vector-db.md),
[0006](../decisions/0006-execucao-local-e-determinismo.md),
[0008](../decisions/0008-saida-estruturada.md) e
[0010](../decisions/0010-dataset-sintetico.md).

## Trade-offs aceitos

### Mais código próprio, menor lock-in semântico

O núcleo exige schemas, runner e writers próprios. Em troca, o contrato permanece
estável quando uma biblioteca muda prompt, API ou formato. O código próprio fica
limitado a invariantes do produto e cola tipada; não reimplementa clientes de
provider, UI de traces ou algoritmos estatísticos maduros.

### Calibração custa tempo, gate sem calibração custa confiança

Dupla anotação e adjudicação tornam a preparação mais cara. Um judge não calibrado
é rápido, mas seus falsos positivos podem liberar orientação sem evidência e seus
falsos negativos podem bloquear respostas úteis. A calibração é parte do produto,
não uma validação opcional do framework.

### Evals reais fora do PR reduzem imediatismo, aumentam honestidade

O PR não mede comportamento vivo do provider. O RC fornece esse sinal no ponto em
que custo, variação externa e credenciais podem ser controlados. Replays e métricas
determinísticas mantêm feedback rápido durante desenvolvimento.

### Resposta pública, evidência operacional mínima

Artifacts detalhados melhoram debugging, mas podem vazar prompts, configuração ou
findings exploráveis. O bundle canônico publica estrutura, scores e razões mínimas;
conteúdo integral e material de segurança usam retenção e acesso restritos.

## Decisões que permanecem abertas

A pesquisa resolve a forma do harness, mas deixa para o contrato normativo:

- número de casos e distribuição por slice;
- thresholds e intervalos mínimos de cada métrica;
- tamanho da amostra de calibração e acordo aceitável;
- rubricas bilíngues finais e procedimento de adjudicação;
- modelo e versão do judge, inclusive fallback permitido;
- `k`, relevância graduada e gold final de retrieval;
- política exata para retries, indisponibilidade e custo desconhecido;
- retenção e nível de acesso de cada artifact;
- critérios para promover uma descoberta adversarial a regressão pública ou a
  finding privado.

O protótipo do harness deve testar essas decisões, não defini-las por conveniência
da biblioteca.

## Conclusão

O harness provider-neutral adequado ao incident-sense é um contrato próprio,
pequeno e versionado em Python, não a adoção integral de uma plataforma de eval.
Ele mantém o que precisa ser determinístico sob pytest, mede a aplicação completa
em release candidates protegidos e trata judges semânticos como instrumentos
calibrados e substituíveis.

Ragas, RAGChecker e ALCE fornecem vocabulário e decomposições úteis; DeepEval é o
primeiro adapter semântico a experimentar; Promptfoo amplia descoberta adversarial;
Inspect AI e Phoenix permanecem opções para uma escala que o produto não exige.
Essa composição preserva o runtime local, torna custo e proveniência auditáveis e
impede que médias, idiomas ou ferramentas escondam uma violação de evidência ou
isolamento.
