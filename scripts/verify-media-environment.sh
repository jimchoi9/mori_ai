#!/usr/bin/env bash
# Local minimum Task7 comparison; never deploys or reads .env/QA resources.
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 backend/tests/media/task7_environment_host.py
