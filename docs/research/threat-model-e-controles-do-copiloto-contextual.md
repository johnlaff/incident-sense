# Threat model e controles do copiloto contextual

## Resumo executivo

O copiloto contextual deve considerar não confiáveis todas as entradas que podem
influenciar o modelo: mensagem e histórico enviados pelo navegador, campos do
incidente, registros recuperados, respostas dos provedores e conteúdo devolvido
para renderização. A instrução de sistema define política, mas não constitui uma
fronteira de segurança. Prompt injection não tem prevenção completa conhecida;
o desenho seguro contém seu impacto com isolamento, fluxo não agêntico,
validação determinística, saída estruturada e ausência de efeitos externos.

O perfil recomendado combina o nível 1 do OWASP AISVS 1.0 e do OWASP LLMSVS
2.0 com controles de nível 2 aplicáveis a RAG, memória, saída, observabilidade e
provedores. O escopo local, somente leitura e baseado em dados sintéticos não
justifica todo o nível 2, voltado à maioria dos sistemas de produção que tratam
dados sensíveis. A divergência preserva proporcionalidade sem relaxar os
controles que protegem credenciais, orçamento, integridade da resposta e
isolamento entre incidentes.

As condições críticas e altas devem bloquear o release. O gate combina testes
determinísticos em cada PR com avaliações adversariais reais no release
candidate e na rotina agendada. A decisão normativa sobre o perfil, os limiares
e as exceções pertence a [Definir o threat model e os gates de segurança do
release](https://github.com/johnlaff/incident-sense/issues/19).

## Escopo e premissas

Este threat model cobre o copiloto conversacional associado a um incidente e os
componentes necessários para recuperar evidências e apresentar uma resposta. O
estado-alvo definido para o release assume:

- aplicação local, executada por uma pessoa por vez;
- dados integralmente sintéticos e artefatos de retrieval versionados;
- conversa efêmera, isolada por incidente e sem persistência no servidor;
- fluxo fixo, não agêntico e somente leitura;
- nenhuma ferramenta, upload, conector, escrita em ITSM ou execução de comando;
- OpenRouter como único gateway de chat permitido no estado-alvo e OpenAI para
  embeddings;
- conhecimento geral permitido para explicar conceitos, enquanto diagnóstico,
  causa, comando e resolução exigem evidência recuperada e citada;
- resposta exibida somente após validação completa no servidor.

Uma implantação acessível fora do host local muda materialmente o risco. Sem
autenticação e autorização, a API e o Qdrant só são aceitáveis quando não estão
expostos à rede. Publicação remota exige um threat model próprio antes da
exposição.

Ficam fora do documento detalhes operacionais que reduziriam o custo de
exploração, como payloads, cadeias de bypass e valores de infraestrutura. Esses
detalhes pertencem a advisory privado. Os cenários públicos descrevem classes de
ataque e critérios verificáveis.

## Objetivos de segurança

1. **Integridade fundamentada:** recomendações operacionais só usam evidência
   recuperada para o incidente em análise e citada por identificador válido.
2. **Confinamento:** texto controlado por usuário, corpus ou modelo não altera
   política, configuração, modelo, roteamento nem produz efeitos externos.
3. **Isolamento:** uma conversa não acessa contexto, histórico nem resultados de
   outra conversa; suas únicas fontes externas são os incidentes históricos
   autorizados e recuperados para o turno em curso.
4. **Confidencialidade operacional:** chaves, configuração interna, instruções
   de sistema, conteúdo integral de turnos e respostas de provedores não vazam
   por API, UI ou logs.
5. **Disponibilidade e custo limitado:** cada turno possui limites locais de
   tamanho, chamadas, tempo, concorrência, tokens e custo, combinados com hard
   cap no OpenRouter e alertas e rate limits no projeto OpenAI.
6. **Saída inerte:** a resposta permanece dados para apresentação; não executa
   código, inicia requisições arbitrárias nem fabrica links ou citações.
7. **Rastreabilidade com minimização:** telemetria permite explicar decisões e
   custo sem registrar o conteúdo completo da conversa.

## Ativos protegidos

| Ativo | Propriedade protegida | Consequência principal |
| --- | --- | --- |
| Chaves OpenRouter e OpenAI | Confidencialidade e uso autorizado | gasto, abuso ou revogação |
| Orçamento dos provedores | Disponibilidade e limite financeiro | consumo não controlado |
| Política e configuração do fluxo | Integridade | bypass de escopo ou roteamento |
| Incidente em análise e histórico | Isolamento | mistura ou vazamento entre contextos |
| Incidentes históricos e índices | Integridade e proveniência | grounding contaminado |
| Resposta e citações | Integridade e rastreabilidade | ação operacional sem suporte |
| Logs e métricas | Minimização e integridade | vazamento ou perda de auditabilidade |
| Navegador e host local | Integridade | execução, egress ou acesso lateral |
| Dependências, imagens e workflows | Proveniência | comprometimento da cadeia de software |

Os incidentes são sintéticos, portanto não recebem classificação de dado
sensível. Essa premissa reduz impacto de privacidade, mas não autoriza exposição
de credenciais, conteúdo futuro, configuração ou orçamento.

## Atores e capacidades consideradas

- pessoa usuária que envia mensagens arbitrárias e pode chamar a API sem a UI;
- página maliciosa no navegador tentando alcançar serviços locais;
- conteúdo hostil inserido em campos de incidente ou registros do corpus;
- resposta do modelo incorreta, manipulada ou formatada como conteúdo ativo;
- provedor upstream com retenção, roteamento ou disponibilidade incompatível;
- dependência, Action, imagem ou artefato de dados comprometido;
- erro de implementação que mistura estado concorrente ou registra conteúdo.

O modelo não pressupõe acesso prévio ao host, à conta GitHub ou às chaves. Um
atacante com esse acesso já atravessou controles externos ao produto.

## Fronteiras de confiança

| Fronteira | Entrada não confiável | Autoridade que deve permanecer no lado confiável |
| --- | --- | --- |
| Navegador → frontend | texto, eventos e estado restaurado | apresentação e separação visual por incidente |
| Frontend → FastAPI | mensagem, histórico, modelo e identificadores | incidente canônico, política, limites e workflow |
| FastAPI → corpus/Qdrant | campos e conteúdo recuperado | escopo do retrieval, IDs e metadados de proveniência |
| FastAPI → OpenRouter | prompt e política de roteamento | allowlist, privacidade, orçamento e validação final |
| FastAPI → OpenAI | texto enviado para embedding | finalidade, projeto/chave e política de retenção |
| Modelo → validador | estrutura, texto, citações e URLs | schema, regras de grounding e estado terminal |
| Validador → renderer | blocos aprovados | allowlist de elementos e ausência de egress |
| Processo → ambiente/logs | erros, metadados e configuração | segredos, redação e campos permitidos |
| Repositório/CI → artefatos executáveis | código e dependências de terceiros | revisão, locks, assinatura e gates de segurança |

Três invariantes atravessam todas as fronteiras:

- o servidor recarrega o incidente canônico pelo identificador da rota; campos
  enviados pelo cliente nunca substituem essa fonte;
- histórico, incidente e conteúdo recuperado são dados, não instruções, mesmo
  quando contêm texto imperativo;
- nenhuma saída do modelo alcança UI ou outra etapa privilegiada antes de
  validação determinística.

## Método de classificação

O risco usa probabilidade e impacto, conforme o NIST AI RMF. A severidade é uma
priorização de release, não uma pontuação CVSS de vulnerabilidade individual.

| Classe | Definição | Política recomendada |
| --- | --- | --- |
| P0 — crítica | compromete credencial ou host, cria efeito externo, mistura incidentes, permite egress ativo ou gasto sem teto | bloqueia PR/RC/release; nenhuma exceção pública |
| P1 — alta | altera política, entrega diagnóstico/ação sem evidência, viola contrato de provedor ou contorna isolamento lógico | bloqueia RC/release; correção ou decisão explícita no threat model normativo |
| P2 — média | degrada defesa em profundidade, detecção ou disponibilidade, com impacto contido | bloqueia RC salvo aceite documentado, responsável e prazo |
| P3 — baixa | hardening sem caminho direto para impacto relevante | acompanha ticket e não bloqueia isoladamente |

O nível final considera o pior impacto plausível depois dos controles, não apenas
a intenção do atacante. Falhas repetíveis em controles determinísticos não podem
ser rebaixadas por uma boa média de avaliações probabilísticas.

## Cenários e requisitos defensivos

### TM-01 — prompt injection direta e jailbreak

**Risco:** uma mensagem ou item do histórico tenta substituir política, revelar
configuração, mudar o formato ou conduzir a conversa para atividade fora do
domínio. **Severidade inerente:** P1.

Controles:

- construir todas as mensagens de provedor no servidor, com instruções fixas em
  papel privilegiado e dados em blocos explicitamente delimitados;
- tratar o histórico como contexto não confiável e nunca como evidência;
- classificar intenção em enum fechado antes de recuperar fontes;
- produzir recusa fixa da aplicação para assuntos fora do domínio, sem pedir ao
  mesmo modelo que improvise a política de recusa;
- validar saída por schema estrito, com campos extras proibidos e limites de
  tamanho;
- manter detectores de injection e jailbreak como sinal adicional, nunca como
  única barreira;
- não armazenar segredos na instrução de sistema e não assumir que ela ficará
  confidencial.

Evidência de gate:

- suíte bilíngue e versionada cobre mudança de instrução, extração de contexto,
  obfuscação representativa, muitos turnos e mudança de assunto;
- casos bloqueados terminam em estado de política sem retrieval nem geração de
  conteúdo operacional;
- a resposta nunca contém configuração, instrução de sistema ou valor sentinela
  presente apenas em outro contexto.

### TM-02 — prompt injection indireta em incidente e RAG

**Risco:** campos do incidente ou registros recuperados contêm instruções que o
modelo segue como autoridade. Enriquecer o prompt com RAG não elimina esse
risco. **Severidade inerente:** P1.

Controles:

- normalizar e validar entradas antes do embedding e da montagem do contexto;
- preservar texto original para exibição, mas usar uma representação de análise
  para detectar controles invisíveis, direção bidirecional e smuggling;
- rejeitar caracteres de controle proibidos e entradas acima dos limites, sem
  truncamento silencioso que altere significado;
- marcar cada fonte com ID e delimitadores gerados pelo servidor;
- separar instruções de política do conteúdo recuperado e declarar que o corpus
  nunca pode alterar modelo, regras ou schema;
- limitar retrieval a registros versionados e ao escopo permitido;
- colocar artefato novo ou alterado em quarentena até validação de proveniência e
  varredura de conteúdo hostil;
- exigir que cada afirmação operacional carregue ao menos um ID realmente
  recuperado; suporte semântico, completude e entailment pertencem aos evals.

Evidência de gate:

- fixtures hostis em todos os campos livres e em posições distintas do ranking
  não mudam política, formato ou conjunto autorizado de citações;
- fonte inexistente, não recuperada ou citação omitida invalida o turno inteiro;
- incompatibilidade semântica entre fonte e afirmação conta como falha P1 nos
  evals, sem fingir que uma regra sintática mede groundedness;
- caso sem evidência retorna ausência explícita de sugestão, não uma resolução
  baseada apenas em conhecimento geral.

### TM-03 — jailbreak de escopo e resposta não fundamentada

**Risco:** o copiloto atende um pedido fora do domínio ou transforma conhecimento
geral em causa, comando ou resolução sem suporte. **Severidade inerente:** P1.

Controles:

- política tipada distingue explicação conceitual de diagnóstico e ação;
- classificação inválida, ambígua ou indisponível falha de modo fechado;
- blocos operacionais exigem pelo menos uma citação válida e rastreável;
- confiança baixa ou validação inconclusiva produz fallback seguro;
- o produto comunica que a decisão continua humana e não executa a sugestão.

Evidência de gate:

- matriz PT-BR/inglês cobre perguntas conceituais, casos limítrofes e tentativas
  de converter explicação em instrução operacional;
- validador determinístico rejeita comandos, causas e resoluções sem citação de
  ID recuperado; os evals medem se a fonte citada realmente os sustenta;
- indisponibilidade do classificador ou validador nunca libera resposta parcial.

### TM-04 — mistura e vazamento entre incidentes

**Risco:** histórico, retrieval, cache ou concorrência reaproveita dados de outro
incidente. **Severidade inerente:** P0.

Controles:

- estado do frontend indexado pelo identificador canônico do incidente e
  descartado ao trocar de contexto;
- servidor sem memória conversacional global, sessão persistida ou cache de
  resposta entre incidentes;
- cada turno recarrega o incidente e executa retrieval no escopo daquele turno;
- aceitar no histórico somente pares terminais já aprovados, com limites de
  quantidade e tamanho;
- IDs únicos de correlação, vinculados ao incidente e propagados em todos os
  eventos;
- tarefas, cancelamento e eventos de streaming carregam o mesmo vínculo imutável.

Evidência de gate:

- testes concorrentes intercalam incidentes e verificam fontes, eventos e
  resposta final;
- navegação, retry, cancelamento e remontagem da página não reapresentam contexto
  anterior;
- sentinelas exclusivas por incidente nunca atravessam a fronteira.

### TM-05 — exposição de configuração e credenciais

**Risco:** chaves, URLs internas, stack traces ou configuração aparecem em
resposta, erro, log, bundle do navegador ou endpoint de diagnóstico.
**Severidade inerente:** P0.

Controles:

- armazenar segredos apenas no processo do backend, com tipos que mascaram
  serialização e representação;
- usar chaves dedicadas por provedor e ambiente, com menor privilégio, expiração
  e rotação; aplicar hard cap no OpenRouter e controles locais, rate limits e
  alertas de budget no projeto OpenAI;
- não expor segredo em variável `NEXT_PUBLIC_*`, imagem, arquivo versionado,
  health check ou schema público;
- restringir base URLs externas a HTTPS e allowlist do produto;
- mapear falhas de terceiros para erros públicos estáveis e sanitizados;
- redigir conteúdo sensível antes da emissão de log, incluindo exceções e corpo
  de resposta do provedor;
- manter secret scanning e push protection como gates do repositório.

Evidência de gate:

- testes usam sentinelas para chaves, prompts e respostas de terceiros e afirmam
  ausência em JSON, SSE, HTML, logs e artefatos de build;
- scanner de segredos roda separadamente e aborta antes de qualquer publicação;
- rotação de chave é exercitada sem mudança de código.

### TM-06 — abuso de contexto, disponibilidade e custo

**Risco:** entrada grande, histórico crescente, concorrência, retry ou resposta
longa consome CPU, memória, tokens e crédito. **Severidade inerente:** P1.

Controles:

- limites explícitos para body HTTP, mensagem, item de histórico, quantidade de
  turnos, fontes, eventos e contexto total;
- orçamento determinístico de tokens por etapa, com rejeição previsível quando a
  entrada não cabe;
- no máximo uma tentativa de reparo estrutural e política limitada de retry;
- deadline total por turno e timeouts menores por chamada externa;
- cancelamento cooperativo e liberação de recursos ao desconectar;
- limites de concorrência e frequência por origem local, além de limite global;
- `max_tokens` de saída, allowlist de modelos, hard cap na chave OpenRouter e
  limites locais para chamadas de embedding;
- métricas e alertas para tokens, custo, latência, cancelamentos e rejeições.

Evidência de gate:

- testes de fronteira comprovam rejeição com `413`/`422`/`429` ou erro terminal
  tipado, sem chamada ao provedor quando aplicável;
- timeout, desconexão e resposta malformada não geram loop de retry;
- teste de contrato comprova limite de saída e parâmetros de roteamento em cada
  chamada.

### TM-07 — logging excessivo ou injetável

**Risco:** logs retêm conversas, fontes, respostas ou segredos, ou permitem que
texto de entrada falsifique campos. **Severidade inerente:** P1.

Controles:

- allowlist de campos estruturados: versão do protocolo, ID do turno, ID
  sintético do incidente, modelo, provedor, fase, latência, tokens, custo, IDs de
  fontes, decisão de política, resultado de citações e código de erro;
- conteúdo integral de mensagem, histórico, prompt, fonte e resposta desativado
  por padrão;
- limites de tamanho e neutralização de caracteres de controle em valores;
- mensagens de erro categorizadas, sem `str(exception)` de dependência externa;
- acesso e retenção de logs proporcionais ao ambiente local.

Evidência de gate:

- captura de logs com sentinelas em todas as entradas confirma zero ocorrência;
- cada turno terminal pode ser correlacionado sem reconstruir seu conteúdo;
- falha do sink de observabilidade não libera dados nem derruba a resposta segura.

### TM-08 — renderização insegura da resposta

**Risco:** Markdown ou componentes customizados executam HTML, abrem protocolo
perigoso, carregam mídia externa ou confundem citação com link arbitrário.
**Severidade inerente:** P0.

Controles:

- transportar blocos estruturados e citações separadas, em vez de confiar em
  Markdown livre como protocolo;
- derivar rótulo e destino de citação de metadados do servidor;
- não aceitar URLs fornecidas pelo modelo; links e imagens ficam ausentes salvo
  allowlist explícita do produto;
- manter raw HTML e `dangerouslySetInnerHTML` fora do renderer;
- configurar elementos e transformação de URL permitidos no `react-markdown`;
- aplicar CSP restritiva, `frame-ancestors`, `connect-src` e demais headers de
  segurança compatíveis com a aplicação local;
- publicar apenas a resposta terminal validada, nunca deltas parciais do modelo.

Evidência de gate:

- testes de componente cobrem HTML, protocolos, imagem remota, link arbitrário e
  citação desconhecida;
- teste no navegador comprova ausência de execução e de requisição externa;
- mudança de plugin, componente Markdown ou política CSP reexecuta a suíte.

O `react-markdown` escapa HTML por padrão, o que reduz a superfície. Essa
propriedade deixa de ser garantia se plugins ou componentes reintroduzirem HTML
ou URLs sem validação; por isso a allowlist e os testes são parte do controle.

### TM-09 — risco de roteamento e retenção dos provedores

**Risco:** conteúdo segue para processador não aprovado, recebe política de
retenção inesperada, ativa logging, sofre transformação ou usa fallback que muda
o contrato. **Severidade inerente:** P1.

Controles para OpenRouter:

- chave dedicada com limite monetário, expiração e sem permissão administrativa;
- allowlist explícita de modelos e provedores por configuração versionada;
- política `provider` enviada em toda requisição, incluindo ZDR e negação de
  provedores que coletam dados;
- fallback desativado quando a identidade do processador for requisito; quando
  permitido, cada destino permanece dentro da mesma política;
- input/output logging e uso de conteúdo para melhoria desativados;
- tools e demais plugins desativados; toda chamada envia
  `plugins: [{"id": "context-compression", "enabled": false}]`, sem depender do
  default associado à janela do modelo;
- `X-OpenRouter-Metadata: enabled` em toda chamada e allowlist dos campos de
  roteamento necessários, sem conteúdo da conversa;
- metadados do processador efetivo registrados; ausência do metadado permanece
  desconhecida em runtime e é evidência insuficiente no smoke de release;
- teste de contrato falha se o SDK omitir ou alterar qualquer parâmetro.

O ZDR do OpenRouter não cobre automaticamente plugins e tools. A arquitetura não
os utiliza. Elegibilidade, defaults e lista de provedores são fatos perecíveis e
devem ser revalidados ao alterar o portfólio de modelos.

Controles para OpenAI embeddings:

- projeto e chave dedicados à finalidade de embedding;
- permissão restrita ao endpoint necessário, rate limits por modelo e alertas de
  budget no projeto;
- envio limitado aos campos indispensáveis e sintéticos;
- UI e documentação deixam explícito que a geração de embedding sai do host;
- modo sem chave continua funcional com artefatos versionados no repositório;
- política de retenção e elegibilidade a ZDR verificadas antes de admitir dados
  com classificação diferente de sintético.

A API da OpenAI não usa dados para treinamento por padrão; o endpoint de
embeddings não mantém estado de aplicação e é elegível a ZDR. Sem aprovação para
ZDR, logs de monitoramento de abuso podem reter conteúdo por até 30 dias
(verificado 2026-07). O budget de projeto é um limiar de alerta: requisições
continuam depois de ultrapassá-lo, portanto não substitui contenção local nem um
hard cap (verificado 2026-07). Esses fatos não equivalem a processamento local.

Evidência de gate:

- snapshots de contrato verificam headers, endpoint, modelo, limites, política
  de provider e `context-compression` desativado sem expor a chave;
- smoke test com entrada sintética não cacheada exige metadados de rota, valida
  `endpoints`, `attempts` e `pipeline` e rejeita destino fora da allowlist;
- ausência ou configuração inválida de chave produz onboarding seguro, sem
  fallback para serviço diferente.

### TM-10 — exposição da superfície local

**Risco:** serviços vinculados a todas as interfaces ficam acessíveis na rede ou
por uma página maliciosa no navegador. Qdrant self-hosted não exige autenticação
por padrão. **Severidade inerente:** P0.

Controles:

- vincular frontend e API ao loopback no modo local;
- não publicar a porta do Qdrant no host; manter acesso apenas na rede interna do
  Compose e separar a etapa de seed quando necessário;
- exigir autenticação no Qdrant mesmo na rede interna; a etapa de seed recebe
  credencial de escrita e o runtime usa somente credencial read-only;
- usar filesystem read-only, usuário sem privilégio e capabilities mínimas onde
  compatível;
- limitar CORS à origem exata, métodos e headers necessários, sem credenciais
  quando não há autenticação por cookie;
- validar `Host` e rejeitar origins inesperadas;
- documentar que qualquer exposição remota requer autenticação, autorização,
  TLS e revisão de arquitetura.

Evidência de gate:

- teste de configuração confirma binds, portas publicadas, usuário e rede;
- credencial ausente, inválida ou de escopo incompatível é rejeitada pelo Qdrant;
- chamadas com `Origin` e `Host` não autorizados falham;
- scanner local confirma que o datastore não escuta em interface do host.

### TM-11 — cadeia de software e artefatos

**Risco:** dependência, Action, imagem ou artefato de dados comprometido executa
código ou altera o contexto do modelo. **Severidade inerente:** P1.

Controles:

- instalações reproduzíveis com `uv.lock`, `package-lock.json`, `uv sync --locked`
  e `npm ci`, sem atualização de lockfile no CI;
- dependências diretas em versões compatíveis vigentes e atualização contínua
  assistida por Dependabot;
- Dependency Review e análise de código em PRs;
- Actions fixadas por SHA completo e `GITHUB_TOKEN` com permissões mínimas;
- revisão protegida para workflows e arquivos de lock;
- secret scanning com push protection;
- varredura de dependências e imagens, SBOM e attestations para artefatos
  publicados;
- imagens-base fixadas por digest ou atualizadas por processo automatizado que
  preserve revisão e rastreabilidade;
- validação de schema, checksum e proveniência dos artefatos RAG versionados.

Evidência de gate:

- CI falha para vulnerabilidade crítica/alta explorável sem mitigação aceita;
- lockfile divergente, Action mutável ou permissão excessiva falha em lint de
  configuração;
- build publicado inclui SBOM e attestation verificável;
- alteração do corpus reexecuta validação de schema, integridade e suíte
  adversarial de retrieval.

## Controles transversais

### Montagem segura de contexto

Um único módulo do backend deve ser proprietário da política de contexto. Ele
recebe tipos validados, aplica limites, rotula cada segmento e produz as
mensagens do provedor. Centralizar essa fronteira evita que endpoints diferentes
criem hierarquias de instrução incompatíveis.

Normalização não deve destruir evidência nem identidade de termos técnicos. O
texto original pode permanecer disponível para apresentação, enquanto uma cópia
normalizada serve à detecção. Unicode NFC é a base conservadora; NFKC pode ser
usado como sinal comparativo, não como reescrita silenciosa de todo o conteúdo.

### Contrato de saída

A saída do modelo deve ter schema versionado e fechado. O servidor valida:

- tipo e quantidade de blocos;
- limites de cada campo;
- compatibilidade entre decisão de política e blocos presentes;
- IDs de citações pertencentes ao conjunto recuperado no turno;
- presença de ao menos um ID recuperado em todo diagnóstico, causa, comando ou
  resolução;
- ausência de URL ou tipo de conteúdo não permitido.

Essas verificações garantem integridade estrutural e proveniência permitida. Se a
fonte sustenta semanticamente cada afirmação é uma propriedade probabilística:
correção, completude e entailment são medidas nos evals, não inferidas por regex
ou pelo simples vínculo entre IDs.

Falha de parsing, integridade estrutural ou citação termina em erro seguro. Uma
única tentativa de reparo pode ser aceita dentro do orçamento; reparo não pode
afrouxar o schema.

### Memória efêmera

O histórico aceito pelo servidor é conveniência conversacional, não memória
confiável. O cliente envia apenas turnos terminais aprovados e o servidor limita
janela e tamanho. Compaction, se necessária, é determinística e preserva a
separação entre conteúdo do usuário, resposta e fontes; resumo livre pelo modelo
criaria outra superfície de injection e vazamento.

### Operação sem chave

O repositório público permanece demonstrável com artefatos versionados e
mensagens de onboarding. Health checks não devem exigir provedores nem revelar se
uma chave específica existe. A ausência de credencial impede somente a operação
que realmente depende dela.

## Gates de segurança recomendados

Esta é uma proposta para ratificação pelos tickets normativos de segurança e de
avaliação. Ela preserva a decisão do mapa: PRs executam apenas controles
determinísticos; chamadas reais e métricas probabilísticas rodam no release
candidate e na rotina agendada. O tratamento final de P2 e os limiares
estatísticos permanecem abertos.

| Momento | Evidência | Critério de aprovação |
| --- | --- | --- |
| Cada PR | unitários offline, integração com mocks, schemas, isolamento, renderer, logs, limites, configuração e supply chain | 100% determinístico; nenhuma regressão P0/P1; P2 registrado para decisão normativa |
| PR de prompt/política/corpus/modelo | fixtures e dataset adversarial versionados, sem chamada real | invariantes determinísticos em 100%; execução probabilística fica pendente para RC |
| Release candidate | smoke real bilíngue nos modelos selecionáveis e provedor efetivo | nenhum P0/P1; custo dentro do teto; evidência arquivada sem conteúdo sensível |
| Rotina agendada | corpus adversarial completo, drift de provedor/modelo e scanners | falha P0/P1 abre bloqueio de release; P2 exige triagem |
| Publicação de imagem | SCA, scan da imagem, SBOM, attestation e secret scan | nenhuma exposição de segredo ou vulnerabilidade crítica/alta explorável sem aceite |

As avaliações estocásticas devem registrar versão do dataset, prompt, modelo,
provider, parâmetros e número de repetições. O ticket de contrato de avaliação
define amostragem e limiares estatísticos; este threat model fixa apenas a regra
de que um caso crítico ou alto bem-sucedido não pode ser diluído pela média.

### Matriz mínima de cobertura

| Família | PT-BR | Inglês | Determinístico | Modelo real |
| --- | :---: | :---: | :---: | :---: |
| Injection direta e jailbreak | sim | sim | política/schema | sim |
| Injection indireta em todos os campos e fontes | sim | sim | citação/escopo | sim |
| Fora do domínio e conhecimento geral | sim | sim | estado/blocos | sim |
| Mistura concorrente entre incidentes | sim | sim | sim | smoke |
| Limites, timeout, cancelamento e retry | n/a | n/a | sim | smoke |
| Segredos, erros e logs | sim | sim | sim | não necessário |
| HTML, URL, mídia e citação no renderer | sim | sim | sim | não necessário |
| Roteamento, retenção e custo | n/a | n/a | contrato | sim |
| Rede local, Host, CORS e autenticação do Qdrant | n/a | n/a | sim | não necessário |
| Locks, Actions, SCA, imagens, SBOM, attestation e corpus | n/a | n/a | sim | não necessário |

## Estado do repositório que orienta a implementação

O desenho de controles precisa cobrir estas superfícies observáveis no código:

- campos do incidente e conteúdo recuperado são interpolados em prompts;
- a requisição de sugestão aceita campos do incidente fornecidos pelo cliente;
- a geração devolve Markdown livre em um campo `str`; o backend não valida schema
  de blocos nem citações antes de a UI exibir a resposta;
- entradas textuais não possuem todos os limites de tamanho necessários;
- exceções de provedor podem alcançar logs por representação textual;
- o renderer de Markdown permite links produzidos pelo conteúdo;
- não há uma política completa de headers de segurança no frontend;
- CORS aceita todos os métodos e headers e usa credenciais;
- o Compose publica API, frontend e portas do Qdrant no host;
- `LLM_BASE_URL` aceita gateways compatíveis arbitrários, enquanto o estado-alvo
  restringe chat ao OpenRouter;
- roteamento, ZDR, retenção e limite financeiro não fazem parte do contrato
  explícito das chamadas de provedor;
- workflows usam referências mutáveis de Actions e o conjunto de scanners de
  segurança não cobre todos os gates recomendados.

Esses itens são entradas para especificação e tickets, não afirmações de
explorabilidade. A correção deve preservar o recorte local, simples e somente
leitura do produto.

## Riscos residuais

- modelos continuam sujeitos a injection e comportamento inesperado mesmo com
  prompts, filtros e testes robustos;
- classificação e groundedness baseados em modelo permanecem probabilísticos;
- políticas e rotas de provedores externos podem mudar;
- artefato versionado reduz, mas não elimina, risco de corpus contaminado;
- dados sintéticos não demonstram controles regulatórios para dados bancários
  reais;
- execução local não protege um host já comprometido.

Esses riscos são aceitáveis somente enquanto o copiloto permanecer sem agência,
somente leitura, com saída inerte e decisão humana. Ferramentas, persistência,
uploads, dados reais ou exposição remota invalidam essa conclusão e exigem nova
análise antes da implementação.

## Decisões que permanecem abertas

[Definir o threat model e os gates de segurança do
release](https://github.com/johnlaff/incident-sense/issues/19) deve ratificar:

- o perfil exato AISVS/LLMSVS e as exceções justificadas;
- limites numéricos de entrada, contexto, concorrência, timeout e retry;
- política de bloqueio, sinalização e fallback do detector de injection;
- allowlist de providers e quando fallback de roteamento é permitido;
- ciclo de vida das credenciais read-only e de seed do Qdrant;
- requisito de ZDR para o escopo sintético e para qualquer escopo futuro;
- limiares P2 e processo de aceite de risco;
- retenção da telemetria minimizada e acesso aos artefatos de avaliação.

A escolha de modelos valida compatibilidade com esses controles; ela não pode
reduzir o perfil de segurança para acomodar um modelo.

## Referências primárias

Padrões e taxonomias:

- [OWASP AI Security Verification Standard 1.0](https://owasp.org/www-project-artificial-intelligence-security-verification-standard-aisvs-docs/)
- [OWASP Large Language Model Security Verification Standard 2.0](https://owasp.org/www-project-llm-verification-standard/LLMSVS-v2.0-en.html)
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/)
- [OWASP LLM01: Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [OWASP LLM02: Sensitive Information Disclosure](https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/)
- [OWASP LLM03: Supply Chain](https://genai.owasp.org/llmrisk/llm032025-supply-chain/)
- [OWASP LLM05: Improper Output Handling](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/)
- [OWASP LLM08: Vector and Embedding Weaknesses](https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/)
- [OWASP LLM10: Unbounded Consumption](https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/)
- [OWASP Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
- [OWASP Application Security Verification Standard 5.0](https://owasp.org/www-project-application-security-verification-standard/)
- [NIST AI 100-2e2025: Adversarial Machine Learning](https://csrc.nist.gov/pubs/ai/100/2/e2025/final)
- [NIST AI 600-1: Generative Artificial Intelligence Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf)

Provedores e stack:

- [OpenRouter: Data collection](https://openrouter.ai/docs/guides/privacy/data-collection)
- [OpenRouter: Zero Data Retention](https://openrouter.ai/docs/guides/features/zdr)
- [OpenRouter: Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [OpenRouter: Provider logging](https://openrouter.ai/docs/guides/privacy/provider-logging/)
- [OpenRouter: Guardrails](https://openrouter.ai/blog/announcements/guardrails/)
- [OpenRouter: Prompt injection guardrail](https://openrouter.ai/docs/guides/features/guardrails/prompt-injection)
- [OpenRouter: Message transforms](https://openrouter.ai/docs/guides/features/message-transforms)
- [OpenRouter: Router metadata](https://openrouter.ai/docs/guides/features/router-metadata)
- [OpenAI: Data controls in the API platform](https://developers.openai.com/api/docs/guides/your-data#default-usage-policies-by-endpoint)
- [OpenAI: Projects, rate limits and soft budgets](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform)
- [react-markdown: Security and usage](https://github.com/remarkjs/react-markdown)
- [Next.js: Content Security Policy](https://nextjs.org/docs/app/guides/content-security-policy)
- [FastAPI: CORS](https://fastapi.tiangolo.com/tutorial/cors/)
- [Qdrant: Security](https://qdrant.tech/documentation/security/)
- [Docker: Port publishing](https://docs.docker.com/engine/network/port-publishing/)
- [GitHub Actions: Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub: Dependency review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review)
- [GitHub: Push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection)

Versões, políticas de retenção, defaults de roteamento e documentação dos
provedores foram verificados em 2026-07. Esses fatos devem ser revalidados antes
de alterar modelos, endpoints, providers ou o perfil de dados.
