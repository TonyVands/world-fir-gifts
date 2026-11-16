#!/bin/bash
# World Fir Gifts: единый контейнер с PostgreSQL (персистентные данные в /data)
# и FastAPI-приложением. Если задан внешний DATABASE_URL — локальный PostgreSQL
# не запускается (гибрид для будущего перехода на управляемую БД Amvera).
set -euo pipefail

PORT="${PORT:-8080}"
PGDATA="${PGDATA:-/data/pgdata}"
PGLOG="${PGLOG:-/data/postgres.log}"
PGPORT="${PGPORT:-5432}"
DB_NAME="${POSTGRES_DB:-world_fir}"
DB_USER="${POSTGRES_USER:-worldfir}"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n 1)"

PG_STARTED="0"
UVICORN_PID=""
BACKUP_PID=""

term_handler() {
    echo "[entrypoint] Получен сигнал остановки, завершаем работу…"
    if [ -n "$BACKUP_PID" ]; then
        kill "$BACKUP_PID" 2>/dev/null || true
    fi
    if [ -n "$UVICORN_PID" ]; then
        kill -TERM "$UVICORN_PID" 2>/dev/null || true
        wait "$UVICORN_PID" 2>/dev/null || true
    fi
    if [ "$PG_STARTED" = "1" ] && [ -n "$PGBIN" ]; then
        su postgres -s /bin/sh -c "'$PGBIN/pg_ctl' -D '$PGDATA' -m fast -w stop" >/dev/null 2>&1 || true
    fi
    exit 0
}
trap term_handler TERM INT

# Внешняя БД включается ТОЛЬКО через WORLD_FIR_DATABASE_URL. Платформенный
# DATABASE_URL (Amvera подставляет его автоматически) может указывать на
# неподключённый сервис — тогда приложение падает на DNS, поэтому здесь
# DATABASE_URL всегда перезаписывается корректным значением.
EXTERNAL_DB_URL="${WORLD_FIR_DATABASE_URL:-}"

if [ -z "$EXTERNAL_DB_URL" ]; then
    if [ -z "$PGBIN" ]; then
        echo "[entrypoint] ОШИБКА: сервер PostgreSQL не найден в образе" >&2
        exit 1
    fi

    mkdir -p "$PGDATA"
    touch "$PGLOG"
    chown -R postgres:postgres "$PGDATA" "$PGLOG"
    chmod 700 "$PGDATA"

    if [ ! -s "$PGDATA/PG_VERSION" ]; then
        echo "[entrypoint] Первый запуск: инициализация PostgreSQL в $PGDATA"
        su postgres -s /bin/sh -c \
            "'$PGBIN/initdb' -D '$PGDATA' -U '$DB_USER' --auth=trust --encoding=UTF8 --locale=C.UTF-8"
    fi

    # Слушаем только loopback (порт наружу не публикуется); маркерная строка
    # удаляется перед добавлением, чтобы конфиг самоизлечивался при обновлениях.
    sed -i '/world-fir-loopback/d' "$PGDATA/postgresql.conf" 2>/dev/null || true
    echo "listen_addresses = '127.0.0.1'  # world-fir-loopback" >> "$PGDATA/postgresql.conf"

    echo "[entrypoint] Запуск PostgreSQL (порт $PGPORT, только loopback)…"
    su postgres -s /bin/sh -c \
        "'$PGBIN/pg_ctl' -D '$PGDATA' -l '$PGLOG' -o \"-p $PGPORT -k /tmp\" -w -t 60 start"
    PG_STARTED="1"

    su postgres -s /bin/sh -c \
        "'$PGBIN/createdb' -h 127.0.0.1 -p $PGPORT -U '$DB_USER' '$DB_NAME'" >/dev/null 2>&1 || true

    export DATABASE_URL="postgresql+asyncpg://${DB_USER}@127.0.0.1:${PGPORT}/${DB_NAME}"
    echo "[entrypoint] Локальный PostgreSQL готов: $DATABASE_URL"

    # Логические бэкапы в /data/backups: при каждом старте и далее каждые
    # BACKUP_INTERVAL_HOURS часов. Храним BACKUP_KEEP последних дампов.
    BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
    BACKUP_KEEP="${BACKUP_KEEP:-14}"
    BACKUP_INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-6}"
    mkdir -p "$BACKUP_DIR"
    chmod 700 "$BACKUP_DIR"
    make_backup() {
        local ts file
        ts="$(date -u +%Y%m%dT%H%M%SZ)"
        file="$BACKUP_DIR/world_fir_${ts}.sql.gz"
        if "$PGBIN/pg_dump" -h 127.0.0.1 -p "$PGPORT" -U "$DB_USER" "$DB_NAME" | gzip > "$file.tmp"; then
            mv "$file.tmp" "$file"
            echo "[backup] Дамп сохранён: $file"
        else
            rm -f "$file.tmp"
            echo "[backup] ОШИБКА создания дампа" >&2
        fi
        ls -1t "$BACKUP_DIR"/world_fir_*.sql.gz 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm -f
    }
    if [ "${BACKUP_ENABLED:-1}" = "1" ]; then
        make_backup || true
        ( while sleep "$((BACKUP_INTERVAL_HOURS * 3600))"; do make_backup || true; done ) &
        BACKUP_PID=$!
    fi
else
    export DATABASE_URL="$EXTERNAL_DB_URL"
    echo "[entrypoint] Используется внешняя БД (WORLD_FIR_DATABASE_URL)."
fi

cd /app
# Строго ОДИН воркер: in-memory кеш витрины, rate limit и WebSocket-рассылка
# живут в памяти процесса (см. DEPLOY.md, раздел «Масштабирование»).
uvicorn app.main:app --host 0.0.0.0 --port "$PORT" \
    --workers 1 \
    --ws-max-size 65536 \
    --timeout-keep-alive 15 \
    --timeout-graceful-shutdown 20 \
    --no-server-header &
UVICORN_PID=$!
wait "$UVICORN_PID"
