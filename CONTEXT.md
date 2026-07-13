# Operações de incidentes

Este contexto descreve a linguagem usada para analisar incidentes técnicos, recuperar evidências históricas e formular orientações operacionais no Banco Meridiano.

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

**Copiloto contextual de incidentes**:
Assistente conversacional read-only limitado ao incidente em análise, aos incidentes históricos recuperados e ao domínio de operações de incidentes.
_Evitar_: Chatbot, assistente genérico, agente autônomo

**Sugestão fundamentada**:
Orientação operacional cujas afirmações sobre diagnóstico e resolução são rastreáveis ao incidente em análise ou a incidentes históricos citados.
_Evitar_: Resposta da IA, solução automática

**Recorrência**:
Hipótese de padrão comum entre incidentes semanticamente semelhantes que merece investigação operacional; não comprova, por si só, uma causa raiz.
_Evitar_: Causa raiz, problema confirmado, cluster

**Procedente**:
Classificação de um chamado que representa um incidente técnico, independentemente de existir evidência histórica semelhante.
_Evitar_: Com base, resolvível

**Improcedente**:
Classificação de um chamado que não representa falha técnica, como autoatendimento, dúvida ou solicitação administrativa.
_Evitar_: Sem base, irrelevante
