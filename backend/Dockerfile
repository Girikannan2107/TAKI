# syntax=docker/dockerfile:1.7
# TAKI API (FastAPI) for Cloud Run, asia-south1. Build context: backend/.
#   docker build -t taki-api backend
#   docker run --rm -p 8080:8080 --env-file backend/.env.local taki-api
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080 \
    WEB_CONCURRENCY=2

WORKDIR /srv

# Dependencies first (cached layer). Every runtime wheel used here ships manylinux builds, so no compiler is needed.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code only (tests, fakes and scripts are excluded by .dockerignore).
COPY app ./app

RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin taki \
    && chown -R taki:taki /srv
USER taki

EXPOSE 8080

# Cloud Run sends SIGTERM and allows 10 s; gunicorn's graceful timeout is kept below that.
# Shell form so ${PORT} / ${WEB_CONCURRENCY} expand; `exec` makes gunicorn PID 1 so it receives the signal.
CMD exec gunicorn app.main:app \
    -k uvicorn_worker.UvicornWorker \
    -w ${WEB_CONCURRENCY:-2} \
    -b 0.0.0.0:${PORT:-8080} \
    --timeout 60 --graceful-timeout 8 --keep-alive 5 \
    --forwarded-allow-ips="*" \
    --access-logfile - --error-logfile -
