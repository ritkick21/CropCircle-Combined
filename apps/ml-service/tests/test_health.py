from datetime import datetime

from fastapi.testclient import TestClient

from cropcircle_ml import main
from cropcircle_ml.config import Settings, get_settings


def test_liveness_does_not_require_dependencies() -> None:
    client = TestClient(main.app)
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json()["service"] == "ml-service"
    assert response.json()["status"] == "ok"
    datetime.fromisoformat(response.json()["timestamp"].replace("Z", "+00:00"))


def test_readiness_reports_dependency_failure_without_leaking_address(
    monkeypatch,
) -> None:
    async def probe(_settings: Settings) -> dict[str, dict[str, str]]:
        return {
            "postgresql": {"status": "ok"},
            "postgis": {"status": "ok"},
            "redis": {"status": "unavailable", "detail": "Redis ping failed"},
        }

    monkeypatch.setattr(main, "probe_dependencies", probe)
    main.app.dependency_overrides[get_settings] = lambda: Settings(
        database_url="postgresql://secret@database:5432/cropcircle",
        redis_url="redis://secret@redis:6379/0",
    )
    try:
        client = TestClient(main.app)
        response = client.get("/health/ready")
    finally:
        main.app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json()["dependencies"] == {
        "postgresql": {"status": "ok"},
        "postgis": {"status": "ok"},
        "redis": {"status": "unavailable", "detail": "Redis ping failed"},
    }
    assert "secret" not in response.text
    datetime.fromisoformat(response.json()["timestamp"].replace("Z", "+00:00"))


def test_readiness_succeeds_when_dependencies_are_up(monkeypatch) -> None:
    async def probe(_settings: Settings) -> dict[str, dict[str, str]]:
        return {
            "postgresql": {"status": "ok"},
            "postgis": {"status": "ok"},
            "redis": {"status": "ok"},
        }

    monkeypatch.setattr(main, "probe_dependencies", probe)
    main.app.dependency_overrides[get_settings] = lambda: Settings(
        database_url="postgresql://localhost/cropcircle",
        redis_url="redis://localhost/0",
    )
    try:
        client = TestClient(main.app)
        response = client.get("/health/ready")
    finally:
        main.app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
