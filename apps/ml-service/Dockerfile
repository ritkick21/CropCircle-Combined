FROM python:3.12-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=2 \
    ML_SERVICE_HOST=0.0.0.0 \
    ML_SERVICE_PORT=8000

WORKDIR /app

COPY apps/ml-service/pyproject.toml ./
COPY apps/ml-service/src ./src

RUN pip install --no-cache-dir .

FROM base AS trainer
COPY apps/ml-service/data ./data
RUN pip install --no-cache-dir '.[train]' \
    && python -m cropcircle_ml.train --data data --out /opt/cropcircle/models

FROM base
COPY --from=trainer /opt/cropcircle/models /opt/cropcircle/models
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
ENV ML_MODEL_DIR=/opt/cropcircle/models
RUN chmod 0644 /etc/ssl/certs/rds-global-bundle.pem \
    && useradd --create-home --uid 10001 cropcircle

USER cropcircle
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('ML_SERVICE_PORT','8000')+'/health/ready', timeout=4)" || exit 1

CMD ["sh", "-c", "exec uvicorn cropcircle_ml.main:app --host ${ML_SERVICE_HOST} --port ${ML_SERVICE_PORT}"]
