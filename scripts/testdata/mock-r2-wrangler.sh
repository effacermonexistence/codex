#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--version" ]]; then
  echo "4.127.1"
  exit 0
fi

[[ "${1:-}" == "r2" && "${2:-}" == "object" && "${3:-}" == "get" ]]
task_object="${4#omar-private-archive/}"
task_destination=""
shift 4
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)
      task_destination="$2"
      shift 2
      ;;
    --remote | --profile)
      if [[ "$1" == "--profile" ]]; then shift 2; else shift; fi
      ;;
    *)
      exit 2
      ;;
  esac
done
[[ -n "$task_destination" ]]
if [[ "$task_object" == "os1-exo-monitor/latest.json" ]]; then
  cp "__FIXTURE_ROOT__/os1-exo-monitor-latest.json" "$task_destination"
else
  cp "__FIXTURE_ROOT__/$task_object" "$task_destination"
fi
