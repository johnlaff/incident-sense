# Geração do dataset sintético

Todos os dados são **sintéticos** e o banco ("Banco Meridiano") é **fictício**.
Nenhum nome real de empresa, produto, time, pessoa ou sistema aparece.

## O que é gerado

`backend/scripts/generate_dataset.py` produz `backend/data/incidents.json` (~430
incidentes) combinando:

- **6–8 arquétipos** de causa-raiz bancária (em `data/archetypes.py`): timeout
  no Pix, exaustão de pool no internet banking, falha de login no app após
  deploy, erro na geração de boleto, recusa de cartão, divergência de saldo,
  fila de mensageria travada e indisponibilidade de Open Finance. Cada arquétipo
  tem tema, categoria, serviço afetado e uma **resolução canônica**.
- Para cada arquétipo, o LLM gera **40–60 variações** parafraseadas (descrições
  variadas + `resolution_notes` para os resolvidos → base de conhecimento do
  RAG).
- **~70 incidentes de ruído**, propositalmente avulsos e diversos, para
  exercitar o tratamento de ruído do HDBSCAN e o caminho `IMPROCEDENTE`.
- **3 incidentes-demo plantados** e marcados (`procedente`, `borderline`,
  `improcedente`) que dirigem o demo ao vivo do RAG.

## Realismo

- **Faker (`pt_BR`)** preenche os campos estruturais: números de incidente,
  timestamps enviesados para horário comercial, grupos de atendimento, estados.
- Uma fração (~15%) recebe **bagunça** proposital: typos, descrição truncada,
  time de atendimento errado. É isso que torna o pré-filtro e o pós-filtro
  significativos.

## Determinismo

A camada estrutural usa **seed fixa** (Faker + `random`). A camada de texto vem
do LLM: o dataset é gerado **uma vez** e o `incidents.json` resultante é
**commitado** como fonte da verdade. Regenerar reproduz o _processo_, não o
texto byte a byte. Ver o
[ADR 0006](decisions/0006-execucao-local-e-determinismo.md).

## Pré-computados

Além do dataset, são commitados (ver `backend/data/precomputed/`):

- `embeddings.npz` — embeddings dos incidentes (semeiam o Qdrant sem chamadas de
  API).
- `clusters.json` — resultado do clustering (coordenadas 2D, cluster, rótulo,
  outlier).

## Regenerar

```bash
make generate     # regenera incidents.json (faz chamadas de LLM)
make precompute   # recomputa embeddings + clustering + rótulos
make seed         # carrega o dataset/embeddings no Qdrant
```

> As três etapas precisam das chaves no `.env`. O app já vem com tudo commitado,
> então **não** é preciso rodá-las para usar o demo.
