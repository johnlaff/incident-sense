# Prompt para o Claude Design — incident-sense

> Cole tudo abaixo no Claude Design. Peça um **protótipo interativo multi-tela**
> (não uma única imagem). Itere depois pedindo ajustes por tela.

---

Construa um **protótipo de produto 100% interativo e multi-tela** chamado
**incident-sense**: a ferramenta de ITSM (gestão de incidentes de TI) de um banco
**fictício** chamado **Banco Meridiano**, com um **copiloto de IA** que sugere
resoluções fundamentadas e **rastreáveis**. Todos os dados são **sintéticos** —
nenhuma empresa, pessoa ou sistema real.

É uma peça de **portfólio sênior** e demo de **workshop** (plateia mista: do 1º
semestre a engenheiros seniores), então precisa ser **bonito, preciso e
crível** — e, acima de tudo, **NÃO genérico**.

## DNA visual (mire neste craft — cite mentalmente estas referências)

- **Linear** — densidade e precisão extremas, hairlines de 1px, ícones de status
  pequenos e nítidos, navegação por teclado (⌘K, j/k), grid de 4px, zero gordura
  visual, velocidade como identidade.
- **Stripe / Vercel (modo claro)** — superfícies claras refinadas, tipografia
  impecável, profundidade sutil e intencional, estados de vazio/carregando
  caprichados.
- **Perplexity** — resposta de IA com **citações inline numeradas e clicáveis** +
  uma **tira de fontes** com preview; confiança vem de "mostrar as fontes".
- **ServiceNow (Service Operations Workspace)** — a **estrutura** familiar de
  ITSM: lista + registro + painel contextual de IA ("Agent Assist"), formulário
  em seções, activity stream, status colorido. Fidelidade de estrutura, craft
  moderno.

A história: é "**o ServiceNow do Banco Meridiano**" — estrutura de ITSM real,
tematizada com a marca do banco e elevada ao acabamento dos melhores produtos.

## Sistema de design (use exatamente)

- **Tema:** claro, "operations-grade". Alto contraste (sobrevive a projetor).
  Inclua um **toggle de modo escuro** refinado (cinza-azulado profundo, não
  preto puro).
- **Cor (OKLCH):** chrome neutro frio + **uma cor de marca índigo-violeta** só
  para ações primárias, item selecionado, links e a identidade do copiloto.
  Vermelho/laranja/âmbar/verde ficam **reservados a status** (nunca a marca).
  - Superfícies: app `oklch(0.985 0.003 285)`, conteúdo `#fff`, hover
    `oklch(0.974 0.004 285)`; borda `oklch(0.92 0.004 285)`.
  - Tinta: títulos `oklch(0.255 0.012 285)`, corpo `oklch(0.32 0.011 285)`,
    secundário `oklch(0.5 0.01 285)`.
  - Marca/primário: `oklch(0.48 0.16 285)`; tint `oklch(0.96 0.02 285)`.
  - Prioridade: Crítica `oklch(0.55 0.205 27)`, Alta `oklch(0.55 0.16 50)`,
    Moderada `oklch(0.52 0.09 90)`, Baixa `oklch(0.5 0.02 285)`.
  - Estado: Aberto `oklch(0.5 0.13 240)`, Em andamento `oklch(0.5 0.12 55)`,
    Em espera `oklch(0.5 0.02 285)`, Resolvido `oklch(0.5 0.12 150)`.
  - Status **sempre** como ícone + cor + rótulo (acessível a daltônicos).
- **Tipografia:** uma família sans precisa e levemente distintiva (**Geist** ou
  Inter) para tudo; **mono** (Geist Mono / JetBrains Mono) para números de
  incidente, IDs e scores. Escala rem **fixa** (12/13/14/16/18/20/24/30), base
  14px (ferramenta densa). Títulos peso 600, tracking −0.01em.
- **Forma:** raio 8px em cards/inputs (nunca 24px+), pills para badges/tags.
  Bordas hairline 1px. Sombras sutis e definidas (não "ghost card").
- **Grid 4px.** Densidade alta, ritmo de espaçamento variado (não tudo igual).
- **Motivo de marca "Meridiano":** uma linha-meridiano fina com ticks discretos
  (no topo / nos estados de vazio) e uma marca "M" refinada. Use com parcimônia.

## Motion (assinatura, sutil)

- 150–220ms, ease-out exponencial. Motion comunica **estado**, não decoração.
- **Momento-assinatura:** o **pipeline do copiloto "pensando"** — cada etapa
  (Resumir consulta → Buscar vizinhos → Pós-filtro → Classificar → Sugerir)
  aparece e marca ✓ em sequência, com micro-stagger.
- Citação ao abrir: pulso curto + preview. Lista→detalhe: transição suave.
- Reveal das recorrências: pontos animam às posições do cluster (~700ms).
- Tudo com alternativa `prefers-reduced-motion` (crossfade/instantâneo).

## Telas (detalhe TODAS — protótipo navegável entre elas)

### 1. Incidentes (lista) — tela inicial
App shell: nav lateral (Incidentes · Recorrências · Como funciona) + topbar
(marca "Banco Meridiano · incident-sense", busca global, ⌘K, avatar).
- Barra de filtros: segmented **Abertos · Resolvidos · Todos**; selects de
  Serviço e Prioridade; busca na lista. Filtros refletidos como chips removíveis.
- Tabela **densa** (estilo Linear/ServiceNow): colunas Número (mono, índigo) ·
  Descrição · Serviço (mono) · Estado (badge ícone+cor) · Prioridade (badge) ·
  Aberto (relativo). Hover de linha, linha selecionada (tint índigo), navegação
  por teclado (j/k, Enter abre), ordenação por coluna.
- Rodapé: contagem + paginação. **Skeleton** ao carregar. **Empty state** que
  ensina (com o motivo meridiano). ~12 linhas de dados realistas (abaixo).

### 2. Incidente (detalhe) — estilo Agent Workspace (3 zonas)
Breadcrumb (Incidentes / INCxx. Centro: **registro**.
- Cabeçalho: número (mono), título (curto), badges de Estado e Prioridade, meta
  (serviço · grupo · aberto há…). Ações: Atribuir, Resolver (desabilitado/demo).
- Abas: **Detalhes · Atividade · Relacionados**.
  - Detalhes: formulário em **seções**, campos em **duas colunas** (Categoria,
    Subcategoria, Serviço/CI, Grupo, Impacto, Urgência, Estado), Descrição (full),
    Notas de resolução (se resolvido), Close code, Tags.
  - Atividade: **activity stream** cronológico (abertura, work notes, mudança de
    estado, resolução) com avatares/horários.
  - Relacionados: incidentes do mesmo serviço/recorrência.

### 3. Copiloto de resolução — painel à direita (slot "Agent Assist")
- Cabeçalho do painel com identidade índigo sutil ("Copiloto · RAG fundamentado ·
  deepseek-v4").
- Estado inicial: prompt sugerido "Sugerir resolução para este incidente" +
  campo de chat.
- Ao acionar: **o pipeline anima** (as 5 etapas marcando ✓ em sequência).
- **Incidentes consultados:** lista de candidatos, cada um com número (mono),
  descrição, **score de similaridade** (mono) e pill **mantido/descartado** (o
  pós-filtro), + ícone de abrir. **Hover mostra um preview** do registro citado.
- **Veredito:** badge **PROCEDENTE / IMPROCEDENTE** com justificativa curta.
- **Sugestão fundamentada:** texto com **citações inline `[INC…]` clicáveis**
  (estilo Perplexity). Ações: **Inserir nas notas de resolução** (assist, não
  override), Copiar, "Por que essa sugestão?" (expande o raciocínio).
- Caso IMPROCEDENTE (ex.: "esqueci minha senha"): sem sugestão, mensagem clara
  de que não há resolução conhecida aplicável.

### 4. Abrir incidente citado (a feature de confiança)
Clicar numa citação/candidato abre o **registro completo do incidente citado**
(drawer "peek" sobre a tela, ou navegação) para o usuário **conferir** se é de
fato similar e se a sugestão veio daquela resolução. Mostre as resolution notes
do citado em destaque. Botão "voltar ao incidente".

### 5. Recorrências / Problemas (Problem Management)
Mapa de pontos (cada incidente um ponto, colorido por cluster) que **anima** para
as posições dos grupos, com **rótulos de IA** por cluster (ex.: "Timeout em Pix",
"Falha de login no app"). Clicar num cluster lista seus incidentes e oferece
"Promover a problema". Legenda com tamanho de cada grupo. Outliers em cinza.

### 6. Como funciona (didático)
Página que **anima o fluxo completo** por baixo dos panos (RAG: resumir → embed →
buscar → pós-filtro → classificar → sugerir; e o clustering), passo a passo,
legível para iniciantes — diagramas limpos, sem jargão gratuito.

### 7. Command palette (⌘K)
Sobreposição estilo Raycast/Linear: buscar incidente por número/texto, pular
entre telas, "Sugerir resolução", alternar tema. Resultados com ícones e atalhos.

### Estados (todos)
Loading (skeleton, nunca spinner no meio do conteúdo), empty (que ensina), erro
amigável (ex.: "configure as chaves de API"), 404. Responsivo: nav colapsa em
ícones, copiloto empilha abaixo do registro, tabela vira cards no mobile.

## Dados sintéticos (use estes, realistas, em PT-BR)

8 causas-raiz recorrentes do banco: **timeout no Pix; lentidão no internet
banking; falha de login no app após deploy; erro na geração de boleto; recusa de
cartão; divergência de saldo no extrato; fila de mensageria travada;
indisponibilidade de Open Finance.** Serviços (CI): PIX-Core, Internet-Banking-Web,
App-Mobile, Boleto-Service, Cartoes-Autorizador, Extrato-Service, Mensageria-Kafka,
OpenFinance-Gateway. Grupos: Sustentacao-Pagamentos, Sustentacao-Canais-Digitais,
Service-Desk-N1, etc.

Incidente-demo (aberto): **INC0053084 — "Pix confirmado para o cliente mas sem
comprovante há 2h"** (PIX-Core, Service-Desk-N1, Prioridade Alta). Candidatos da
sugestão: INC0051986 (0.71, mantido), INC0051908 (0.64, mantido), INC0051947
(0.62, mantido), INC0052071 (0.58, **descartado** pelo pós-filtro). Veredito
**PROCEDENTE**. Sugestão: aumentar workers do PIX-Core e ajustar timeout do DICT,
reprocessar pendentes pela conciliação — citando [INC0051986] [INC0051908]
[INC0051947]. Inclua ~12 incidentes variados na lista (abertos e resolvidos).

## Interatividade exigida (100% clicável)

Navegar entre as telas; filtrar/buscar na lista; abrir um incidente; acionar o
copiloto e ver o pipeline animar; clicar numa citação e abrir o registro citado;
abrir o ⌘K; alternar tema claro/escuro; ver Recorrências animar; abrir "Como
funciona". Use dados mock locais (sem backend).

## Proibições (evite o "AI slop")

Sem cards genéricos repetidos, sem eyebrow/kicker em maiúsculas acima de cada
seção, sem texto em gradiente, sem glassmorphism decorativo, sem bordas-faixa
laterais, sem raios 24px+, sem ilustrações "rabiscadas". Densidade e precisão >
espetáculo. Se parecer um "dashboard SaaS genérico", refaça.
