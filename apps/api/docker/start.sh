#!/usr/bin/env bash
set -euo pipefail

MIGRATION_MAX_ATTEMPTS="${MIGRATION_MAX_ATTEMPTS:-30}"
MIGRATION_RETRY_DELAY_SECONDS="${MIGRATION_RETRY_DELAY_SECONDS:-2}"
RUN_COMPILE_WORKER="${RUN_COMPILE_WORKER:-true}"
RUN_AUDIT_WORKER="${RUN_AUDIT_WORKER:-true}"
RUN_CONSISTENCY_WORKER="${RUN_CONSISTENCY_WORKER:-false}"

log() {
  printf '[monkeys-memory-api] %s\n' "$*"
}

run_migrations() {
  local attempt=1
  until npm run migration:run:prod; do
    if [ "$attempt" -ge "$MIGRATION_MAX_ATTEMPTS" ]; then
      log "migrations failed after ${attempt} attempt(s)"
      return 1
    fi

    log "migration attempt ${attempt} failed, retrying in ${MIGRATION_RETRY_DELAY_SECONDS}s..."
    attempt=$((attempt + 1))
    sleep "$MIGRATION_RETRY_DELAY_SECONDS"
  done
}

pids=()

start_child() {
  log "starting $1..."
  shift
  "$@" &
  pids+=("$!")
}

shutdown() {
  log 'shutting down child processes...'
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait || true
}

trap 'shutdown; exit 0' SIGINT SIGTERM

log 'running migrations...'
run_migrations
log 'migrations completed'

if [ "$RUN_COMPILE_WORKER" = "true" ]; then
  start_child 'compile worker' npm run worker:compile:prod
fi

if [ "$RUN_AUDIT_WORKER" = "true" ]; then
  start_child 'audit worker' npm run worker:audit:prod
fi

if [ "$RUN_CONSISTENCY_WORKER" = "true" ]; then
  start_child 'consistency worker' npm run worker:consistency:prod
fi

start_child 'api server' npm run start:prod

set +e
wait -n "${pids[@]}"
exit_code=$?
set -e

log "a child process exited with code ${exit_code}"
shutdown
exit "$exit_code"
