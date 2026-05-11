#!/bin/bash

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <bot-env-file>" >&2
    exit 1
fi

BOT_ENV_FILE="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f "$BOT_ENV_FILE" ]; then
    echo "Bot env file not found: $BOT_ENV_FILE" >&2
    exit 1
fi

set -a
# shellcheck disable=SC1090
source "$BOT_ENV_FILE"
set +a

cd "$SCRIPT_DIR"
exec /usr/bin/env node dist/standalone.js
