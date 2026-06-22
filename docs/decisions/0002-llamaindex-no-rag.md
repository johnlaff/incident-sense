# ADR 0002 — LlamaIndex na orquestração do RAG

- Status: Aceito
- Data: 2026-06-22

## Contexto

O fluxo de sugestão tem etapas bem definidas (resumir → embed → pré-filtro →
buscar → pós-filtro → classificar → sugerir). Queremos abstrações reconhecíveis
e fáceis de explicar, mas sem amarrar o código a um framework difícil de mockar.

## Decisão

Usar o **LlamaIndex** para as primitivas de recuperação onde ele agrega clareza:

- `TextNode` / `NodeWithScore` para representar os candidatos recuperados.
- `BaseNodePostprocessor` para o **pós-filtro por LLM** (descarta falsos
  positivos da busca vetorial).

Os clientes de LLM, embedding e busca são **injetados** via `Protocol` (ver
`rag/clients.py`), de modo que os testes substituem tudo por _fakes_ sem rede.
O LLM do pós-filtro entra por `PrivateAttr`, mantendo o componente mockável.

## Consequências

- Padrão de _node postprocessor_ familiar a quem conhece RAG.
- Testes 100% offline (ver `tests/test_rag.py`).

## Alternativas consideradas

- Construir tudo "na mão" sem LlamaIndex: perderia a abstração reconhecível.
- Usar a stack completa do LlamaIndex (query engines, structured LLM nativo):
  acoplaria demais e dificultaria o mock; ver [[0008-saida-estruturada]].
