#!/bin/bash
# При старте облачной сессии Claude Code: зависимости, PostgreSQL и MinIO в Docker, миграции, наполнение.
# После этого сразу работают pnpm check, тесты базы и S3, pnpm dev.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"
LOG=/tmp/buhuchet-session-start.log
{
  corepack enable || npm install -g pnpm@10.28.0
  pnpm install --frozen-lockfile
  [ -f .env ] || cp .env.example .env
  if ! docker info >/dev/null 2>&1; then
    (nohup dockerd >/tmp/dockerd.log 2>&1 &)
    for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
  fi
  pnpm setup:local
} >"$LOG" 2>&1 && echo "Окружение готово: зависимости, PostgreSQL и MinIO, миграции и наполнение (журнал: $LOG)." \
  || { echo "Подготовка окружения не удалась, см. $LOG:"; tail -20 "$LOG"; }
exit 0
