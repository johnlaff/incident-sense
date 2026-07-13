# Documentação de domínio

O `incident-sense` possui um único contexto de domínio.

## Antes de explorar

Leia, quando existirem e forem relevantes:

- `CONTEXT.md`, com o vocabulário canônico do domínio;
- os ADRs relacionados em `docs/decisions/`.

A ausência de `CONTEXT.md` não é um problema: a skill `domain-modeling` o cria somente quando um termo é efetivamente resolvido.

## Uso do vocabulário

Issues, especificações, testes e documentação devem usar os termos definidos em `CONTEXT.md`. Sinônimos rejeitados pelo glossário não devem reaparecer silenciosamente.

## Conflitos com ADRs

Quando uma proposta contradisser uma decisão existente em `docs/decisions/`, o conflito deve ser explicitado e justificado, em vez de sobrescrever a decisão silenciosamente.
