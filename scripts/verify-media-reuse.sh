#!/usr/bin/env bash
# Offline codec-only runner. This does NOT certify Task7's full environment.
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-smoke}"
case "$mode" in
  smoke|codec) ;;
  full-environment)
    echo 'NOT IMPLEMENTED: 2 GiB aggregate DB/web/proxy/worker, 30 minute mixed goods/album workload, 2/4 vs 4/4 slots, real serialization, recovery and idle drift assertions require a dedicated integration driver. No containers started.' >&2
    exit 2 ;;
  *) echo 'Usage: bash scripts/verify-media-reuse.sh [smoke|codec|full-environment]' >&2; exit 2 ;;
esac
image="${MORI_VERIFY_TEST_IMAGE:-mori-ai:media-reuse-tests}"
# Require a prebuilt local image. Never build, pull, source .env, or pass credentials.
docker image inspect "$image" >/dev/null
output="$(mktemp -d "${TMPDIR:-/tmp}/mori-reuse-XXXXXXXX")"
container="mori-reuse-$(date +%s)-$$"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
args=(--output /results/report --require-cgroup)
if [[ "$mode" == smoke ]]; then args+=(--smoke); fi
# No project network, ports, databases, or QA volumes. Only this unique container
# is removed; report files are retained. Limits include all codec subprocesses.
docker create --name "$container" --pull never --platform linux/amd64 \
  --network none --memory=1g --memory-swap=1g --cpus=2 --pids-limit=64 \
  --read-only --tmpfs /tmp:rw,nosuid,nodev,size=256m \
  -v "$PWD/backend:/app/backend:ro" -v "$output:/results:rw" -w /app \
  "$image" python -m backend.tests.media.reuse_load_probe "${args[@]}" >/dev/null
# Outer wall-clock bound includes fixture generation and all subprocesses.
docker start "$container" >/dev/null
started=$SECONDS
limit=1800
while [[ "$(docker inspect --format '{{.State.Running}}' "$container")" == true ]]; do
  if (( SECONDS - started >= limit )); then
    docker stop --time 2 "$container" >/dev/null
    echo "Codec probe timed out; partial report retained at $output" >&2
    exit 124
  fi
  sleep 2
done
docker logs "$container"
status="$(docker inspect --format '{{.State.ExitCode}}' "$container")"
oom="$(docker inspect --format '{{.State.OOMKilled}}' "$container")"
echo "Codec-only report: $output/report; full environment NOT IMPLEMENTED"
if [[ "$oom" != false ]]; then echo 'Container OOMKilled' >&2; exit 1; fi
exit "$status"
