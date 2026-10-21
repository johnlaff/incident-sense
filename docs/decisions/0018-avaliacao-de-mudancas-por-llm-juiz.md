# ADR 0018: Avaliação de Mudanças por LLM-como-juiz, com grade versionada e trava de conteúdo

- Status: Aceito
- Data: 2026-10-19

## Contexto

A palestra "Depois do Deploy" começa antes do deploy, com o artigo do Solange
sobre a qualidade do preenchimento das requisições de mudança (Changes). O
incident-sense só tratava incidentes. Era preciso mostrar a avaliação de forma
que a plateia visse como a nota se forma e por que a análise de coerência roda
ou não.

## Decisão

- **Grade versionada** em `backend/src/incident_sense/changes/rubrica.toml`:
  7 campos com pesos (soma 13,5) e critérios, e o corte de elegibilidade 8,0.
  A versão entra na resposta e na chave da trava, então uma grade nova
  reavalia tudo.
- **Escopo explícito**: só Changes `Normal`, no estado `New`, do Banco
  Meridiano. As outras aparecem como "não avaliada", nunca como nota zero.
- **Um juiz por campo**, os 7 em paralelo, para que um campo bom não compense
  um vazio e a latência tenda ao campo mais lento, não à soma.
- **Média ponderada** e, só a partir de 8,0, a **conferência de coerência**:
  as partes contam a mesma história e o plano de retorno desfaz o que as
  tarefas fazem.
- **Trava de conteúdo**: um campo cujo texto normalizado não mudou reaproveita
  a nota anterior, sem chamar o modelo. Editar um campo na tela e reavaliar
  manda ao modelo só o que mudou.
- Rota `POST /api/changes/{number}/evaluate`, com a mesma guarda de uso do
  `/suggest`. 18 Changes sintéticas, calibradas com o juiz real.

## Consequências

- A tela repassa a avaliação em etapas reais: notas por campo, a fórmula da
  média termo a termo, a trava de 8,0 e a coerência.
- Respostas cortadas ou fora do formato do modelo foram a principal fonte de
  erro; cada campo e a coerência têm uma nova tentativa de formato, o
  orçamento de tokens subiu (1000 por campo, 2000 na coerência) e o raciocínio
  oculto foi desligado ([ADR 0022](0022-raciocinio-oculto-desligado.md)).
- O veredito final passou a ser calculado só no backend
  ([ADR 0019](0019-backend-fonte-unica-do-veredito-da-mudanca.md)) e a trava
  passou a valer por visitante ([ADR 0020](0020-escopo-por-visitante.md)).
