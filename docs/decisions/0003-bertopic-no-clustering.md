# ADR 0003 — BERTopic para detecção de recorrência

- Status: Aceito
- Data: 2026-06-22

## Contexto

Precisamos agrupar incidentes recentes para revelar problemas recorrentes e dar
um **nome legível** a cada grupo, além de coordenadas 2D para visualizar.

## Decisão

Usar **BERTopic**, que encadeia embedding → UMAP → HDBSCAN → representação:

- **UMAP** reduzindo direto para **2D** (métrica **cosseno**, `random_state`
  fixo), pois as coordenadas já saem plotáveis e o BERTopic clusteriza sobre o
  espaço reduzido.
- **HDBSCAN** sobre o 2D, com `min_cluster_size`/`min_samples` ajustados para
  recuperar os arquétipos como grupos legíveis e deixar o ruído como outliers
  (`cluster_id = -1`).
- **Representação OpenAI** do BERTopic para gerar rótulos curtos em português.

Os embeddings são pré-computados (OpenAI `text-embedding-3-large`) e passados ao
BERTopic, então o clustering não recalcula embeddings.

## Consequências

- Rótulos automáticos e legíveis (ex.: "Timeout em pagamentos via Pix").
- Resultado determinístico graças aos seeds fixos.
- BERTopic puxa dependências pesadas — isoladas como extra opcional
  (ver [[0009-deps-clustering-opcionais]]).

## Alternativas consideradas

- KMeans: exige escolher _k_ e não trata ruído.
- HDBSCAN puro sem BERTopic: faríamos a rotulagem manualmente.

## Por que cosseno e o que é o `-1`

Embeddings codificam significado pela **direção** do vetor; a distância angular
(cosseno) agrupa por semelhança semântica melhor que a euclidiana crua. O
HDBSCAN marca como **ruído** (`-1`) os pontos em regiões de baixa densidade — são
os outliers exibidos em cinza na visualização.
