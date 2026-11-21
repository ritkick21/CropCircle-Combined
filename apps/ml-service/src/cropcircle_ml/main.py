"""Private FastAPI application and operational health endpoints."""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from secrets import compare_digest
from threading import Event, Thread

from fastapi import Depends, FastAPI, Header, HTTPException, Response, status
import psycopg
from psycopg.rows import dict_row

from cropcircle_ml.config import Settings, get_settings
from cropcircle_ml.dependencies import probe_dependencies
from cropcircle_ml.inference import models
from cropcircle_ml.jobs import work
from cropcircle_ml.monitor import drift_report


@asynccontextmanager
async def lifespan(_app):
    settings = get_settings()
    stop = Event()
    worker = Thread(target=work, args=(settings, stop), daemon=True)
    if settings.ml_worker_enabled:
        worker.start()
    try:
        yield
    finally:
        stop.set()

app = FastAPI(
    title="CropCircle AI service",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


def internal(
    settings: Settings = Depends(get_settings), x_cropcircle_ml_key: str = Header(default=""),
) -> Settings:
    if settings.ml_service_key and not compare_digest(
        x_cropcircle_ml_key.encode(), settings.ml_service_key.encode(),
    ):
        raise HTTPException(403, "Private service")
    return settings


def bundle(settings):
    try:
        return models(settings.ml_model_dir)
    except FileNotFoundError:
        raise HTTPException(503, "Train or mount a model bundle") from None


@app.get("/v1/models")
def model_inventory(settings: Settings = Depends(internal)):
    return bundle(settings)["manifest"]


@app.get("/v1/drift")
def drift(settings: Settings = Depends(internal)):
    with psycopg.connect(settings.database_url, row_factory=dict_row, connect_timeout=3,
                         options="-c statement_timeout=3000") as connection:
        return drift_report(connection, bundle(settings))


@app.get("/health/live")
def live() -> dict[str, str]:
    return {
        "service": "ml-service",
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


@app.get("/health/ready")
@app.get("/health")
async def ready(
    response: Response, settings: Settings = Depends(get_settings)
) -> dict[str, str | dict[str, dict[str, str]]]:
    dependencies = await probe_dependencies(settings)
    healthy = all(value["status"] == "ok" for value in dependencies.values())
    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "service": "ml-service",
        "status": "ok" if healthy else "unavailable",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "dependencies": dependencies,
    }
