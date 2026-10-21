# Geração dos dados sintéticos

Todos os dados são **sintéticos** e o banco ("Banco Meridiano") é **fictício**.
Nenhum nome real de empresa, produto, time, pessoa ou sistema aparece.

São três bases commitadas em `backend/data/`, mais os artefatos pré-computados:

| Arquivo | O que é | Como nasce |
| --- | --- | --- |
| `incidents.json` | 431 incidentes | gerado por `scripts/generate_dataset.py` (LLM + Faker) |
| `problems.json` | 10 Problemas (`PRB0004101` a `PRB0004110`) | curado no repositório (sem script de geração), ligado aos incidentes de cada arquétipo |
| `changes.json` | 18 Changes (`CHG003…`) | curadas no repositório e calibradas com o juiz real |
| `precomputed/` | vetores e agrupamento | `scripts/precompute.py` e `scripts/reembed.py` |

## Incidentes

`backend/scripts/generate_dataset.py` produz `backend/data/incidents.json`
combinando:

- **8 arquétipos** de causa raiz bancária (em `data/archetypes.py`): timeout
  no Pix, exaustão de pool no internet banking, falha de login no app após
  deploy, erro na geração de boleto, recusa de cartão, divergência de saldo,
  fila de mensageria travada e indisponibilidade de Open Finance. Cada arquétipo
  tem tema, categoria, serviço afetado e uma **resolução canônica**.
- Para cada arquétipo, o LLM gera **40 a 60 variações** parafraseadas
  (descrições variadas + `resolution_notes` para os resolvidos, a base de
  conhecimento do RAG).
- **70 incidentes de ruído**, propositalmente avulsos e diversos (projetor,
  ramal, ar-condicionado), para exercitar o tratamento de ruído do HDBSCAN e o
  caminho `IMPROCEDENTE`.
- **3 incidentes-demo plantados** e marcados (`procedente`, `borderline`,
  `improcedente`), além do incidente da aula (`INC0052233`, do arquétipo de
  login no app). Ver [rag-flow.md](rag-flow.md#os-incidentes-da-demo).

Cada incidente tem `empresa` (sempre "Banco Meridiano") e `tags` semânticas de
um vocabulário fechado, usadas na camada 1 da recuperação.

### Realismo

- **Faker (`pt_BR`)** preenche os campos estruturais: números de incidente,
  timestamps enviesados para horário comercial, grupos de atendimento, estados.
- Uma fração (cerca de 15%) recebe **bagunça** proposital: typos, descrição
  truncada, time de atendimento errado. É isso que torna o pós-filtro
  significativo.

## Problemas

Cada Problema tem causa raiz, contorno, solução definitiva, tags, um resumo em
linguagem simples (`plain_summary`) e os incidentes que explica
(`linked_incidents`). As datas de abertura e resolução vêm depois dos
incidentes ligados.

## Changes

Cada Change tem os 7 campos avaliados pela grade (objetivo, benefícios,
pré-requisitos, plano de implementação, plano de validação, justificativa dos
testes e descrição resumida), mais plano de retorno e tarefas, que entram na
conferência de coerência. Os cenários cobrem exemplares, incoerentes (campos
bons que se contradizem), medianas e fracas, e três ficam fora do escopo de
propósito (tipo Standard, estado Scheduled e outra empresa do grupo,
"Meridiano Seguros"). Os textos foram calibrados com o juiz real: as exemplares
ficam entre 8,9 e 9,3, as medianas entre 6,5 e 7,0 e as fracas abaixo de 1,4.

A avaliação de exemplo usada nos testes e nas capturas do README
(`frontend/tests/evaluation-fixture.json`) é gerada por
`scripts/evaluation_fixture.py`: rota real, grade real e avaliador real, com o
modelo trocado por um juiz simulado de leituras escritas à mão. Nenhuma chamada
de IA.

## Determinismo

A camada estrutural usa **seed fixa** (Faker + `random`). A camada de texto vem
do LLM: o dataset é gerado **uma vez** e o `incidents.json` resultante é
**commitado** como fonte da verdade. Regenerar reproduz o _processo_, não o
texto byte a byte. Ver o
[ADR 0006](decisions/0006-execucao-local-e-determinismo.md).

## Pré-computados

Em `backend/data/precomputed/`:

- `embeddings.npz`: embeddings do texto cru dos 431 incidentes, usados pelo
  agrupamento.
- `summary_embeddings.npz`: embeddings do resumo + categoria, subcategoria e
  empresa dos 326 incidentes resolvidos. Semeiam a coleção do RAG.
- `problem_embeddings.npz`: embeddings dos 10 Problemas.
- `clusters.json`: resultado do agrupamento (coordenadas 2D, grupo, rótulo,
  caso isolado).

## Regenerar

```bash
make generate     # regenera incidents.json (faz chamadas de LLM)
make precompute   # recomputa embeddings + agrupamento + rótulos
cd backend && uv run python scripts/reembed.py --incidents --problems   # vetores do RAG
make seed         # carrega os vetores no Qdrant servidor
```

> Essas etapas precisam da chave no `.env` (menos o `make seed`). O app já vem
> com tudo commitado, então **não** é preciso rodá-las para usar o demo.
