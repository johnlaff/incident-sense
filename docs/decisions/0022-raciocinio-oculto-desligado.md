# ADR 0022: Chamadas à IA sem raciocínio oculto e com prazo curto

- Status: Aceito
- Data: 2026-10-21

## Contexto

Com Claude Haiku 5.5 pela OpenRouter, o modelo gastava parte do `max_tokens`
em raciocínio oculto antes de escrever. No ar, a análise de coerência das
Mudanças voltava 502 sem texto, a sugestão do incidente saía vazia ou cortada
no meio da frase, e o pós-filtro caía no fallback de vez em quando. Ao mesmo
tempo, o SDK da OpenAI tem prazo padrão de 600 s e duas novas tentativas: um
provedor lento deixava a tela "Avaliando" girando por minutos diante da
plateia.

## Decisão

- Toda chamada de chat da API (resumo, pós-filtro, classificação,
  sugestão, perguntas de acompanhamento e o juiz de Mudanças) pede
  `reasoning.enabled=false` à OpenRouter (`chat_text(..., reasoning=False)`).
  O orçamento de tokens fica inteiro para a resposta visível.
- Os clientes de chat e de embeddings (`providers.py`) desistem em **20 s**,
  **sem nova tentativa** de rede. O pior caminho da avaliação (campo, reparo de
  formato, coerência, reparo de formato) termina antes dos 90 s em que o site
  desiste.
- Timeout vira 504, falta de cota (402 ou 429 do provedor) vira 503 e outras
  falhas viram 502, sempre com mensagem em português.

## Consequências

- Respostas completas e previsíveis com os modelos do seletor; a calibração das
  Changes passou a fechar (exemplares entre 8,9 e 9,3).
- Perde-se o raciocínio estendido dos modelos que o oferecem; para tarefas
  curtas e com formato fixo isso não fez falta.
- Uma resposta lenta do provedor vira erro claro com "Tente de novo", em vez
  de espera indefinida.
