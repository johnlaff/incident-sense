# Operações de incidentes

Este contexto descreve a linguagem usada para analisar incidentes técnicos, recuperar evidências históricas, formular orientações operacionais e avaliar pedidos de mudança no Banco Meridiano.

## Language

**Incidente**:
Falha técnica em um sistema ou serviço que exige atuação de operações.
_Evitar_: Chamado, solicitação, ticket

**Incidente em análise**:
Incidente aberto no workspace que delimita o contexto de uma investigação ou conversa.
_Evitar_: Incidente atual, ticket aberto

**Incidente histórico**:
Incidente resolvido que pode servir como evidência para analisar o incidente em análise.
_Evitar_: Caso antigo, documento, base

**Assistente da IA**:
Nome, na interface, do painel aberto por "Perguntar à IA" no incidente em análise. A primeira pergunta roda a análise completa; as seguintes são perguntas de acompanhamento. O nome antigo, Aurora, sobrevive só em identificadores internos do código.
_Evitar_: Aurora, chatbot

**Copiloto contextual de incidentes**:
Assistente conversacional read-only limitado ao incidente em análise, aos incidentes históricos recuperados e ao domínio de operações de incidentes. É a evolução planejada do assistente da IA, com streaming (issues #43 e #58).
_Evitar_: Chatbot, assistente genérico, agente autônomo

**Caso mantido**:
Incidente histórico ou problema que passou pelas três camadas da recuperação (tags, vetor e pós-filtro) e entrou no contexto da análise.
_Evitar_: Resultado da busca, documento

**Pergunta de acompanhamento**:
Pergunta feita ao assistente da IA depois da análise, respondida só com o incidente em análise e os casos mantidos, sem publicar nota de trabalho.
_Evitar_: Nova análise, chat livre

**Sugestão fundamentada**:
Orientação operacional cujas afirmações sobre diagnóstico e resolução são rastreáveis ao incidente em análise ou a incidentes históricos citados.
_Evitar_: Resposta da IA, solução automática

**Problema**:
Registro da causa raiz por trás de um grupo de incidentes, com contorno e solução definitiva; também serve de evidência para a sugestão.
_Evitar_: Cluster, recorrência confirmada

**Nota de trabalho**:
Registro publicado no incidente durante a tratativa; a sugestão fundamentada é publicada como nota de trabalho.
_Evitar_: Comentário, log

**Recorrência**:
Hipótese de padrão comum entre incidentes semanticamente semelhantes que merece investigação operacional; não comprova, por si só, uma causa raiz. Na interface, a seção se chama "Repetições" ("falhas que se repetem").
_Evitar_: Causa raiz, problema confirmado, cluster

**Grupo**:
Conjunto de incidentes que o agrupamento juntou por semelhança, com um nome dado pela IA; é a forma visível de uma recorrência.
_Evitar_: Cluster (na interface), tópico

**Caso isolado**:
Incidente que não se parece o bastante com nenhum outro para entrar num grupo (ruído do HDBSCAN).
_Evitar_: Outlier (na interface), lixo

**Procedente**:
Classificação de um chamado que representa um incidente técnico, independentemente de existir evidência histórica semelhante.
_Evitar_: Com base, resolvível

**Improcedente**:
Classificação de um chamado que não representa falha técnica, como autoatendimento, dúvida ou solicitação administrativa.
_Evitar_: Sem base, irrelevante

**Mudança**:
Requisição de mudança (Change) em um serviço, avaliada antes do deploy. Na interface o termo é "Mudança"; "Change" aparece em nomes técnicos e no número (CHG).
_Evitar_: Deploy, release

**Grade**:
Conjunto versionado de campos, pesos e critérios contra o qual a IA juíza dá nota a uma mudança.
_Evitar_: Rubrica solta, checklist

**Trava de conteúdo**:
Regra pela qual um campo cujo texto não mudou reaproveita a nota anterior do mesmo visitante, sem nova chamada ao modelo.
_Evitar_: Cache (na interface)

**Coerência**:
Conferência, feita só com média a partir de 8,0, de que as partes da mudança contam a mesma história e de que o plano de retorno desfaz o que as tarefas fazem.
_Evitar_: Análise semântica (na interface)

**Veredito da mudança**:
Decisão única calculada pelo backend (`decision`): a mudança pode seguir para aprovação humana ou não, com o motivo e todas as portas que reprovaram.
_Evitar_: Aprovação (quem aprova é uma pessoa)

**Visitante**:
Quem usa a demo, identificado pelo id aleatório do navegador (`X-Client-Id`); a cota, a trava de conteúdo e as notas de trabalho valem por visitante.
_Evitar_: Usuário logado, conta
