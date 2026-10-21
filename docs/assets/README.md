# Assets

Imagens usadas nos READMEs e nos docs.

| Arquivo | O que mostra | Como regerar |
| --- | --- | --- |
| `architecture-pt.svg`, `architecture-en.svg` | diagrama de arquitetura | a partir de `docs/diagrams/arch-*.mmd` com `npx -y @mermaid-js/mermaid-cli -i <mmd> -o <svg> -b white` |
| `incidente-analise.webp` | aba Análise da IA do `INC0052233` | captura do site publicado a 1280x860 |
| `assistente.webp` | painel "Perguntar à IA" com a sugestão e uma pergunta de acompanhamento | idem |
| `mudanca.webp` | avaliação da `CHG0031002` | idem, a 1280x1240 |
| `repeticoes.webp` | tela Repetições | idem |
| `como-funciona.webp` | página Como a IA funciona | idem |

As capturas não disparam chamadas de IA: o navegador (Playwright) intercepta
`POST /api/suggest` e `POST /api/changes/{n}/evaluate` com `page.route` e
devolve uma resposta gravada (a sugestão é uma resposta real da API; a
avaliação é `frontend/tests/evaluation-fixture.json`). Só leituras (`GET`) e a
saudação do assistente, que o servidor responde sem chamar o modelo, chegam à
API. Salve em WebP (qualidade por volta de 80) para manter cada arquivo abaixo
de 100 KB.
