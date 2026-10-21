# ADR 0021: Pergunta de acompanhamento fundamentada só nos casos mantidos

- Status: Aceito
- Data: 2026-10-21

## Contexto

O assistente da IA tinha caixa de texto, mas no teste E2E ao vivo (terceira
rodada) o que a pessoa digitava não virava uma pergunta de verdade sobre a
análise. Rodar o pipeline completo a cada pergunta seria lento, caro e poderia
trocar as fontes que a pessoa acabou de conferir.

## Decisão

- A primeira abertura do assistente continua sendo a análise completa
  (`POST /api/suggest`), que publica a nota como antes.
- Cada pergunta seguinte vai para `POST /api/incidents/{number}/ask`, com
  `question`, os `context_ids` da análise e o modelo escolhido.
- Uma chamada ao modelo, com o incidente e **só os casos que a análise
  manteve**: incidentes resolvidos e Problemas reais da base. O próprio
  incidente nunca é fonte. Nada de busca nova.
- A resposta tem `kind`: `answer`, `not_in_cases` (os casos não respondem, e a
  resposta diz isso) ou `off_topic`. As citações passam pela mesma validação
  da sugestão.
- **Nunca publica nota de trabalho.** Usa a mesma guarda de uso da sugestão.
- Saudações e agradecimentos recebem resposta curta sem chamar o modelo.
- Pergunta digitada antes da análise espera a análise terminar e depois é
  feita.

## Consequências

- A conversa fica presa à evidência que a pessoa vê na aba Análise da IA; a
  fonte de cada resposta é conferível.
- Perguntas sobre algo que os casos não cobrem recebem "os casos não respondem
  a isso" em vez de uma resposta inventada.
- Esta é a versão síncrona e simples. O copiloto conversacional com streaming
  descrito nas issues #43 e #58 (e nos ADRs 0011 a 0014, ainda não escritos)
  continua planejado.
