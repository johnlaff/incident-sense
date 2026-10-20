# Fluxo de detecção de recorrência (clustering)

Este é o caminho **offline e determinístico**: agrupar incidentes recentes para
revelar problemas recorrentes, exibidos como um mapa animado com rótulos gerados
por IA.

O endpoint é `GET /api/clusters`, que serve **verbatim** um resultado
pré-computado e commitado — zero chamadas de API, renderização idêntica sempre.

## A pipeline (BERTopic)

A recomputação (`backend/scripts/precompute.py`) usa o **BERTopic**, que encadeia:

```mermaid
flowchart LR
    E[Embeddings 3072d] --> H[HDBSCAN cosseno]
    H --> R[Rótulos por LLM]
    E --> U[UMAP -> 2D cosseno]
    R --> J[(clusters.json)]
    U --> J
```

1. **Embeddings** dos incidentes (OpenAI, 3072d) — os mesmos commitados que
   semeiam o Qdrant.
2. **HDBSCAN** agrupa os próprios embeddings (normalizados, então a distância
   euclidiana ordena como o cosseno), com `min_cluster_size=8` e
   `min_samples=7`. Pontos em regiões de baixa densidade viram **ruído**
   (`cluster_id = -1`), os _outliers_.
3. **UMAP** reduz para **2D** com métrica **cosseno** e `random_state` fixo, só
   para desenhar o mapa.
4. A **representação OpenAI** do BERTopic gera um **rótulo curto em português**
   para cada cluster (ex.: "Timeout em pagamentos via Pix").

O resultado por incidente: `{ id, x, y, cluster_id, cluster_label, is_outlier,
short_description, priority }`.

## Por que essas escolhas

### Por que cosseno

Como no RAG: embeddings codificam significado pela direção, então a distância
angular agrupa por semelhança semântica melhor que a euclidiana crua.

### O que é o ruído / `-1`

O HDBSCAN não força todo ponto a um cluster. O que não tem vizinhança densa o
suficiente é marcado como **ruído** (`cluster_id = -1`). Na visualização esses
outliers aparecem em **cinza**, de-enfatizados — é o tratamento de ruído
acontecendo à vista.

### Por que não clusterizar em 2D

A primeira versão clusterizava sobre o UMAP 2D. Com `min_dist=0`, o UMAP aperta
incidentes pouco parecidos numa ilha densa, e o HDBSCAN leu os 70 chamados de
ruído (suporte interno: projetor, ramal, ar-condicionado) como um grupo, sem
nenhum caso isolado. Nos embeddings originais esses chamados são esparsos, e o
HDBSCAN deixa a maioria de fora (59 de 70). O UMAP ficou só para o mapa.

## Determinismo

Seeds fixos no UMAP (e HDBSCAN determinístico) tornam o layout reprodutível. Os
rótulos vêm do LLM e são **congelados** no `clusters.json` commitado, então a
visualização não muda entre execuções nem precisa de chave de API.

## Recomputar

```bash
make precompute        # reembed + reclusteriza + rerotula (precisa de chaves)
```

Veja [data-generation.md](data-generation.md) para como o dataset por trás é
gerado.
