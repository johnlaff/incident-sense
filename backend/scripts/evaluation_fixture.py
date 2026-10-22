"""Write the Change evaluation fixture used by the frontend tests and screenshots.

The fixture is a real POST /api/changes/{number}/evaluate response: real Change
data, real rubric, real evaluator (weights, rounding, threshold, semantic gate).
Only the model call is replaced by a stub judge that answers with the readings
below, written by hand for each field of each Change, so no LLM is called.

The readings are not facts about a real bank. They describe what the field text says, and the
grades follow the story the app already tells: CHG0031001 is the well-filled one
(/aula calls it well filled), CHG0031002 passes the fields but fails the semantic
check (reference-run grades from como-funciona, 9,04 with coherence 4) and
CHG0031003 is the vague one that stops at the gate.

Usage:
    AUTO_SEED=false uv run python scripts/evaluation_fixture.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from incident_sense.api.changes import get_judge_factory
from incident_sense.changes.rubric import load_rubric
from incident_sense.main import app

OUT = Path(__file__).resolve().parents[2] / "frontend" / "tests" / "evaluation-fixture.json"

# key: (score, diagnosis, guidance)
READINGS: dict[str, dict[str, tuple[float, str, str]]] = {
    "CHG0031001": {
        "implementation_plan": (
            9.1,
            "Nomeia a executora e o DBA, dá horário a cada passo e tem pontos de decisão "
            "com limites numéricos no canário e em cada expansão.",
            "Diga no passo 4 quem decide parar; hoje isso só aparece no plano de retorno.",
        ),
        "validation_plan": (
            8.6,
            "Tem métricas, limites e critério de retorno em cada etapa, e 4 horas de "
            "observação com quem recebe o alerta dentro e fora da janela.",
            "Diga quem faz a comparação do pico de 31/10 e onde ela fica registrada.",
        ),
        "objective": (
            8.8,
            "Diz o que muda (pool de 40 para 80, timeout de 30s para 5s), em qual serviço "
            "e por quê, com os números do pico de sexta-feira.",
            "Explique também a redução do timeout; o texto justifica só o aumento do pool.",
        ),
        "benefits": (
            8.2,
            "Mede o ganho para o cliente, o negócio e a operação, e liga o ganho ao objetivo.",
            "Separe o que foi medido do que é estimativa: os 11 mil Pix e as 6 horas de "
            "reprocessamento não citam a fonte.",
        ),
        "test_justification": (
            9.0,
            "Três testes com data, relatório e resultado, e explica por que cobrem o risco "
            "de saturar o banco de liquidação.",
            "Diga se o teste de carga usou os mesmos 6 pods de produção, já que a conta "
            "de conexões depende disso.",
        ),
        "short_description": (
            8.4,
            "Diz o serviço, o que muda e os números da mudança.",
            'Inclua o efeito esperado, por exemplo "para reduzir o p99 do Pix nos picos".',
        ),
        "prerequisites": (
            7.5,
            "Capacidade do banco, teste de carga, chart, janela e revisão de retorno têm "
            "ticket ou ata. O backup só é gerado na própria noite da janela.",
            'Diga quem gera o snapshot e o que fazer se ele não estiver "completed" às 23h35.',
        ),
    },
    "CHG0031002": {
        "implementation_plan": (
            9.2,
            "Passos com horário e executor, e dois pontos de decisão com limites: o "
            "registro do Flyway e o job de migração em lotes.",
            "Diga o que acontece com a fila de emissão se o passo 3 passar de 120 minutos "
            "perto do fim da janela.",
        ),
        "validation_plan": (
            9.0,
            "Conta os boletos antes e depois da migração, testa os dois caminhos de "
            "pagamento e define o critério de retorno.",
            "Diga quem acompanha as 2 horas de observação e o ciclo de emissão das 8h de 30/10.",
        ),
        "objective": (
            9.4,
            "Diz o que muda (duas colunas novas e a migração de 1,9 milhão de boletos), "
            "para quem e por quê.",
            "Deixe explícito que a migração altera dados em produção; é isso que o retorno "
            "precisa desfazer.",
        ),
        "benefits": (
            8.6,
            "Ganho para o pagador, o cliente e o banco, com o custo por título e a ressalva "
            "de que a amostra do piloto é pequena.",
            "Diga de onde vem o custo de R$ 0,18 por título.",
        ),
        "test_justification": (
            9.2,
            "Ensaio com o volume integral, pagamentos nos dois caminhos e regressão, cada "
            "teste ligado ao risco.",
            "Inclua um teste do retorno: nenhum ensaio mostra como desfazer a migração.",
        ),
        "short_description": (
            9.0,
            "Diz a versão, as colunas novas e a migração dos boletos em aberto.",
            'Inclua o efeito para o cliente, por exemplo "boleto pago por Pix".',
        ),
        "prerequisites": (
            8.6,
            "Script aprovado, backup com restauração testada, imagem publicada, janela e "
            "comunicação aos clientes.",
            "Diga quem restaura o backup bkp-boleto-titulo se o retorno precisar dele.",
        ),
    },
    "CHG0031003": {
        "implementation_plan": (
            3.0,
            '"Fazer o deploy." não diz o que muda, quem executa, em que ordem nem quando parar.',
            "Liste os passos com horário e executor, e o critério para parar e voltar.",
        ),
        "validation_plan": (
            2.5,
            '"Testes ok." não diz o que medir, com que limite nem por quanto tempo.',
            "Diga qual métrica vai olhar, o limite aceitável e o período de observação.",
        ),
        "objective": (
            4.0,
            '"Ajuste no sistema." não diz o que muda no Internet-Banking-Web nem por quê.',
            "Diga o que muda, onde e qual problema a mudança resolve.",
        ),
        "benefits": (
            3.5,
            '"Melhoria." não diz para quem nem quanto.',
            "Diga quem ganha com a mudança e como o ganho vai ser medido.",
        ),
        "test_justification": (
            2.0,
            '"Ver documentação." não cita nenhum teste nem resultado.',
            "Liste os testes feitos, com data e resultado, e diga por que cobrem o risco.",
        ),
        "short_description": (
            5.0,
            '"Ajuste no sistema" não diz o serviço nem o que muda; numa lista, não dá para '
            "saber qual Change é.",
            "Diga o serviço e o que muda numa frase só.",
        ),
        "prerequisites": (
            2.0,
            '"N/A" sem justificativa; uma mudança em produção precisa ao menos de janela aprovada.',
            "Liste a janela aprovada, as aprovações e o backup, ou explique por que não há.",
        ),
    },
}

SEMANTIC = {
    "CHG0031001": {
        "consistency_score": 8.5,
        "problems": [],
        "reasoning": "O plano de retorno desfaz cada passo da implantação, e as tarefas "
        "cadastradas seguem a mesma ordem.",
        "guidance": "",
        "backout_adherence": "ADERENTE",
        "backout_adherence_percent": 100,
    },
    "CHG0031002": {
        "consistency_score": 4.0,
        "problems": [
            {
                "tipo": "contradicao",
                "campos": ["implementação", "retorno"],
                "descricao": "O plano de retorno não desfaz a alteração da tabela nem a "
                "migração dos dados.",
            }
        ],
        "reasoning": "A implementação muda dados; o retorno só troca a imagem.",
        "guidance": "Inclua a reversão da migração no plano de retorno.",
        "backout_adherence": "PARCIAL",
        "backout_adherence_percent": 66,
    },
}

LABELS = {f.label: f.key for f in load_rubric().fields}


class StubJudge:
    """Answers the evaluator's prompts with the hand-written readings above."""

    def __init__(self, number: str) -> None:
        self.number = number

    def complete(self, system: str, user: str, **_: object) -> str:
        if "TAREFAS CADASTRADAS" in user:
            return json.dumps(SEMANTIC[self.number], ensure_ascii=False)
        match = re.search(r"CAMPO AVALIADO: (.+)", user)
        if match is None:
            raise ValueError("prompt sem CAMPO AVALIADO")
        score, diagnosis, guidance = READINGS[self.number][LABELS[match.group(1).strip()]]
        return json.dumps(
            {"score": score, "diagnosis": diagnosis, "guidance": guidance}, ensure_ascii=False
        )


def main() -> None:
    out: dict[str, object] = {}
    for number in READINGS:
        app.dependency_overrides[get_judge_factory] = lambda n=number: lambda _m: StubJudge(n)
        with TestClient(app) as client:
            response = client.post(f"/api/changes/{number}/evaluate", json={})
        response.raise_for_status()
        out[number] = response.json()
    app.dependency_overrides.clear()
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT
    target.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for number, ev in out.items():
        print(number, ev["overall"])  # type: ignore[index]


if __name__ == "__main__":
    main()
