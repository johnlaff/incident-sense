# ADR 0006 — Execução local e demo determinística

- Status: Aceito
- Data: 2026-06-22

## Contexto

O demo precisa rodar igual em qualquer máquina, sem depender de chamadas de API
para a parte de visualização, e ser auditável.

## Decisão

O **determinismo vem de gerar uma vez e commitar os artefatos**:

- `backend/data/incidents.json` — dataset sintético (gerado com seed fixa).
- `backend/data/precomputed/embeddings.npz` — embeddings dos incidentes.
- `backend/data/precomputed/clusters.json` — resultado do clustering (coords 2D,
  cluster, rótulo, flag de outlier).

A visualização de clusters é servida **verbatim** desse JSON — zero chamadas de
API e renderização idêntica sempre. Só o caminho interativo "suggest" faz
chamadas ao vivo. Os scripts (`generate_dataset.py`, `precompute.py`) ficam no
repo, com seeds, para reprodutibilidade e auditoria.

## Consequências

- App útil imediatamente após `docker compose up`.
- A camada estrutural (Faker, timestamps) é reprodutível por seed; a camada de
  texto vem do LLM, então a regeneração reproduz o **processo**, não o texto
  byte a byte — o `incidents.json` commitado é a fonte da verdade.

## Alternativas consideradas

- Gerar tudo na subida: tornaria o demo lento, caro e não determinístico.
