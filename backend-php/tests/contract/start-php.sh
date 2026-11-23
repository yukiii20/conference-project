#!/usr/bin/env bash
# Starts the PHP backend on :4200 against the throwaway test database, with the same settings
# the Node reference backend gets in tests (DB credentials come from server/.env, never printed).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
WANT_PORT="${PORT:-4200}"
set -a; . "$HERE/../server/.env"; set +a
export DB_NAME=conference_cms_test NODE_ENV=test STORAGE_DRIVER=local EMAIL_MODE=console
export STORAGE_DIR="$HERE/../server/storage-test-e2e" CLIENT_ORIGIN=http://localhost:5273

cd "$HERE"
exec php -S 127.0.0.1:$WANT_PORT -t public public/index.php
