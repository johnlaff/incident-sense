from incident_sense.config import Settings
from incident_sense.guard import UsageGuard


class _Clock:
    def __init__(self) -> None:
        self.now = 1_800_000_000.0

    def __call__(self) -> float:
        return self.now


def _settings(**overrides: int) -> Settings:
    base = {
        "ai_window_seconds": 60,
        "ai_max_per_client": 2,
        "ai_max_per_ip": 3,
        "ai_max_per_day": 5,
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)  # type: ignore[call-arg]


def test_client_limit_then_window_slides() -> None:
    clock = _Clock()
    guard = UsageGuard(clock)
    s = _settings()
    assert guard.check(client_id="a", ip="1", settings=s) is None
    assert guard.check(client_id="a", ip="1", settings=s) is None
    assert guard.check(client_id="a", ip="1", settings=s) is not None
    clock.now += 61
    assert guard.check(client_id="a", ip="1", settings=s) is None


def test_shared_ip_allows_other_clients_until_ip_cap() -> None:
    guard = UsageGuard(_Clock())
    s = _settings()
    assert guard.check(client_id="a", ip="nat", settings=s) is None
    assert guard.check(client_id="b", ip="nat", settings=s) is None
    assert guard.check(client_id="c", ip="nat", settings=s) is None
    assert guard.check(client_id="d", ip="nat", settings=s) is not None


def test_daily_cap_resets_next_day() -> None:
    clock = _Clock()
    guard = UsageGuard(clock)
    s = _settings(ai_max_per_day=2, ai_max_per_client=10, ai_max_per_ip=10)
    assert guard.check(client_id="a", ip="1", settings=s) is None
    assert guard.check(client_id="b", ip="2", settings=s) is None
    refused = guard.check(client_id="c", ip="3", settings=s)
    assert refused is not None and "hoje" in refused
    clock.now += 86_400
    assert guard.check(client_id="c", ip="3", settings=s) is None
