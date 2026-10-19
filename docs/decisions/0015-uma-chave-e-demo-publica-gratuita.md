# ADR 0015 — Uma chave OpenRouter e demo pública gratuita

- Status: Aceito
- Data: 2026-10-19
- Substitui: [ADR 0004](0004-openrouter-mais-openai.md)

## Contexto

O incident-sense vira demonstração ao vivo em palestras: a plateia abre o site
no celular e dispara análises reais. Isso exige uma publicação sem custo fixo,
fácil de repetir por quem fizer fork, e com o custo das chamadas de IA limitado.
Os ADRs 0004 e 0006 assumiam execução local com duas chaves (OpenAI para
embeddings, OpenRouter para chat) e um servidor Qdrant.

## Decisão

- **Uma chave só.** Embeddings também passam pela OpenRouter, que serve
  `openai/text-embedding-3-large` (os mesmos 3072 dimensões dos vetores
  commitados). `OPENROUTER_API_KEY` passa a ser a única credencial.
- **Qdrant em memória** quando `QDRANT_URL=:memory:`: o modo local do
  qdrant-client roda dentro da API e é semeado no startup a partir dos vetores
  commitados. O Docker Compose continua com o servidor Qdrant.
- **Hospedagem gratuita:** API no Render (Blueprint em `render.yaml`) e site no
  Netlify (`netlify.toml`).
- **Guarda de uso** antes de qualquer chamada de modelo: janela por cliente
  (id aleatório do navegador), janela por IP mais folgada, porque uma plateia
  inteira divide o mesmo NAT, e teto diário global.
- **Modelos:** padrão `anthropic/claude-haiku-5.5`; selecionáveis
  `openai/gpt-6-luna`, `google/gemini-3.8-flash`,
  `deepseek/deepseek-v4.1-flash` e `qwen/qwen3.7-flash`, conferidos na lista
  pública da OpenRouter em 19/10/2026. O `openrouter/auto` saiu da lista por ter
  custo imprevisível numa demo aberta.

## Consequências

- Quem faz fork publica com um clique e uma chave.
- A instância gratuita do Render dorme após 15 minutos sem tráfego e leva cerca
  de um minuto para acordar; o roteiro da demo inclui abrir o site antes.
- O estado da guarda de uso e do Qdrant em memória se perde a cada reinício, o
  que é aceitável para uma instância única de demonstração.
