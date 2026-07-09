#!/usr/bin/env bash

set -uo pipefail

readonly project_id="gioia-beauty-local"
readonly database_container="supabase_db_${project_id}"
readonly events_file="$(mktemp)"

docker events \
  --filter type=container \
  --filter event=die \
  --filter event=oom \
  --format '{{.Time}} status={{.Status}} container={{.Actor.Attributes.name}} exit={{.Actor.Attributes.exitCode}} image={{.From}}' \
  >"${events_file}" 2>&1 &
events_pid=$!

stop_event_monitor() {
  kill "${events_pid}" 2>/dev/null || true
  wait "${events_pid}" 2>/dev/null || true
}

trap stop_event_monitor EXIT

SUPABASE_TELEMETRY_DISABLED=1 supabase db start
start_status=$?

if (( start_status == 0 )); then
  exit 0
fi

stop_event_monitor
trap - EXIT

echo '::group::Local database container diagnostics'
sed -n '1,200p' "${events_file}"

if docker inspect "${database_container}" >/dev/null 2>&1; then
  docker inspect \
    --format 'status={{.State.Status}} exit_code={{.State.ExitCode}} oom_killed={{.State.OOMKilled}} error={{json .State.Error}}' \
    "${database_container}"
  docker logs --tail 200 "${database_container}" 2>&1
else
  echo 'database container was removed after the failure; lifecycle events are the remaining evidence'
fi

echo '::endgroup::'
exit "${start_status}"
