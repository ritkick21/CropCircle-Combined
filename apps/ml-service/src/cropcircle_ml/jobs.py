"""Leased inference queue; the terminal job record doubles as the prediction log."""

import logging
from threading import Event

from PIL import Image
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from cropcircle_ml.inference import run

log = logging.getLogger(__name__)

CLAIM = """
WITH next AS (
    SELECT id FROM intelligence_jobs
    WHERE status = 'QUEUED' OR (status = 'RUNNING' AND lease_until < now() AND attempts < 3)
    ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
)
UPDATE intelligence_jobs j
SET status = 'RUNNING', attempts = attempts + 1, lease_until = now() + interval '2 minutes'
FROM next WHERE j.id = next.id RETURNING j.*
"""

EXHAUSTED = """
UPDATE intelligence_jobs SET status = 'FAILED', error = 'Job interrupted. Run it again.',
  input = '{}'::jsonb, finished_at = now(), lease_until = NULL
WHERE status = 'RUNNING' AND lease_until < now() AND attempts >= 3
"""

FINISH = """
UPDATE intelligence_jobs SET status = %s, output = %s, signals = %s,
  model_version = %s, error = %s, input = '{}'::jsonb, finished_at = now(), lease_until = NULL
WHERE id = %s AND status = 'RUNNING' AND attempts = %s
"""


def process_one(connection, settings):
    job = connection.execute(CLAIM).fetchone()
    if job is None:
        return False
    try:
        result, signals, version = run(connection, settings, job)
        values = ("COMPLETE", Jsonb(result), Jsonb(signals), version, None)
    except psycopg.OperationalError:
        raise
    except Exception as exc:
        log.warning("Inference job %s failed (%s)", job["id"], type(exc).__name__)
        if isinstance(exc, (Image.UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError)) and job[
            "kind"
        ] == "CLASSIFY" and job["input"].get("photo") and not isinstance(exc, FileNotFoundError):
            message = "Use a readable JPEG, PNG or WebP photo under 16 megapixels."
        elif isinstance(exc, FileNotFoundError):
            message = "The model bundle is unavailable."
        else:
            message = "Inference failed. Run it again."
        values = ("FAILED", None, None, None, message)
    connection.execute(FINISH, (*values, job["id"], job["attempts"]))
    return True


def work(settings, stop: Event):
    from time import monotonic

    while not stop.is_set():
        try:
            with psycopg.connect(settings.database_url, autocommit=True, row_factory=dict_row, connect_timeout=3,
                                 options="-c statement_timeout=10000") as connection:
                next_sweep = 0
                while not stop.is_set():
                    if monotonic() >= next_sweep:
                        connection.execute(EXHAUSTED)
                        next_sweep = monotonic() + 15
                    if not process_one(connection, settings):
                        stop.wait(0.6)
        except psycopg.Error as exc:
            log.warning("Inference queue is unavailable (%s)", type(exc).__name__)
            stop.wait(5)
