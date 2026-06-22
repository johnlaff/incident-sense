# Política de Segurança

## Sobre este projeto

O `incident-sense` é um **demo educacional**. Todos os dados são **sintéticos** e
o banco ("Banco Meridiano") é **fictício** — não há dados reais, pessoais ou
sensíveis no repositório.

As únicas informações sensíveis são as **chaves de API** que você fornece
localmente. Elas ficam apenas no `.env` (gitignored) e **nunca** devem ser
commitadas. O repositório versiona somente o `.env.example`, com placeholders.

## Reportando uma vulnerabilidade

Se encontrar um problema de segurança (por exemplo, vazamento acidental de
segredos, dependência vulnerável ou falha no fluxo de dados):

- Prefira o **GitHub Security Advisory** privado do repositório
  (_Security_ → _Report a vulnerability_), **ou**
- envie um e-mail para **joaoaraxaiba@gmail.com**.

Por favor, **não** abra uma issue pública para vulnerabilidades. Faremos o
possível para responder rapidamente e creditar quem reportar, se desejado.

## Boas práticas ao usar

- Nunca commite o `.env` real nem cole chaves em issues/PRs.
- Rotacione qualquer chave que tenha sido exposta acidentalmente.
- As chamadas externas se limitam às APIs de LLM/embedding configuradas.
