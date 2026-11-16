# --- ЭТАП 1: Сборка фронтенда (Vite + React 18 + Three.js) ---
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --legacy-peer-deps

COPY frontend/ ./
RUN npm run build

# --- ЭТАП 2: Финальный контейнер (Python 3.11 + FastAPI + PostgreSQL) ---
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PORT=8080 \
    PGDATA=/data/pgdata \
    PGLOG=/data/postgres.log

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        postgresql \
        postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
# Основной индекс — pypi.org; при его недоступности (сетевые ограничения)
# сборка автоматически падает на проверенное зеркало.
RUN pip install --no-cache-dir --timeout 30 --retries 3 -r requirements.txt \
    || pip install --no-cache-dir --timeout 60 --index-url https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt

COPY app/ ./app/
COPY --from=frontend-builder /frontend/dist ./app/static
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/health',timeout=4).status==200 else 1)"

ENTRYPOINT ["docker-entrypoint.sh"]
