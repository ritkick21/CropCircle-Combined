import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from cropcircle_ml.config import Settings, get_settings
from cropcircle_ml.main import app


def test_production_requires_a_private_service_key():
    with pytest.raises(ValidationError, match="ML_SERVICE_KEY"):
        Settings(_env_file=None, node_env="production", ml_service_key="")


def test_private_model_inventory_requires_the_key(monkeypatch):
    key = "a" * 43
    monkeypatch.setitem(app.dependency_overrides, get_settings, lambda: Settings(
        _env_file=None, node_env="production", ml_service_key=key,
    ))
    monkeypatch.setattr("cropcircle_ml.main.bundle", lambda _: {"manifest": {"version": "fixture"}})
    client = TestClient(app)
    assert client.get("/v1/models").status_code == 403
    assert client.get("/v1/models", headers={"X-CropCircle-ML-Key": "wrong"}).status_code == 403
    assert client.get("/v1/models", headers={"X-CropCircle-ML-Key": key}).json() == {"version": "fixture"}
