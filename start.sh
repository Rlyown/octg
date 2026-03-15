#!/bin/bash

# OpenCode Telegram Plugin - Start Script
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-host}"

show_help() {
    echo "Usage: $0 [host]"
    echo ""
    echo "Commands:"
    echo "  host    - Start in host mode (requires opencode serve running)"
    echo ""
    echo "Environment variables:"
    echo "  TELEGRAM_BOT_TOKEN      - Required"
    echo "  OPENCODE_SERVER_URL     - Default: http://localhost:4096"
    echo "  OPENCODE_PASSWORD       - Required"
}

check_env() {
    if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
        echo "❌ Error: TELEGRAM_BOT_TOKEN not set"
        echo "   Get one from @BotFather on Telegram"
        exit 1
    fi

    if [ -z "$OPENCODE_PASSWORD" ]; then
        echo "❌ Error: OPENCODE_PASSWORD not set"
        exit 1
    fi
}

start_host() {
    echo "🚀 Starting Telegram Plugin in HOST mode..."
    echo ""

    check_env

    cd "$SCRIPT_DIR"

    # Check if dist exists
    if [ ! -d "dist" ]; then
        echo "📦 Building..."
        npm run build
    fi

    # Check if opencode is running
    OPENCODE_URL="${OPENCODE_SERVER_URL:-http://localhost:4096}"
    echo "🔍 Checking OpenCode server at $OPENCODE_URL..."

    if ! curl -s -u "opencode:$OPENCODE_PASSWORD" "$OPENCODE_URL/global/health" > /dev/null 2>&1; then
        echo "❌ OpenCode server not available at $OPENCODE_URL"
        echo "   Please start it first:"
        echo "   export OPENCODE_SERVER_PASSWORD=your-password"
        echo "   opencode serve --port 4096"
        exit 1
    fi

    echo "✅ OpenCode server is running"
    echo "✅ Configuration valid"
    echo "🤖 Starting bot..."
    echo ""

    node dist/standalone.js
}

case "$MODE" in
    host)
        start_host
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo "❌ Unknown command: $MODE"
        show_help
        exit 1
        ;;
esac
