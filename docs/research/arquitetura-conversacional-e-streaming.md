# Arquitetura conversacional e streaming para o copiloto contextual

> Fontes externas e comportamentos de terceiros verificados em 2026-07.

## Pergunta

Qual arquitetura permite transformar a Aurora em um **copiloto contextual de
incidentes** realmente conversacional e com progresso transmitido pelo backend,
preservando o pipeline RAG explícito, a fundamentação por incidentes históricos,
a execução local e a testabilidade por injeção de dependências?

O relatório fixa uma direção técnica para a especificação. Não implementa o fluxo
nem define a estratégia de compatibilidade do endpoint vigente.

## Recomendação executiva

Adotar um **workflow assíncrono próprio, limitado e não-agentic**, com uma função
testável por etapa e portas assíncronas injetáveis. Cada turno recebe a mensagem e
um histórico efêmero limitado, ancora-se no incidente carregado pelo backend e
executa `policy → classify → rewrite → retrieve → answer → validate`. Recuperação
só ocorre quando o classificador do turno a exige.

O transporte recomendado é **SSE tipado sobre `POST`**, consumido pelo navegador
com `fetch` e `ReadableStream` diretamente do FastAPI. A stack travada já inclui
FastAPI com suporte SSE nativo; WebSocket, BFF no Next.js e uma dependência SSE
adicional não aprofundam o módulo para este caso unidirecional.

O backend transmite progresso real e fontes selecionadas, mas entrega o texto da
Aurora somente no evento terminal `answer.completed`, depois de validar o schema e
as citações. Essa resposta atômica abre mão de token streaming para impedir que um
diagnóstico, comando ou passo ainda não fundamentado apareça como orientação
operacional válida.

LlamaIndex permanece no boundary já aceito: `TextNode`, `NodeWithScore`,
`QueryBundle` e `BaseNodePostprocessor`. `CondensePlusContextChatEngine`, `Memory`,
`ChatStore`, response synthesizers e Workflows ficam fora: assumiriam memória,
síntese e ciclo de vida que o domínio precisa controlar e validar explicitamente.

## Restrições

### Domínio

- A conversa permanece limitada ao incidente em análise, aos incidentes históricos
  recuperados e ao domínio de operações de incidentes. A Aurora não é um assistente
  genérico nem um agente autônomo (`CONTEXT.md`).
- Toda orientação operacional deve ser uma **sugestão fundamentada**: afirmações de
  diagnóstico e resolução precisam ser rastreáveis ao incidente em análise ou a
  incidentes históricos citados (`CONTEXT.md`).
- O copiloto é read-only. Inserir texto na interface pode preparar um rascunho para
  revisão humana, mas a conversa não pode executar ações operacionais nem alterar o
  incidente por conta própria (`CONTEXT.md`).
- `PROCEDENTE` classifica uma falha técnica real, mesmo sem evidência histórica
  semelhante; ausência de base impede a sugestão fundamentada, não a classificação
  (`CONTEXT.md`).

### Arquitetura já aceita

- O sistema é um monólito simples composto por FastAPI, Next.js e Qdrant local. Não
  há espaço, sem revisão explícita da decisão, para broker, serviço de memória
  gerenciado ou microsserviço de streaming
  ([ADR 0001](../decisions/0001-arquitetura-e-stack.md)).
- LlamaIndex fornece primitivas pontuais, enquanto os clientes de LLM, embeddings e
  busca permanecem atrás de `Protocol` para testes offline. Adotar a stack completa
  de chat/query engine contraria o motivo registrado para limitar o acoplamento e
  exigiria decisão explícita
  ([ADR 0002](../decisions/0002-llamaindex-no-rag.md)).
- Chat usa OpenRouter, embeddings usam OpenAI e a seleção pública de modelo é
  resolvida por uma allow-list no backend
  ([ADR 0004](../decisions/0004-openrouter-mais-openai.md)).
- A recuperação continua apoiada em Qdrant local, com filtro de metadados e vetores
  de 3072 dimensões
  ([ADR 0005](../decisions/0005-qdrant-como-vector-db.md)).
- Somente o caminho interativo de sugestão depende de chamadas externas. Dataset,
  embeddings e clusters commitados continuam sendo as fontes determinísticas da
  demonstração
  ([ADR 0006](../decisions/0006-execucao-local-e-determinismo.md)).
- Pós-filtro e classificação dependem de JSON instruído no prompt e validado com
  Pydantic. Deltas parciais dessas etapas não constituem saída válida e não devem ser
  tratados como resultado de domínio
  ([ADR 0008](../decisions/0008-saida-estruturada.md)).
- Dados e citações representam somente o Banco Meridiano fictício e seu dataset
  sintético
  ([ADR 0010](../decisions/0010-dataset-sintetico.md)).

## Estado atual

### Backend

O lockfile fixa FastAPI 0.138.0, Starlette 1.3.1, OpenAI Python 2.43.0,
LlamaIndex Core 0.14.22 e Pydantic 2.13.4 (`backend/uv.lock`). FastAPI 0.138.0
inclui `fastapi.sse`, introduzido na versão 0.135.0, portanto a recomendação não
exige biblioteca SSE adicional.

O endpoint `POST /api/suggest` é síncrono e retorna um único `SuggestResponse` após
terminar todo o trabalho (`backend/src/incident_sense/api/suggest.py`). Falhas de
infraestrutura anteriores à resposta são convertidas em um `502` localizado; não há
contrato para erro depois de a resposta começar.

`run_suggestion` executa, em série:

1. resumo da consulta por LLM;
2. embedding;
3. pré-filtro opcional;
4. busca vetorial;
5. pós-filtro por LLM;
6. classificação por LLM;
7. sugestão por LLM, somente quando o incidente é procedente e há base.

As quatro interações possíveis com LLM usam `LLMClient.complete` e materializam uma
string completa (`backend/src/incident_sense/rag/pipeline.py` e
`backend/src/incident_sense/rag/clients.py`). `OpenAILLMClient` delega a
`chat_text`, que chama `client.chat.completions.create` sem `stream=True`
(`backend/src/incident_sense/providers.py`).

Os seams disponíveis são pequenos e testáveis:

| Seam | Contrato atual | Consequência para a síntese |
| --- | --- | --- |
| `LLMClient` | `complete(system, user, temperature, max_tokens) -> str` | Histórico, mensagens com papéis e streaming não cabem no contrato. O workflow conversacional precisa de uma porta assíncrona separada com operações de completion e stream. |
| `EmbeddingClient` | `embed(text) -> list[float]` | O contrato de domínio permanece pequeno, mas o workflow precisa de implementação assíncrona para não bloquear o event loop. |
| `VectorRetriever` | `search(vector, top_k, query_filter) -> list[RetrievedHit]` | O workflow executa a busca por turno quando a rota exige recuperação e usa implementação assíncrona do Qdrant. |
| `RagDeps` | Agrupa as três portas | `CopilotDeps` preserva fakes offline e agrupa portas assíncronas; não repassa objetos concretos do SDK ao domínio. |
| `run_suggestion` | Orquestra e materializa `SuggestResponse` | As funções por etapa são pontos naturais para eventos reais de progresso, mas não existe um produtor de eventos nem cancelamento cooperativo. |
| `SuggestResponse` | Resultado agregado com consulta resumida, classificação, candidatos, sugestão e referências | Um stream precisa preservar um evento terminal equivalente e validado; deltas, sozinhos, não substituem este contrato. |

O pós-filtro mantém todos os candidatos e anota `survived` e
`postfilter_reason`, o que oferece transparência maior que uma resposta textual
genérica de chat (`backend/src/incident_sense/rag/postfilter.py`). A classificação
e o pós-filtro só aceitam JSON completo. Em erro de parsing, o pós-filtro mantém os
candidatos; a classificação infere `PROCEDENTE` quando há sobreviventes e
`IMPROCEDENTE` quando não há. Esse fallback contradiz a regra documentada pela
própria função e pelo `CONTEXT.md`: a natureza do incidente independe da existência
de casos semelhantes (`backend/src/incident_sense/rag/pipeline.py`). No workflow
conversacional, falha persistente de schema na classificação termina o turno com
erro seguro; ausência de hits nunca implica `IMPROCEDENTE`.

Não existem, nos schemas inspecionados, `conversation_id`, histórico, mensagem do
usuário, sequência de eventos, modelo efetivamente usado ou estado terminal de
stream (`backend/src/incident_sense/models/suggest.py`).

### Frontend

`api.suggest` usa `fetch`, aguarda uma resposta JSON completa e não recebe
`AbortSignal` (`frontend/lib/api.ts`). A chamada parte diretamente do navegador para
a URL do FastAPI; não existe Route Handler do Next.js neste caminho.

A superfície da Aurora tem aparência de chat, mas mantém apenas `lastMessage` e o
último `CopilotResult` (`frontend/app/incidentes/[number]/page.tsx`). Ao enviar texto:

- o conteúdo digitado é exibido na bolha local, mas não integra o `SuggestRequest`;
- o backend recebe novamente somente os campos do incidente e o modelo selecionado;
- cada envio repete a mesma análise stateless;
- não há transcript, contexto de turnos anteriores nem semântica de follow-up.

As cinco etapas visuais avançam por temporizadores locais de aproximadamente 480 ms.
Elas não refletem eventos do pipeline. Ao fim da chamada, todas são marcadas como
concluídas de uma vez. Fechar o painel ou desmontar o componente limpa os
temporizadores, mas não aborta o `fetch` nem a geração no provedor.

`mapSuggest` e `SuggestionMarkdown` preservam a distinção entre procedente,
improcedente e procedente sem base, além de expor candidatos, razões do pós-filtro e
citações clicáveis (`frontend/lib/model.ts` e
`frontend/app/incidentes/[number]/page.tsx`). Esse contrato de transparência é um
invariante a manter em qualquer formato conversacional.

## Matriz de evidências

| Área | Evidência primária | Leitura aplicável ao `incident-sense` |
| --- | --- | --- |
| FastAPI — SSE tipado | FastAPI oferece `EventSourceResponse`; um path operation pode produzir eventos com `yield`, inclusive em `POST`. Itens retornados diretamente como `AsyncIterable[Model]` são validados, documentados e serializados com Pydantic. Eventos nomeados construídos como `ServerSentEvent` não recebem essa validação de modelo automaticamente ([documentação oficial](https://fastapi.tiangolo.com/tutorial/server-sent-events/), verificado 2026-07). | Um único `POST` pode receber incidente, mensagem e histórico e devolver eventos nomeados sem WebSocket. Como o contrato usa `event` e `id`, um serializer valida explicitamente cada item da union com Pydantic antes de construir o `ServerSentEvent`; a versão instalada suporta a API, introduzida no FastAPI 0.135.0. |
| FastAPI — comportamento SSE | `EventSourceResponse` envia ping de keep-alive, `Cache-Control: no-cache` e `X-Accel-Buffering: no`; eventos aceitam `event`, `id`, `retry`, `data` JSON e `raw_data` ([documentação oficial](https://fastapi.tiangolo.com/tutorial/server-sent-events/#technical-details), verificado 2026-07). | Eventos de progresso, recuperação, conclusão e erro podem compartilhar um envelope SSE. O suporte de proxy não elimina a necessidade de teste ponta a ponta no Docker e no navegador. |
| FastAPI/Starlette — stream genérico | `StreamingResponse` aceita gerador síncrono ou assíncrono. Em geradores assíncronos, cancelamento só é observado em pontos de `await` ([FastAPI](https://fastapi.tiangolo.com/advanced/custom-response/#streamingresponse), [Starlette](https://www.starlette.io/responses/#streamingresponse), verificado 2026-07). | Um produtor que envolve rede síncrona e não cede controle não garante cancelamento responsivo. A arquitetura precisa definir cleanup do iterador upstream e pontos cooperativos de cancelamento. |
| Starlette — desconexão | `await request.is_disconnected()` informa se o cliente abandonou uma resposta longa ou streaming ([documentação oficial](https://www.starlette.io/requests/#body), verificado 2026-07). `StreamingResponse` também trata `http.disconnect`/falha de envio conforme a versão ASGI ([código-fonte 1.3.1](https://github.com/Kludex/starlette/blob/1.3.1/starlette/responses.py#L222-L283), verificado 2026-07). | A sondagem explícita é útil antes e depois de chamadas caras, mas não substitui propagação de cancelamento e `finally` no stream do OpenRouter. |
| FastAPI — contrato OpenAPI | Uma `Response` retornada diretamente não é filtrada por `response_model` e só tem mídia documentada quando a operação também declara `response_class` ([documentação oficial](https://fastapi.tiangolo.com/advanced/custom-response/#return-a-response), verificado 2026-07). | O contrato de eventos precisa de modelos próprios; não se pode presumir que `SuggestResponse` validará automaticamente chunks arbitrários. |
| Next.js — Route Handler | Route Handlers usam as Web APIs `Request`/`Response`, suportam `POST` e podem retornar um `ReadableStream`; a referência oficial mostra um async iterator convertido em stream ([documentação oficial](https://nextjs.org/docs/app/api-reference/file-conventions/route#streaming), verificado 2026-07). | Um BFF no Next.js é tecnicamente possível, mas não é necessário para o navegador consumir um stream do FastAPI. Adotá-lo acrescenta uma segunda fronteira de buffering, erro e cancelamento. |
| Next.js — limites do BFF | Route Handlers são endpoints públicos e não substituem um backend completo. Alguns ambientes os executam como funções com timeout e limitações para conexões longas ([documentação oficial](https://nextjs.org/docs/app/guides/backend-for-frontend#deployment-environment), verificado 2026-07). | A execução local atual favorece manter a lógica no FastAPI. Caso haja proxy Next.js, preservação do `Response.body`, cancelamento e ausência de buffering precisam ser critérios verificáveis do ambiente. |
| OpenRouter — streaming | `stream: true` entrega chunks SSE para qualquer modelo; comentários `: OPENROUTER PROCESSING` são keep-alives ignoráveis e `X-Generation-Id` permite correlação ([documentação oficial](https://openrouter.ai/docs/api/reference/streaming), verificado 2026-07). | O adaptador do provedor deve interpretar o protocolo upstream, ignorar comentários e expor uma abstração de domínio; repassar SSE bruto acoplaria frontend e pipeline ao fornecedor. |
| OpenRouter — cancelamento | Abortar a conexão interrompe imediatamente processamento e cobrança somente nos provedores listados como compatíveis; requests sem streaming e provedores não compatíveis podem continuar processando e cobrando ([documentação oficial](https://openrouter.ai/docs/api/reference/streaming#stream-cancellation), verificado 2026-07). | `AbortController` no browser precisa alcançar o iterador do cliente OpenRouter. Mesmo assim, a UI não pode prometer cancelamento financeiro para todos os modelos selecionáveis. |
| OpenRouter — erro no stream | Antes do primeiro token, ainda cabem status HTTP 4xx/5xx e fallback. Depois do primeiro token, o HTTP permanece `200`; o erro chega in-band, com `finish_reason: "error"`, e encerra o stream ([documentação oficial](https://openrouter.ai/docs/api/reference/streaming#handling-errors-during-streaming), verificado 2026-07). | O frontend precisa de evento terminal explícito. Texto parcial não pode habilitar “Inserir” ou “Copiar” como se fosse uma sugestão fundamentada completa. |
| OpenRouter — provider routing | O roteador balanceia provedores e aceita preferências como `order`, `only`, `require_parameters`; `allow_fallbacks` é `true` por padrão ([documentação oficial](https://openrouter.ai/docs/guides/routing/provider-selection), verificado 2026-07). | Fallback entre provedores do mesmo modelo pode elevar disponibilidade sem mudar o modelo público, mas requisitos de parâmetros e retenção de dados precisam ser explícitos se entrarem no contrato. |
| OpenRouter — model fallback | O parâmetro `models` tenta modelos em ordem em casos como indisponibilidade, rate limit e moderação; com o SDK OpenAI, ele pode ser enviado por `extra_body` ([documentação oficial](https://openrouter.ai/docs/guides/routing/model-fallbacks), verificado 2026-07). | Fallback entre modelos rompe a suposição visual de que a resposta veio necessariamente do modelo escolhido. Se adotado, o modelo efetivo precisa entrar no evento terminal e na UI. |
| OpenRouter — retry | Respostas `429` e `503` podem trazer `Retry-After`; os SDKs listados respeitam esse header, enquanto `fetch` direto precisa implementá-lo ([documentação oficial](https://openrouter.ai/docs/api/reference/errors-and-debugging#retry-after-header), verificado 2026-07). | Retry automático é seguro somente antes de conteúdo parcial. Depois de deltas, uma nova geração pode duplicar texto, divergir e cobrar duas execuções; o retry deve ser terminal e explícito para o usuário. |
| LlamaIndex — chat | Chat engines preservam interação com dados; `stream_chat()` expõe `response_gen` e recebe histórico em `ChatMessage` ([guia](https://developers.llamaindex.ai/python/framework/module_guides/deploying/chat_engines/usage_pattern/#streaming), [referência](https://developers.llamaindex.ai/python/framework-api-reference/chat_engines/context/), verificado 2026-07). | As primitivas provam que histórico e streaming cabem na biblioteca já usada. Elas não provam que substituir o pipeline customizado por um chat engine preserve classificação, fallbacks e transparência. |
| LlamaIndex — memória | A documentação recomenda `Memory`, com memória curta limitada por tokens e memória longa opcional, e marca `ChatMemoryBuffer` como deprecated ([documentação oficial](https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/), verificado 2026-07). | Se houver memória LlamaIndex, ela deve ser instanciada explicitamente e compatível com a versão fixada. Memória longa não é exigida por um demo local e ampliaria escopo, persistência e risco de mistura entre incidentes. |
| LlamaIndex — conceitos distintos | `Memory` guarda e recupera informação conversacional; `ChatStore` persiste mensagens ordenadas por chave ([documentação oficial](https://developers.llamaindex.ai/python/framework/module_guides/storing/chat_stores/), verificado 2026-07). `Context` mantém estado de Workflow/AgentWorkflow entre runs ([documentação oficial](https://developers.llamaindex.ai/python/framework/understanding/agent/state/), verificado 2026-07). | Um chat RAG não precisa de `Context` só por ser stateful. Adotar Workflow/AgentWorkflow seria uma decisão arquitetural separada e mais ampla que adicionar histórico delimitado ao pipeline existente. |
| Padrão SSE | O HTML Living Standard define `text/event-stream`, eventos nomeados, `id`, `retry`, UTF-8 e reconexão por `Last-Event-ID`; a API nativa `EventSource` recebe uma URL e credenciais, não corpo `POST` ([WHATWG](https://html.spec.whatwg.org/multipage/server-sent-events.html), verificado 2026-07). | Usar o framing SSE, mas consumir o `POST` com `fetch`. Não anunciar reconexão automática: sem um log persistente, não existe replay seguro para `Last-Event-ID`. |
| Browser — cancelamento | `AbortController.abort()` sinaliza que a atividade associada deve ser encerrada e disponibiliza um motivo de aborto ([DOM Living Standard](https://dom.spec.whatwg.org/#interface-abortcontroller), verificado 2026-07). | Um `AbortSignal` por turno deve ser abortado por “Parar”, troca de incidente, fechamento do painel ou unmount. Abortos são um estado esperado, não um erro genérico de rede. |
| Browser — backpressure e UTF-8 | `ReadableStream` usa uma estratégia de fila e um high-water mark para sinalizar backpressure local; buffers HTTP/TCP ainda separam produtor e consumidor ([WHATWG Streams](https://streams.spec.whatwg.org/#backpressure), verificado 2026-07). `TextDecoder` preserva bytes multibyte entre chamadas quando usado com `stream: true` ([WHATWG Encoding](https://encoding.spec.whatwg.org/#dom-textdecoder-decode), verificado 2026-07). | Consumir sequencialmente limita a fila do browser, mas um `yield` no backend não confirma consumo remoto. O parser precisa decodificar UTF-8 incrementalmente e depois interpretar o framing SSE; qualquer fila da aplicação deve ser limitada. |
| OpenRouter — saída estruturada | `response_format.json_schema.strict: true` restringe a resposta em modelos compatíveis, dentro do objeto que também declara `name` e `schema`; `provider.require_parameters: true` exclui endpoints que ignorariam o parâmetro ([saída estruturada](https://openrouter.ai/docs/guides/features/structured-outputs), [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection#requiring-providers-to-support-all-parameters), verificado 2026-07). | Saída estruturada pode ser o caminho preferencial do modelo de referência, mas Pydantic e validação de citações continuam obrigatórios. O fallback por JSON instruído preserva o ADR 0008 e modelos secundários. |
| OpenRouter — compatibilidade da allow-list | Os cinco ids da allow-list declaram `response_format` e `structured_outputs` na API pública de modelos ([Models API](https://openrouter.ai/api/v1/models), verificado 2026-07). | A capacidade é perecível e depende do endpoint escolhido. A implementação deve verificá-la na curadoria do portfólio e não inferi-la apenas do id público. |
| OpenRouter — erros tipados | Erros após o início do stream chegam in-band; `error.metadata.error_type` é o discriminador estável em Chat Completions, e fallback silencioso só cabe antes do primeiro token ([documentação oficial](https://openrouter.ai/docs/api/reference/errors-and-debugging), verificado 2026-07). | O adaptador converte erros do gateway para códigos próprios e seguros. O frontend não interpreta envelopes do OpenRouter nem status HTTP depois de `turn.accepted`. |
| OpenRouter — uso | Tokens, custo e detalhes de cache chegam automaticamente no último chunk SSE ([documentação oficial](https://openrouter.ai/docs/cookbook/administration/usage-accounting), verificado 2026-07). | Em sucesso, o backend consome o stream até o terminal e agrega o uso. Em aborto ou desconexão, fecha o upstream imediatamente e registra somente a correlação disponível, sem prometer custo final; conteúdo integral não entra em logs. |
| Cliente Python — async, retry e timeout | `AsyncOpenAI` oferece a mesma interface assíncrona e streaming; o SDK repete por padrão duas vezes erros de conexão, 408, 409, 429 e 5xx, e o timeout padrão é dez minutos ([repositório oficial](https://github.com/openai/openai-python#async-usage), [retries e timeouts](https://github.com/openai/openai-python#retries), verificado 2026-07). | O endpoint async não deve chamar o cliente síncrono. Retry e timeout precisam ser configurados explicitamente para evitar multiplicação de tentativas e um budget implícito incompatível com o turno. |
| LlamaIndex — boundary vigente | `CondensePlusContextChatEngine` combina condensação, retriever, memória e `CompactAndRefine`; `Memory` usa fila FIFO, memory blocks e `SQLAlchemyChatStore` ([chat engine 0.14.22](https://github.com/run-llama/llama_index/blob/v0.14.22/llama-index-core/llama_index/core/chat_engine/condense_plus_context.py), [memory 0.14.22](https://github.com/run-llama/llama_index/blob/v0.14.22/llama-index-core/llama_index/core/memory/memory.py), verificado 2026-07). | A conveniência não é gratuita: esses defaults escondem decisões de persistência, compactação e síntese. O workflow próprio preserva os seams e o fail-closed de fundamentação. |
| Contrato tipado | Pydantic recomenda unions discriminadas por serem mais previsíveis e eficientes, além de gerar `discriminator` no JSON Schema/OpenAPI ([documentação oficial](https://pydantic.dev/docs/validation/latest/concepts/unions/#discriminated-unions), verificado 2026-07). | `type` deve discriminar tanto eventos SSE quanto blocos da resposta final. Isso permite fixtures compartilhadas e rejeição explícita de eventos desconhecidos. |
| Qualidade de citações | O benchmark primário ALCE separa correção, completude e qualidade da citação e mostra que produzir citações não garante suporte completo ([paper](https://arxiv.org/abs/2305.14627), verificado 2026-07). | Validar que o id existe é necessário, mas não mede se a evidência sustenta a afirmação. Entailment e completude pertencem aos evals; a execução faz as garantias estruturais determinísticas. |

## Arquitetura recomendada

### Unidade de conversa e contrato de entrada

A conversa pertence a exatamente um incidente e vive na memória do componente da
interface. Trocar de incidente, recarregar a página ou fechar a aba descarta o
histórico. Não há banco, `ChatStore`, cookie de sessão nem memória entre incidentes.

O endpoint recomendado é `POST /api/incidents/{number}/copilot/turns`, com resposta
`text/event-stream`. O path identifica o incidente; o backend carrega o registro
canônico do dataset commitado. O navegador não envia cópia autoritativa de
descrição, categoria ou serviço.

O request contém somente:

- `protocol_version`, inicialmente `"1"`;
- `client_turn_id`, UUID criado antes do `fetch` para correlação;
- `message`, com o texto do turno;
- `history`, sequência limitada de pares completos `user`/`assistant` já validados;
- `model`, id público resolvido pela allow-list;
- `locale`, `pt-BR` ou `en`, derivado da preferência ativa da interface.

O backend valida papéis, ordem, quantidade, tamanho individual e tamanho total. O
histórico é contexto conversacional não confiável: ajuda a resolver referências como
“esse timeout”, mas nunca conta como evidência. Incidente em análise e incidentes
históricos são recarregados das fontes canônicas a cada turno.

Essa escolha mantém a API stateless e testável. Um `conversation_id` sem store não
acrescentaria identidade verificável; memória in-process criaria comportamento
diferente entre workers e ciclos de vida implícitos.

### Workflow por turno

```text
validar entrada e carregar incidente
  → policy gate
  → classificar pergunta e reescrever consulta quando necessário
  → recuperar e pós-filtrar quando necessário
  → montar contexto sob budget
  → gerar resposta estruturada
  → validar schema, fundamentação e citações
  → emitir resposta terminal
```

1. **Entrada e policy.** Rejeitar incidente inexistente, protocolo desconhecido,
   payload acima do limite e papéis inválidos antes de qualquer chamada externa. O
   policy gate delimita o domínio e não executa ferramentas nem mutações.
2. **Plano do turno.** Uma saída Pydantic classifica o pedido como
   `general_explanation`, `incident_explanation`, `grounded_guidance` ou
   `out_of_scope`, registra o idioma e, quando precisa de recuperação, produz uma
   `standalone_query`. A reescrita serve apenas à recuperação; a geração recebe a
   pergunta original para evitar deriva semântica.
3. **Recuperação condicional.** `grounded_guidance` e perguntas que dependem de
   incidentes históricos geram embedding e executam busca e pós-filtro. Explicações
   gerais não pagam esse custo. Nenhum conjunto de candidatos é reutilizado entre
   turnos: cada resposta congela suas próprias fontes, e uma mudança de pergunta não
   herda evidência inadequada.
4. **Context pack.** Montar deterministicamente: policy e formato, incidente em
   análise, pergunta original, janela recente do histórico e, quando aplicável,
   incidentes históricos deduplicados e ordenados por relevância. Cada fonte recebe
   id estável e delimitadores claros.
5. **Geração.** Pedir uma resposta estruturada em blocos. No modelo de referência,
   preferir `json_schema` estrito com `require_parameters: true`; em rotas sem essa
   capacidade, usar JSON instruído no prompt. Ambos passam pela mesma validação
   Pydantic.
6. **Validação.** Rejeitar schema, ids ou regras de fundamentação inválidos. Uma única
   tentativa de reparo recebe somente a resposta, os erros estruturais e os ids
   permitidos. Persistindo a falha, responder com mensagem fixa e segura de ausência
   de evidência ou `turn.failed`; nunca promover texto parcial.

A preferência por `json_schema` refina, mas não revoga, o ADR 0008: validação local
continua sendo a autoridade, e JSON instruído permanece o piso de compatibilidade.
Tornar structured outputs obrigatório para todo o portfólio exige uma decisão que
substitua explicitamente o ADR, sustentada pelos evals dos modelos selecionados.

### Memória, reescrita e compactação

A memória preserva somente turnos terminais aceitos. Turnos abortados, falhos ou
parciais não entram no próximo request. O frontend mantém um histórico separado por
número de incidente enquanto o painel está montado.

O compactador opera por budget, não por quantidade fixa de mensagens:

1. policy, incidente em análise e pergunta do turno nunca são truncados;
2. manter pares conversacionais completos do mais recente para o mais antigo;
3. remover o par mais antigo ao ultrapassar o budget reservado ao histórico;
4. deduplicar fontes e remover candidatos de menor relevância antes de cortar texto
   de uma resolução histórica;
5. impedir que a soma de input e output reservado ultrapasse o menor contexto
   suportado pelo portfólio aceito.

Não usar sumarização por LLM enquanto a janela determinística atender aos evals. Ela
acrescentaria custo e poderia transformar conversa em “evidência” ou apagar
ressalvas. A janela efêmera e curta torna a remoção FIFO de pares inteiros mais
previsível. Uma sumarização só se justifica depois que evals demonstrarem necessidade
e preservação de fatos.

### Boundary entre LlamaIndex e código de domínio

Permanecem em LlamaIndex:

- `TextNode` e `NodeWithScore` para candidatos;
- `QueryBundle` na fronteira do pós-filtro;
- `BaseNodePostprocessor` para `LLMPostFilter`.

O pós-filtro ganha uma implementação assíncrona sem trocar sua abstração pública.

Permanecem em código próprio:

- policy, classificação e reescrita da pergunta;
- histórico efêmero e compactação;
- recuperação condicional e montagem do contexto;
- máquina de estados do turno e eventos;
- adaptação assíncrona do OpenRouter;
- adaptações assíncronas de embeddings e Qdrant;
- schema final, validação de citações, retry e cancelamento.

O `CondensePlusContextChatEngine` é a alternativa mais próxima, mas agrega
retriever, memória e `CompactAndRefine` num ciclo de vida próprio. Isso enfraquece a
separação entre pergunta original e consulta reescrita, esconde o budget e dificulta
o fail-closed de citações. `Memory` e `ChatStore` também introduzem estado e uma
fronteira de armazenamento; a persistência depende da configuração e não é necessária
para a memória efêmera deste destino.

## Transporte e contrato de eventos

### Escolha: SSE sobre `POST` com `fetch`

O fluxo é unidirecional e finito: um request do usuário produz progresso, fontes e
um terminal. SSE fornece framing, eventos nomeados, keep-alive e suporte nativo no
FastAPI. `fetch` é necessário porque a API `EventSource` do browser não envia corpo
`POST`; o cliente lê `Response.body` e analisa o framing incrementalmente.

O navegador chama o FastAPI diretamente, como já faz para JSON. Um Route Handler do
Next.js duplicaria timeouts, buffering, erros e cancelamento sem esconder segredo ou
resolver autenticação no escopo local. Essa fronteira só se justifica se uma
implantação exigir política same-origin ou sessão no servidor.

### Envelope

Todo evento de dados nasce como uma union discriminada Pydantic e contém:

```text
protocol_version: "1"
turn_id: UUID
sequence: inteiro monotônico iniciado em 1
type: discriminador literal
```

Antes de construir `ServerSentEvent`, um serializer valida cada item com um
`TypeAdapter` da union. Somente o valor validado gera `data`, `event` e `id`; o campo
SSE `event` espelha `data.type`, e `id` combina `turn_id` e `sequence` para
diagnóstico, não para resume. Essa validação explícita é necessária porque eventos
nomeados não passam automaticamente pelo atalho `AsyncIterable[Model]` do FastAPI.
Pings são comentários SSE e não entram na union.

O conjunto mínimo é:

| Evento | Conteúdo | Regra |
| --- | --- | --- |
| `turn.accepted` | incidente, locale e `model_requested` | Primeiro evento; confirma que headers e contrato foram aceitos. O modelo efetivo ainda pode ser desconhecido. |
| `phase.changed` | fase enumerada, `started` ou `completed`, duração quando concluída | Expõe progresso real sem chain-of-thought. |
| `retrieval.completed` | consulta independente, candidatos, scores e decisão do pós-filtro | Emitido apenas quando houve recuperação; preserva a transparência vigente. |
| `answer.completed` | resposta validada, classificação do incidente, fontes derivadas e telemetria disponível por chamada | Único sucesso terminal e única origem habilitada para copiar ou inserir. Cada chamada registra `generation_id`, modelo/provider reportados e uso/custo quando o upstream os fornece. |
| `turn.failed` | código próprio, mensagem segura, `retryable` e `retry_after_ms` opcional | Terminal de erro; nunca inclui envelope bruto do provider. |
| `turn.cancelled` | motivo seguro | Best-effort quando o canal ainda aceita escrita; desconexão pode impedir sua entrega. |

`model_requested` é a escolha pública do turno. Não existe um único “modelo efetivo”
quando ela resolve para `openrouter/auto`, nem garantia de que classificação,
pós-filtro e resposta usem o mesmo endpoint. A telemetria terminal mantém uma entrada
por chamada e registra `model`, `provider`, `generation_id`, uso e custo somente
quando o OpenRouter os reporta; campo ausente permanece desconhecido, nunca inferido.

Cada stream termina em exatamente um evento terminal quando a conexão permite. O
cliente rejeita versão desconhecida, evento fora de ordem, sequência repetida ou fim
de arquivo sem terminal. Não há `answer.delta` nesta arquitetura.

### Resposta final e citações

O modelo produz `CopilotAnswer`, não markdown com ids livres:

```text
kind: general_explanation | grounded_answer | no_evidence | refusal
locale: pt-BR | en
incident_classification:
  verdict: PROCEDENTE | IMPROCEDENTE
  justification: string
grounding: cited | no_historical_evidence | not_required
blocks[]:
  type: explanation | diagnosis | action | caveat
  text: string
  citations: evidence_id[]
```

O backend aplica invariantes determinísticas:

- `incident_classification` descreve a natureza do incidente; `kind` descreve a
  resposta ao turno, e uma dimensão nunca é inferida da outra;
- `PROCEDENTE` com `grounding: no_historical_evidence` preserva explicitamente o
  estado de incidente real sem base semelhante;
- todo `evidence_id` pertence ao incidente em análise ou aos candidatos aprovados
  naquele turno;
- blocos `diagnosis` e `action` possuem pelo menos uma citação;
- `general_explanation` não contém blocos operacionais;
- ids são deduplicados e a lista de fontes é derivada dos blocos, nunca aceita do
  modelo;
- a UI renderiza botões de citação a partir do campo estruturado, sem extrair
  `[INC…]` do texto;
- “Inserir” e “Copiar” aparecem somente para `answer.completed` válido.

Essas regras garantem integridade estrutural e proveniência permitida. Se a fonte
realmente sustenta cada afirmação é uma propriedade semântica: os evals medem
correção, completude e entailment, em vez de fingir que uma regex resolve o problema.

## Cancelamento, retry e backpressure

### Cancelamento

- O frontend cria um `AbortController` por turno e aborta em “Parar”, troca de
  incidente, fechamento do painel e unmount.
- O endpoint e as portas de LLM tornam-se assíncronos. O adaptador usa
  `AsyncOpenAI`, consome o stream OpenRouter em context manager e fecha-o em
  `finally`.
- O gerador verifica `request.is_disconnected()` antes de etapas caras e propaga
  cancelamento para tarefas e streams filhos. Não há background task órfã.
- A interface comunica “geração interrompida”, sem prometer interrupção de cobrança:
  OpenRouter documenta provedores em que o cancelamento upstream é best-effort.
- Em sucesso, cada chamada upstream é consumida até o terminal para agregar telemetria.
  Em aborto ou desconexão, o adaptador fecha o stream imediatamente e registra somente
  a correlação recebida; custo final pode permanecer desconhecido.

### Retry e timeout

- Manter provider fallback dentro da rota do id solicitado antes do primeiro token.
  Não enviar a lista `models` para model fallback: ela viola a escolha exibida na UI.
  `openrouter/auto` continua sendo uma escolha explícita de roteamento, com telemetria
  por chamada em vez da promessa de um modelo fixo.
- Configurar explicitamente o SDK para no máximo uma repetição transitória antes de
  conteúdo upstream, respeitando `Retry-After` e um deadline total do turno.
- Não repetir automaticamente depois de erro mid-stream. O backend descarta o buffer
  incompleto, emite `turn.failed` e oferece retry explícito com um novo
  `client_turn_id`.
- A única repetição sem ação humana após geração é a tentativa de reparo estrutural;
  ela possui budget próprio e entra no custo do turno.
- Timeouts de conexão, leitura e turno são configuração tipada. Os valores são
  fixados pelos evals de latência, não pelo default de dez minutos do SDK.

### Backpressure

O event stream é de baixo volume porque não carrega tokens. Um async generator direto
evita uma fila adicional da aplicação, mas seu `yield` não confirma que o browser
consumiu o evento: a ponte ASGI e os buffers HTTP/TCP continuam no caminho. Se a
implementação separar produtor e escritor, a ponte usa fila com `maxsize` finito,
deadline de escrita e cancelamento conjunto; filas ilimitadas ficam proibidas.

O parser do frontend consome um evento por vez, impõe limite por evento e por stream
e usa `TextDecoder.decode(chunk, { stream: true })` ou `TextDecoderStream` antes de
interpretar o framing. Ele preserva linhas e sequências UTF-8 incompletas entre
chunks, aceita `CRLF` dividido e faz flush no EOF. Stream lento, cliente que deixa de
ler, caractere multibyte dividido e payload excedente são casos de integração
obrigatórios.

## Alternativas e trade-offs

| Alternativa | Benefício | Custo e decisão |
| --- | --- | --- |
| `CondensePlusContextChatEngine` + `Memory` | Menos código de chat, condensação e streaming prontos. | Acopla síntese, memória, retriever e lifecycle; dificulta policy e validação. Rejeitado para preservar o ADR 0002. |
| NDJSON sobre `fetch` | Parser conceitualmente simples e JSON por linha. | Não oferece eventos nomeados, `id`, `retry` ou keep-alive padronizado. Viável, porém inferior ao suporte SSE já presente na stack. |
| WebSocket | Canal bidirecional persistente. | Exige protocolo próprio, lifecycle de conexão e backpressure mais difícil para um turno unidirecional. Rejeitado por YAGNI. |
| `EventSource` com `GET` | Reconexão automática e API nativa do browser. | Não transporta o request conversacional em corpo; separar criação do turno e assinatura exigiria estado/replay no servidor. Rejeitado. |
| Route Handler do Next.js como BFF | Same-origin e um ponto futuro para sessão/autorização. | Duplica streaming e cancelamento sem benefício no demo local. Adiado até existir essa necessidade. |
| Token streaming | Menor time-to-first-token e sensação de resposta imediata. | Expõe orientação antes da validação e complica reparo de citações. Rejeitado; progresso real e fontes antecipam feedback sem quebrar o fail-closed. |
| Memória in-process no backend | Cliente envia menos histórico. | Mistura lifecycle com worker, perde estado em restart e exige expiração/concorrência. Rejeitada. |
| Contexto histórico resumido por LLM | Conversas maiores dentro do budget. | Custo, latência e risco de distorção; desnecessário para memória efêmera curta. Adiado até evidência em evals. |

## Consequências para a especificação

A especificação pode assumir como decididos:

- workflow próprio, assíncrono, explícito e não-agentic;
- contexto autoritativo carregado pelo backend e histórico efêmero enviado pelo
  cliente, isolado por incidente;
- recuperação por turno somente quando necessária, sem cache conversacional de
  evidências;
- compactação determinística por budget e descarte de pares completos;
- SSE tipado via `POST`/`fetch` direto, sem BFF, WebSocket ou dependência SSE extra;
- progresso e fontes em streaming, resposta completa somente depois da validação;
- schema em blocos com citações estruturadas e fontes derivadas pelo servidor;
- LlamaIndex limitado às primitivas de recuperação e pós-filtro;
- cancelamento cooperativo best-effort, provider fallback do mesmo modelo e retry
  explícito após erro mid-stream.

A convivência e retirada de `POST /api/suggest` exige um contrato de migração próprio,
formulável a partir do contrato acima.

Os gates mínimos para uma implementação desta arquitetura são:

1. testes unitários offline de cada transição, compactação, reescrita, ordem dos
   eventos e validador de citações;
2. testes de integração para cliente lento, aborto em cada fase, erro antes/depois
   do início do stream, EOF sem terminal e cleanup do provider;
3. testes de contrato Pydantic/TypeScript com fixtures válidas e inválidas de cada
   variante da union;
4. evals bilíngues para rota da pergunta, recuperação, correção, completude e
   entailment das citações;
5. verificação de isolamento entre incidentes, limites de entrada e ausência de
   conteúdo integral nos logs;
6. `make check`, `react-doctor` sem violações e teste ponta a ponta no Docker.
