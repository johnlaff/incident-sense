# Registros de Decisão de Arquitetura (ADRs)

ADRs leves: cada arquivo registra **uma** decisão, com contexto, decisão tomada e
consequências. São propositalmente curtos. Um ADR não é reescrito quando a
decisão muda: um ADR novo o substitui ou complementa, e o antigo ganha uma nota
no status.

- [0001: Arquitetura e stack](0001-arquitetura-e-stack.md)
- [0002: LlamaIndex na orquestração do RAG](0002-llamaindex-no-rag.md)
- [0003: BERTopic para detecção de recorrência](0003-bertopic-no-clustering.md)
- [0004: Divisão OpenRouter (chat) + OpenAI (embeddings)](0004-openrouter-mais-openai.md) (substituído pelo 0015)
- [0005: Qdrant como banco vetorial](0005-qdrant-como-vector-db.md)
- [0006: Execução local e demo determinística](0006-execucao-local-e-determinismo.md)
- [0007: Licença MIT](0007-licenca-mit.md)
- [0008: Saída estruturada via JSON no prompt + pydantic](0008-saida-estruturada.md)
- [0009: Dependências de clustering como extra opcional](0009-deps-clustering-opcionais.md)
- [0010: Dataset sintético: arquétipos + ruído + plantados](0010-dataset-sintetico.md)
- 0011 a 0014: reservados para o copiloto conversacional com streaming
  (arquitetura e contrato SSE, perfil de segurança, contrato de avaliação e
  seleção de modelos), planejados nas issues
  [#43](https://github.com/johnlaff/incident-sense/issues/43) e
  [#58](https://github.com/johnlaff/incident-sense/issues/58). Ainda não
  escritos.
- [0015: Uma chave OpenRouter e demo pública gratuita](0015-uma-chave-e-demo-publica-gratuita.md)
- [0016: Pipeline de incidentes em sete etapas](0016-pipeline-de-incidentes-em-sete-etapas.md)
- [0017: Hospedagem no Render e na Cloudflare Workers, com deploy por GitHub Actions](0017-hospedagem-render-e-cloudflare-com-deploy-por-actions.md)
- [0018: Avaliação de Mudanças por LLM-como-juiz, com grade versionada e trava de conteúdo](0018-avaliacao-de-mudancas-por-llm-juiz.md)
- [0019: O backend é a fonte única do veredito da Mudança](0019-backend-fonte-unica-do-veredito-da-mudanca.md)
- [0020: Trava de conteúdo e notas de trabalho por visitante](0020-escopo-por-visitante.md)
- [0021: Pergunta de acompanhamento fundamentada só nos casos mantidos](0021-pergunta-de-acompanhamento-so-com-casos-mantidos.md)
- [0022: Chamadas à IA sem raciocínio oculto e com prazo curto](0022-raciocinio-oculto-desligado.md)
- [0023: Guarda de uso confiável, limites de tamanho e prompts blindados](0023-guarda-de-uso-confiavel-e-limites-de-tamanho.md)
