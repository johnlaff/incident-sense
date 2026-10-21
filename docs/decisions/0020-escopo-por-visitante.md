# ADR 0020: Trava de conteúdo e notas de trabalho por visitante

- Status: Aceito
- Data: 2026-10-21

## Contexto

Numa apresentação ao vivo, a plateia inteira usa a mesma instância da API. A trava de
conteúdo das Mudanças e as notas de trabalho publicadas pela IA eram globais:
um aluno abria um incidente e via as notas que a sala toda publicou, e a
primeira avaliação de uma Mudança chegava como "reaproveitada" da leitura de
outra pessoa. A cota de uso já identificava o visitante por um id do
navegador.

## Decisão

- O site gera um id aleatório por navegador (`localStorage`) e o envia no
  cabeçalho `X-Client-Id` em todas as chamadas.
- `client_key()` em `backend/src/incident_sense/guard.py` usa os primeiros 64
  caracteres desse id ou, sem ele, o IP. A **cota**, a **trava de conteúdo**
  das Mudanças e as **notas de trabalho** usam a mesma chave, para que as três
  nunca discordem sobre quem é o visitante.
- A chave da trava passa a ser `(visitante, versão da grade, modelo, Change,
  campo, hash do texto)`; as notas ficam em `(visitante, incidente)`.
- `fresh: true` na avaliação ("Avaliar de novo, sem reaproveitar") ignora a
  trava e grava a leitura nova, para que um teste antes da apresentação não congele a demo ao vivo.
- Os dois armazenamentos continuam em memória, com teto de 5000 chaves (a mais
  antiga sai primeiro) e no máximo 10 notas por incidente.

## Consequências

- Cada visitante vê um incidente limpo e só o que as próprias análises
  publicaram; o mesmo visitante reavaliando mantém a trava.
- Sem cabeçalho, quem divide o mesmo IP divide a trava e as notas; o site
  sempre envia o cabeçalho.
- O id não é segredo nem autenticação: serve para separar visitantes de uma
  demo, não para proteger dados (todos os dados são sintéticos).
