# Issue tracker: GitHub

Issues e PRDs deste repositório vivem no GitHub Issues. Use o `gh` CLI para todas as operações.

## Convenções

- Criar: `gh issue create --title "..." --body "..."`
- Ler: `gh issue view <number> --comments`
- Listar: `gh issue list --state open`
- Comentar: `gh issue comment <number> --body "..."`
- Aplicar ou remover labels: `gh issue edit`
- Fechar: `gh issue close <number> --comment "..."`

O repositório é inferido pelo remote do clone.

## Pull requests como superfície de triagem

PRs externos não fazem parte da fila de solicitações. A skill `triage` processa somente issues. PRs continuam disponíveis para revisão pelo fluxo normal do GitHub.

## Publicação no tracker

Quando uma skill mandar publicar um ticket, plano ou PRD, crie uma issue no GitHub.

## Wayfinding operations

O mapa é uma issue com label `wayfinder:map`; seus tickets são sub-issues.

- Ticket: label `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling` ou `wayfinder:task`.
- Sub-issue: usar o endpoint de sub-issues do GitHub. Se indisponível, usar task list no mapa e `Part of #<map>` no ticket.
- Bloqueio: usar dependências nativas do GitHub. Se indisponíveis, registrar `Blocked by: #<n>`.
- Fronteira: sub-issues abertas, sem bloqueadores abertos e sem responsável.
- Claim: atribuir o ticket ao responsável antes de iniciar o trabalho.
- Resolução: comentar a decisão, fechar o ticket e adicionar ao mapa um link com uma síntese de uma linha.
