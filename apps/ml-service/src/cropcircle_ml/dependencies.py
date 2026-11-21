"""Independent dependency probes used by the readiness endpoint."""

from collections.abc import Awaitable, Callable
import asyncio

import psycopg
from redis.asyncio import Redis

from cropcircle_ml.config import Settings


def _query(database_url: str, sql: str) -> None:
    with psycopg.connect(database_url, connect_timeout=3, options="-c statement_timeout=3000") as connection:
        connection.execute(sql).fetchone()


async def probe_postgres(database_url: str) -> None:
    await asyncio.to_thread(_query, database_url, "SELECT 1")


async def probe_postgis(database_url: str) -> None:
    await asyncio.to_thread(_query, database_url, "SELECT postgis_version()")


async def probe_redis(redis_url: str) -> None:
    client = Redis.from_url(
        redis_url, socket_connect_timeout=3, socket_timeout=3
    )
    try:
        await client.ping()
    finally:
        await client.aclose()


async def probe_dependency(
    probe: Callable[[str], Awaitable[None]], address: str, failure_detail: str
) -> dict[str, str]:
    try:
        await probe(address)
        return {"status": "ok"}
    except Exception:
        # Health output must not disclose credentials or internal network details.
        return {"status": "unavailable", "detail": failure_detail}


async def probe_dependencies(settings: Settings) -> dict[str, dict[str, str]]:
    database, postgis, redis = await asyncio.gather(
        probe_dependency(
            probe_postgres, settings.database_url, "database query failed"
        ),
        probe_dependency(probe_postgis, settings.database_url, "PostGIS query failed"),
        probe_dependency(probe_redis, settings.redis_url, "Redis ping failed"),
    )
    return {"postgresql": database, "postgis": postgis, "redis": redis}
