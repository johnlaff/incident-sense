"""Banking root-cause archetypes that seed the synthetic dataset.

Each archetype is a recurring real-world failure mode for a retail bank's IT
operations. The generator asks the LLM for many paraphrased incidents per
archetype, so each one becomes a *recoverable cluster* in the recurrence view
and a *known resolution* in the RAG knowledge base.

Everything here is fictional ("Banco Meridiano") and the resolution steps are
illustrative, not operational runbooks for any real institution.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from incident_sense.models import Impact, Priority, Urgency

# --- Fictional service catalog (cmdb_ci) and teams (assignment_group) ---------
# Kept as named constants so archetypes, noise generation and the mis-routing
# "mess" injection all draw from the same vocabulary.
SERVICES = (
    "PIX-Core",
    "Internet-Banking-Web",
    "App-Mobile",
    "Boleto-Service",
    "Cartoes-Autorizador",
    "Extrato-Service",
    "Mensageria-Kafka",
    "OpenFinance-Gateway",
    "Login-IDP",
    "Notificacoes-Push",
)

ASSIGNMENT_GROUPS = (
    "Sustentacao-Pagamentos",
    "Sustentacao-Canais-Digitais",
    "Sustentacao-Cartoes",
    "Sustentacao-Contas",
    "Infra-Mensageria",
    "Integracoes-OpenFinance",
    "Service-Desk-N1",
)

# ServiceNow-style closure codes (in Portuguese, to match the synthetic data).
CLOSE_CODES = (
    "Resolvido (Causa Raiz)",
    "Resolvido (Contorno)",
    "Resolvido (Permanente)",
)


@dataclass(frozen=True)
class Archetype:
    """A recurring root cause and everything needed to synthesize incidents.

    Attributes:
        id: stable slug used in tags and as the cluster ground-truth.
        title: short human title for docs/labels.
        theme: rich PT-BR description of the failure, fed to the LLM prompt.
        canonical_resolution: the "known good" fix; resolution_notes are
            paraphrases of this.
        symptom_hints: a few concrete symptoms to steer paraphrase variety.
        category/subcategory/cmdb_ci/assignment_group: structural defaults.
        typical_*: default priority/impact/urgency (varied per incident).
        close_code: default closure code for resolved incidents.
        tags: base labels every incident in this archetype carries.
        n_variations: how many incidents to generate for this archetype.
    """

    id: str
    title: str
    theme: str
    canonical_resolution: str
    symptom_hints: tuple[str, ...]
    category: str
    subcategory: str
    cmdb_ci: str
    assignment_group: str
    typical_priority: Priority
    typical_impact: Impact
    typical_urgency: Urgency
    close_code: str
    tags: tuple[str, ...] = field(default_factory=tuple)
    n_variations: int = 50


ARCHETYPES: tuple[Archetype, ...] = (
    Archetype(
        id="pix-timeout",
        title="Timeout no Pix",
        theme=(
            "Pagamentos via Pix falhando por timeout na confirmação. Clientes "
            "iniciam a transferência, a tela fica girando e retorna erro de "
            "tempo esgotado; em parte dos casos o débito ocorre mas o "
            "comprovante não é gerado. Picos de latência no PIX-Core e no "
            "Dict do Banco Central durante horários de maior volume."
        ),
        canonical_resolution=(
            "Identificada saturação do pool de threads do PIX-Core e lentidão "
            "nas chamadas ao DICT. Aplicado aumento temporário de workers, "
            "ajuste do timeout do cliente HTTP para o DICT e reprocessamento "
            "das transações pendentes pela rotina de conciliação. Monitoração "
            "de latência reforçada."
        ),
        symptom_hints=(
            "tela girando ao confirmar Pix",
            "erro de tempo esgotado",
            "débito sem comprovante",
            "Pix pendente por horas",
        ),
        category="Pagamentos",
        subcategory="Pix",
        cmdb_ci="PIX-Core",
        assignment_group="Sustentacao-Pagamentos",
        typical_priority=Priority.HIGH,
        typical_impact=Impact.HIGH,
        typical_urgency=Urgency.HIGH,
        close_code="Resolvido (Causa Raiz)",
        tags=("pix", "pagamentos", "timeout"),
        n_variations=52,
    ),
    Archetype(
        id="ib-pool-exhaustion",
        title="Lentidão no Internet Banking por exaustão de pool",
        theme=(
            "Internet Banking web extremamente lento ou indisponível devido à "
            "exaustão do pool de conexões com o banco de dados. Páginas de "
            "saldo e extrato demoram a carregar ou retornam erro 500. Conexões "
            "ficam presas e não são devolvidas ao pool sob carga."
        ),
        canonical_resolution=(
            "Detectado vazamento de conexões em uma rotina de consulta que não "
            "liberava o recurso em caso de exceção. Aplicado hotfix fechando a "
            "conexão no bloco finally, aumento temporário do tamanho do pool e "
            "reinício rotativo das instâncias. Acompanhamento do número de "
            "conexões ativas após o deploy."
        ),
        symptom_hints=(
            "internet banking lento",
            "erro 500 ao abrir extrato",
            "timeout de banco de dados",
            "site do banco fora do ar",
        ),
        category="Canais Digitais",
        subcategory="Internet Banking",
        cmdb_ci="Internet-Banking-Web",
        assignment_group="Sustentacao-Canais-Digitais",
        typical_priority=Priority.HIGH,
        typical_impact=Impact.HIGH,
        typical_urgency=Urgency.MEDIUM,
        close_code="Resolvido (Causa Raiz)",
        tags=("internet-banking", "performance", "banco-de-dados"),
        n_variations=48,
    ),
    Archetype(
        id="app-login-deploy",
        title="Falha de login no app após deploy",
        theme=(
            "Após um deploy do aplicativo mobile, clientes não conseguem fazer "
            "login: a autenticação retorna erro genérico ou token inválido. "
            "Afeta principalmente usuários que já tinham sessão ativa. Causa "
            "ligada a incompatibilidade na validação de token entre o app e o "
            "serviço de identidade."
        ),
        canonical_resolution=(
            "Deploy introduziu mudança no formato do token JWT incompatível "
            "com versões anteriores do app. Executado rollback do serviço de "
            "identidade para a versão anterior e publicada correção com "
            "compatibilidade retroativa na validação. Sessões inválidas foram "
            "expiradas de forma controlada."
        ),
        symptom_hints=(
            "não consigo entrar no app",
            "erro ao logar depois da atualização",
            "token inválido no aplicativo",
            "app pede login e não entra",
        ),
        category="Canais Digitais",
        subcategory="App Mobile",
        cmdb_ci="App-Mobile",
        assignment_group="Sustentacao-Canais-Digitais",
        typical_priority=Priority.CRITICAL,
        typical_impact=Impact.HIGH,
        typical_urgency=Urgency.HIGH,
        close_code="Resolvido (Contorno)",
        tags=("app-mobile", "login", "deploy"),
        n_variations=46,
    ),
    Archetype(
        id="boleto-generation",
        title="Erro na geração de boleto",
        theme=(
            "Falha ao gerar boletos: o cliente solicita a segunda via ou um "
            "novo boleto e recebe erro, ou o PDF sai sem a linha digitável / "
            "código de barras. Relacionado a uma indisponibilidade do serviço "
            "de registro de boletos junto ao banco liquidante."
        ),
        canonical_resolution=(
            "Serviço de registro de boletos retornava erro intermitente por "
            "instabilidade no provedor de liquidação. Habilitada fila de "
            "reprocessamento com retentativa e geração assíncrona; boletos "
            "afetados foram reemitidos. Adicionado alerta para a taxa de erro "
            "do registro."
        ),
        symptom_hints=(
            "não consigo gerar boleto",
            "boleto sem código de barras",
            "erro na segunda via do boleto",
            "linha digitável não aparece",
        ),
        category="Pagamentos",
        subcategory="Boleto",
        cmdb_ci="Boleto-Service",
        assignment_group="Sustentacao-Pagamentos",
        typical_priority=Priority.MODERATE,
        typical_impact=Impact.MEDIUM,
        typical_urgency=Urgency.MEDIUM,
        close_code="Resolvido (Contorno)",
        tags=("boleto", "pagamentos"),
        n_variations=44,
    ),
    Archetype(
        id="card-decline",
        title="Recusa de transação de cartão",
        theme=(
            "Transações de cartão sendo recusadas indevidamente no autorizador, "
            "mesmo com limite e saldo disponíveis. Concentração de recusas com "
            "um código específico do antifraude após mudança de regra. Afeta "
            "compras presenciais e online."
        ),
        canonical_resolution=(
            "Nova regra do motor antifraude estava classificando transações "
            "legítimas como suspeitas. Regra ajustada e recalibrada, com "
            "reprocessamento das métricas. Clientes orientados a tentar "
            "novamente; falsos positivos caíram ao patamar normal."
        ),
        symptom_hints=(
            "cartão recusado sem motivo",
            "compra negada com saldo",
            "transação não autorizada",
            "antifraude bloqueando compra",
        ),
        category="Cartões",
        subcategory="Autorização",
        cmdb_ci="Cartoes-Autorizador",
        assignment_group="Sustentacao-Cartoes",
        typical_priority=Priority.HIGH,
        typical_impact=Impact.HIGH,
        typical_urgency=Urgency.HIGH,
        close_code="Resolvido (Causa Raiz)",
        tags=("cartoes", "autorizacao", "antifraude"),
        n_variations=46,
    ),
    Archetype(
        id="balance-divergence",
        title="Divergência de saldo no extrato",
        theme=(
            "Clientes relatam divergência entre o saldo exibido e o extrato: "
            "lançamentos duplicados ou ausentes, saldo que não bate com a soma "
            "das movimentações. Ligado a atraso/duplicidade no processamento "
            "de eventos de movimentação."
        ),
        canonical_resolution=(
            "Reprocessamento duplicado de um lote de eventos gerou lançamentos "
            "em duplicidade no Extrato-Service. Executada rotina de "
            "deduplicação idempotente e recomposição do saldo a partir do "
            "razão. Implementada chave de idempotência no consumidor de "
            "eventos para evitar recorrência."
        ),
        symptom_hints=(
            "saldo não bate com extrato",
            "lançamento duplicado no extrato",
            "extrato com valor errado",
            "movimentação sumiu do extrato",
        ),
        category="Contas",
        subcategory="Extrato",
        cmdb_ci="Extrato-Service",
        assignment_group="Sustentacao-Contas",
        typical_priority=Priority.HIGH,
        typical_impact=Impact.MEDIUM,
        typical_urgency=Urgency.MEDIUM,
        close_code="Resolvido (Causa Raiz)",
        tags=("extrato", "contas", "conciliacao"),
        n_variations=42,
    ),
    Archetype(
        id="messaging-queue-stuck",
        title="Fila de mensageria travada",
        theme=(
            "Acúmulo de mensagens em uma fila/tópico do Kafka: o consumidor "
            "parou de processar e o lag cresce sem parar. Efeitos em cascata "
            "(notificações atrasadas, eventos de conta não processados). "
            "Relacionado a um consumidor travado em mensagem malformada."
        ),
        canonical_resolution=(
            "Consumidor entrou em laço de reprocessamento por uma mensagem "
            "malformada (poison message), bloqueando a partição. Mensagem "
            "movida para dead-letter, consumidor reiniciado e lag drenado. "
            "Adicionado tratamento de poison message com DLQ e limite de "
            "retentativas."
        ),
        symptom_hints=(
            "notificações atrasadas",
            "eventos não processados",
            "lag crescente no kafka",
            "fila parada",
        ),
        category="Integração",
        subcategory="Mensageria",
        cmdb_ci="Mensageria-Kafka",
        assignment_group="Infra-Mensageria",
        typical_priority=Priority.MODERATE,
        typical_impact=Impact.MEDIUM,
        typical_urgency=Urgency.MEDIUM,
        close_code="Resolvido (Causa Raiz)",
        tags=("mensageria", "kafka", "integracao"),
        n_variations=40,
    ),
    Archetype(
        id="openfinance-unavailable",
        title="Indisponibilidade de Open Finance",
        theme=(
            "Falhas no compartilhamento de dados via Open Finance: o gateway "
            "retorna erro ao consentir ou ao puxar dados de outra instituição. "
            "Timeouts e erros 503 nas chamadas às APIs reguladas. Afeta a "
            "jornada de consentimento e a agregação de contas."
        ),
        canonical_resolution=(
            "Certificado de comunicação com o diretório do Open Finance estava "
            "próximo da expiração e uma instituição parceira apresentava "
            "instabilidade. Certificado renovado, circuit breaker ajustado e "
            "cache de consentimentos revisado. Disponibilidade normalizada."
        ),
        symptom_hints=(
            "erro ao conectar outro banco",
            "open finance fora do ar",
            "falha no consentimento",
            "não consigo compartilhar dados",
        ),
        category="Open Finance",
        subcategory="Compartilhamento",
        cmdb_ci="OpenFinance-Gateway",
        assignment_group="Integracoes-OpenFinance",
        typical_priority=Priority.MODERATE,
        typical_impact=Impact.MEDIUM,
        typical_urgency=Urgency.LOW,
        close_code="Resolvido (Contorno)",
        tags=("open-finance", "integracao"),
        n_variations=40,
    ),
)


def archetype_by_id(archetype_id: str) -> Archetype:
    """Return the archetype with the given id, or raise KeyError."""
    for archetype in ARCHETYPES:
        if archetype.id == archetype_id:
            return archetype
    raise KeyError(archetype_id)
