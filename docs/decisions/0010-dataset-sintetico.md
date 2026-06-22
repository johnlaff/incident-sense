# ADR 0010 — Dataset sintético: arquétipos + ruído + plantados

- Status: Aceito
- Data: 2026-06-22

## Contexto

Precisamos de dados realistas, porém **clean-room** (banco fictício "Banco
Meridiano", sem nomes reais), que formem grupos recuperáveis para o clustering e
uma base de conhecimento para o RAG.

## Decisão

- **6–8 arquétipos** de causa-raiz bancária em PT-BR (`data/archetypes.py`),
  cada um com tema, categoria, serviço e resolução canônica.
- Para cada arquétipo, o LLM gera **40–60 variações** parafraseadas (com
  `resolution_notes` para os resolvidos → base do RAG).
- **~70 incidentes de ruído** propositalmente diversos e avulsos, para exercitar
  o tratamento de ruído do HDBSCAN e o caminho `IMPROCEDENTE`.
- **Faker (pt_BR)** para campos estruturais; injeção de "bagunça" (typos,
  descrição truncada, time errado) em ~15%.
- **3 incidentes-demo plantados** e claramente marcados: `procedente`,
  `borderline` e `improcedente`.

As **definições de arquétipos ficam no pacote** (`src/incident_sense/data/`),
importáveis pelo app e pelos scripts; os **artefatos** (`incidents.json`,
`precomputed/`) ficam em `backend/data/`.

## Consequências

- Clusters legíveis e uma KB rica para sugestões fundamentadas.
- Dataset auditável e reproduzível (ver [[0006-execucao-local-e-determinismo]]).

## Geração one-shot

O texto é gerado **uma vez** e commitado. Para a geração one-shot dos artefatos
usamos um modelo de chat rápido; o padrão de runtime continua sendo o do
[[0004-openrouter-mais-openai]]. O JSON resultante é neutro quanto a provedor.
