#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA_DIR="${CARDTAPE_PGDATA:-${PROJECT_DIR}/.cardtape/postgres}"
PGPORT_VALUE="${CARDTAPE_PGPORT:-54329}"
PGUSER_VALUE="${CARDTAPE_PGUSER:-cardtape}"
PGDATABASE_VALUE="${CARDTAPE_PGDATABASE:-cardtape}"
PGHOST_VALUE="127.0.0.1"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

start_database() {
  require_command initdb
  require_command pg_ctl
  require_command psql
  require_command createdb

  mkdir -p "$(dirname "${PGDATA_DIR}")"
  if [[ ! -f "${PGDATA_DIR}/PG_VERSION" ]]; then
    initdb -D "${PGDATA_DIR}" --username="${PGUSER_VALUE}" --auth-local=trust --auth-host=trust >/dev/null
  fi

  if ! pg_ctl -D "${PGDATA_DIR}" status >/dev/null 2>&1; then
    pg_ctl -D "${PGDATA_DIR}" -l "${PGDATA_DIR}/server.log" -o "-p ${PGPORT_VALUE} -h ${PGHOST_VALUE}" start >/dev/null
  fi

  if [[ "$(psql -h "${PGHOST_VALUE}" -p "${PGPORT_VALUE}" -U "${PGUSER_VALUE}" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${PGDATABASE_VALUE}'")" != "1" ]]; then
    createdb -h "${PGHOST_VALUE}" -p "${PGPORT_VALUE}" -U "${PGUSER_VALUE}" "${PGDATABASE_VALUE}"
  fi

  echo "Postgres is ready: postgresql://${PGUSER_VALUE}@${PGHOST_VALUE}:${PGPORT_VALUE}/${PGDATABASE_VALUE}"
}

stop_database() {
  require_command pg_ctl
  if [[ -f "${PGDATA_DIR}/PG_VERSION" ]] && pg_ctl -D "${PGDATA_DIR}" status >/dev/null 2>&1; then
    pg_ctl -D "${PGDATA_DIR}" stop -m fast >/dev/null
  fi
  echo "CARDTAPE Postgres stopped."
}

status_database() {
  require_command pg_ctl
  if [[ -f "${PGDATA_DIR}/PG_VERSION" ]] && pg_ctl -D "${PGDATA_DIR}" status; then
    exit 0
  fi
  echo "CARDTAPE Postgres is not running."
  exit 1
}

case "${1:-start}" in
  start) start_database ;;
  stop) stop_database ;;
  status) status_database ;;
  *) echo "Usage: $0 {start|stop|status}" >&2; exit 2 ;;
esac
