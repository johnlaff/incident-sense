# ADR 0019: O backend é a fonte única do veredito da Mudança

- Status: Aceito
- Data: 2026-10-21

## Contexto

A tela da Mudança recalculava o veredito em vários lugares (manchete, barra,
fórmula, legenda do modo aula, lista) a partir da média, da coerência e da
aderência. As revisões de UI e as auditorias de lógica acharam contradições
reais: a manchete dizia 8,2 ao lado de "= 7,59"; a CHG0031001 aparecia como
"Não segue" com média 9,24, coerência 8,0 e "Aderente"; uma contradição real
listada não reprovava; e o motivo de corte arredondava "7,96" para "8.0 abaixo
de 8.0".

## Decisão

- `decide()` em `backend/src/incident_sense/changes/evaluator.py` calcula o
  veredito **uma vez** e a resposta traz o campo `decision`:
  `{ passes, reason_code, failed, reason }`.
- A Change **pode seguir** quando:
  - a média ponderada é pelo menos 8,0;
  - a nota de consistência (uma casa) é pelo menos 8,0;
  - não há contradição real em `problems` (sugestões ficam em `guidance` e
    nunca decidem);
  - a aderência do plano de retorno não é `NAO_ADERENTE` (abaixo de 50%).
- `reason_code` é um de `passes`, `field_missing`, `average_below`,
  `semantic_missing`, `coherence_below`, `contradictions`,
  `backout_not_adherent`. `failed` lista todas as portas que reprovaram, na
  ordem, e `reason` cita cada uma em português, com duas casas na média.
- Campo que a IA não conseguiu avaliar segura o veredito (`field_missing`),
  a não ser que nem um 10 nele levasse a média a 8,0 (então `average_below`).
  Conferência que não voltou (timeout, cota, formato) é `semantic_missing`.
- O rótulo de aderência sai só do percentual (80% ou mais `ADERENTE`, 50% ou
  mais `PARCIAL`), para que número e rótulo nunca se contradigam.
- Todas as telas leem só `decision`. O frontend não recalcula o veredito.

## Consequências

- Uma regra, um lugar, testada no backend (`test_changes_audit.py`). A tela
  mostra o veredito como duas perguntas ("A média passa de 8,0?" e "As partes
  do pedido combinam?") e a frase do motivo.
- O contrato da rota cresceu com um campo novo; nada foi removido.
- Mudar a regra é mudar `decide()` e os testes, não as telas.
