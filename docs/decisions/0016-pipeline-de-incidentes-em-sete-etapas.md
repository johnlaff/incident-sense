# ADR 0016: Pipeline de incidentes em sete etapas com recuperação em três camadas

- Status: Aceito
- Data: 2026-10-19

## Contexto

O fluxo de sugestão tinha seis passos próprios do demo (resumir, embed,
pré-filtro por metadados, busca, pós-filtro, classificar) e limiares
ilustrativos (cosseno 0,4, top-K 5). O artigo técnico do João sobre sugestão de
resolução de incidentes descreve um pipeline de produção diferente, e o
incident-sense é a reprodução open source dele com dados sintéticos.

## Decisão

- O fluxo segue as sete etapas do artigo: carregar, resumo por IA, embedding do
  resumo com categoria, subcategoria e empresa, recuperação em três camadas,
  contexto, decisão de procedência, sugestão com fontes e publicação no
  incidente.
- A recuperação tem três camadas: tags semânticas (onde procurar), vetor (o que
  parece) e pós-filtro por LLM (o que serve). O pré-filtro por categoria e
  serviço deu lugar ao filtro por tags.
- Cosseno mínimo 0,8, top-K 5 em incidentes e top-K 10 em problemas são os
  padrões, todos em configuração.
- Problemas sintéticos ganham coleção própria. Sem chave, cada problema é
  indexado na média dos vetores dos incidentes vinculados.
- Falha do pós-filtro devolve a lista original; citação fora do contexto é
  removida ou sinalizada; improcedente e procedente sem contexto não geram
  sugestão.
- A sugestão é publicada como nota de trabalho do incidente, guardada em memória
  no processo.
- A resposta expõe cada etapa e cada camada com o que decidiu, e a tela mostra
  isso no detalhe do incidente.

## Consequências

- A base commitada ainda embute o texto cru; a consulta já usa o resumo. Até o
  re-embedding (`scripts/reembed.py`, precisa de chave), o limiar 0,8 corta mais
  do que cortaria em produção. Ver [rag-flow.md](../rag-flow.md).
  **Atualização (2026-10-19):** o re-embedding foi feito no PR #95
  (`summary_embeddings.npz` e `problem_embeddings.npz` commitados).
- O contrato de `POST /api/suggest` cresceu (campos novos); os campos antigos
  continuam presentes.
- Notas publicadas somem quando a API reinicia, o que é aceitável para o demo.
