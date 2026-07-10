#!/usr/bin/env bash

set -uo pipefail

readonly project_id="gioia-beauty-local"
readonly database_container="supabase_db_${project_id}"
readonly events_file="$(mktemp)"
readonly database_log_file="$(mktemp)"

docker events \
  --filter type=container \
  --filter event=die \
  --filter event=oom \
  --format '{{.Time}} status={{.Status}} container={{.Actor.Attributes.name}} exit={{.Actor.Attributes.exitCode}} image={{.From}}' \
  >"${events_file}" 2>&1 &
events_pid=$!

capture_database_log() {
  for _ in $(seq 1 240); do
    if docker inspect "${database_container}" >/dev/null 2>&1; then
      docker logs --follow "${database_container}" \
        >"${database_log_file}" 2>&1 || true
      return
    fi
    sleep 0.25
  done
}

capture_database_log &
database_log_pid=$!

stop_monitors() {
  kill "${events_pid}" 2>/dev/null || true
  kill "${database_log_pid}" 2>/dev/null || true
  wait "${events_pid}" 2>/dev/null || true
  wait "${database_log_pid}" 2>/dev/null || true
}

trap stop_monitors EXIT

SUPABASE_TELEMETRY_DISABLED=1 supabase start \
  --exclude edge-runtime,imgproxy,logflare,realtime,storage-api,vector
start_status=$?

if (( start_status == 0 )); then
  exit 0
fi

stop_monitors
trap - EXIT

echo '::group::Local database container diagnostics'
sed -n '1,200p' "${events_file}"
echo '--- postgres log tail ---'
tail -n 240 "${database_log_file}"

if docker inspect "${database_container}" >/dev/null 2>&1; then
  docker inspect \
    --format 'status={{.State.Status}} exit_code={{.State.ExitCode}} oom_killed={{.State.OOMKilled}} error={{json .State.Error}}' \
    "${database_container}"
else
  echo 'database container was removed after the failure; lifecycle events are the remaining evidence'
fi

echo '::endgroup::'
exit "${start_status}"
