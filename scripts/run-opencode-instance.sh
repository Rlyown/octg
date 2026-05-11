#!/bin/bash

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <server-env-file>" >&2
    exit 1
fi

SERVER_ENV_FILE="$1"

if [ ! -f "$SERVER_ENV_FILE" ]; then
    echo "Server env file not found: $SERVER_ENV_FILE" >&2
    exit 1
fi

set -a
# shellcheck disable=SC1090
source "$SERVER_ENV_FILE"
set +a

if [ "${OPENCODE_MANAGED:-true}" != "true" ]; then
    echo "This instance uses an external OpenCode server; nothing to start locally." >&2
    exit 1
fi

OPENCODE_BIN="${OPENCODE_BIN:-opencode}"

if ! command -v "$OPENCODE_BIN" > /dev/null 2>&1; then
    echo "OpenCode CLI not found in PATH (looked for: $OPENCODE_BIN)" >&2
    exit 1
fi

mkdir -p "${WORKSPACE_PATH}"
export OPENCODE_SERVER_PASSWORD="${OPENCODE_PASSWORD:-}"

ARGS=(serve --port "${OPENCODE_PORT:-4096}" --hostname "${OPENCODE_HOSTNAME:-127.0.0.1}")
if [ -n "${OPENCODE_CORS:-}" ]; then
    ARGS+=(--cors "$OPENCODE_CORS")
fi

cd "$WORKSPACE_PATH"
exec "$OPENCODE_BIN" "${ARGS[@]}"
