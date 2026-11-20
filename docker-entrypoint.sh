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

# Однократный перенос данных из встроенного PostgreSQL во внешнюю БД.
# Срабатывает, когда задан WORLD_FIR_DATABASE_URL, в /data лежит старая база,
# а во внешней ещё нет шаров. Старые файлы не удаляются (остаются архивом),
# маркер /data/.migrated_to_external не даёт перенести дважды.
migrate_embedded_to_external() {
    local marker="${MIGRATE_MARKER:-/data/.migrated_to_external}"
    local psql_url="${EXTERNAL_DB_URL/postgresql+asyncpg:\/\//postgresql:\/\/}"
    psql_url="${psql_url/postgres:\/\//postgresql:\/\/}"
    if [ -f "$marker" ] || [ ! -s "$PGDATA/PG_VERSION" ] || [ -z "$PGBIN" ]; then
        return 0
    fi
    local count
    count="$("$PGBIN/psql" "$psql_url" -tAc "select count(*) from gifts" 2>/dev/null || echo "none")"
    if [ "$count" != "none" ] && [ "$count" != "0" ]; then
        echo "[migrate] Во внешней БД уже есть шары ($count) — перенос не нужен."
        date -u +%FT%TZ > "$marker"
        return 0
    fi
    echo "[migrate] Переносим шары из встроенной базы во внешнюю…"
    chown -R postgres:postgres "$PGDATA"
    touch "$PGLOG" && chown postgres:postgres "$PGLOG"
    su postgres -s /bin/sh -c \
        "'$PGBIN/pg_ctl' -D '$PGDATA' -l '$PGLOG' -o \"-p $PGPORT -k /tmp -c listen_addresses=127.0.0.1\" -w -t 60 start" || return 1
    local dump="/data/backups/premigrate_$(date -u +%Y%m%dT%H%M%SZ).sql"
    mkdir -p /data/backups
    local ok=1
    if "$PGBIN/pg_dump" -h 127.0.0.1 -p "$PGPORT" -U "$DB_USER" --no-owner --no-privileges "$DB_NAME" > "$dump"; then
        # ошибки совместимости версий (SET-параметры) не критичны — проверяем результат ниже
        "$PGBIN/psql" "$psql_url" -q -v ON_ERROR_STOP=0 -f "$dump" > /data/migrate.log 2>&1 || true
        local src dst
        src="$("$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U "$DB_USER" "$DB_NAME" -tAc "select count(*) from gifts" 2>/dev/null || echo "?")"
        dst="$("$PGBIN/psql" "$psql_url" -tAc "select count(*) from gifts" 2>/dev/null || echo "!")"
        if [ "$src" = "$dst" ]; then
            echo "[migrate] Готово: перенесено шаров — $dst. Копия: $dump"
            date -u +%FT%TZ > "$marker"
            gzip -f "$dump" || true
        else
            echo "[migrate] ОШИБКА: в старой базе $src шаров, во внешней $dst. Подробности: /data/migrate.log" >&2
            ok=0
        fi
    else
        echo "[migrate] ОШИБКА: не удалось снять дамп со встроенной базы" >&2
        ok=0
    fi
    su postgres -s /bin/sh -c "'$PGBIN/pg_ctl' -D '$PGDATA' -m fast -w stop" >/dev/null 2>&1 || true
    [ "$ok" = "1" ]
}

# Если задана внешняя база — сначала проверяем, что она доступна. Неверный
# адрес или неотвечающий кластер не должны ронять сайт: тогда работаем на
# встроенной базе (шары на месте) и громко пишем об ошибке в лог.
if [ -n "$EXTERNAL_DB_URL" ]; then
    ext_psql_url="${EXTERNAL_DB_URL/postgresql+asyncpg:\/\//postgresql:\/\/}"
    ext_psql_url="${ext_psql_url/postgres:\/\//postgresql:\/\/}"
    ext_host="$(printf '%s' "$ext_psql_url" | sed -E 's#^[a-z+]+://([^@/]*@)?([^:/?]+).*#\2#')"
    if [ -n "$PGBIN" ] && ! PGCONNECT_TIMEOUT=8 "$PGBIN/psql" "$ext_psql_url" -tAc "select 1" >/tmp/ext_check.log 2>&1; then
        echo "[entrypoint] ОШИБКА: внешняя БД недоступна (хост «$ext_host»): $(tail -n 1 /tmp/ext_check.log)" >&2
        echo "[entrypoint] Проверьте WORLD_FIR_DATABASE_URL. Пока работаем на встроенной базе — шары на месте." >&2
        EXTERNAL_DB_URL=""
    fi
fi

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
    echo "[entrypoint] Используется внешняя БД (WORLD_FIR_DATABASE_URL, хост «$ext_host»)."
    migrate_embedded_to_external || echo "[migrate] Перенос не выполнен — приложение стартует с тем, что есть во внешней БД." >&2
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
