#!/bin/bash

# OpenCode Telegram Plugin - Start Script
# Supports both Host and Docker deployment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-host}"

show_help() {
    echo "Usage: $0 [host|docker|stop|logs]"
    echo ""
    echo "Commands:"
    echo "  host    - Start in host mode (requires opencode serve running)"
    echo "  docker  - Start with Docker Compose"
    echo "  stop    - Stop Docker containers"
    echo "  logs    - View Docker logs"
    echo "  build   - Build Docker image"
    echo ""
    echo "Environment variables (for host mode):"
    echo "  TELEGRAM_BOT_TOKEN      - Required"
    echo "  OPENCODE_SERVER_URL     - Default: http://localhost:4096"
    echo "  OPENCODE_PASSWORD       - Required"
    echo ""
    echo "Environment variables (for docker mode):"
    echo "  WORKSPACE_PATH          - Path to your project (required)"
    echo "  CONFIG_PATH             - OpenCode config path (optional)"
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

start_docker() {
    echo "🐳 Starting with Docker Compose..."
    echo ""

    cd "$SCRIPT_DIR"

    # Check .env file
    if [ ! -f ".env" ]; then
        echo "⚠️  .env file not found"
        echo "   Creating from .env.example..."
        cp .env.example .env
        echo "   Please edit .env with your configuration"
        exit 1
    fi

    # Load .env
    export $(grep -v '^#' .env | xargs)

    if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
        echo "❌ Error: TELEGRAM_BOT_TOKEN not set in .env"
        exit 1
    fi

    if [ -z "$WORKSPACE_PATH" ]; then
        echo "⚠️  WORKSPACE_PATH not set, using ./workspace"
        export WORKSPACE_PATH="./workspace"
        mkdir -p "$WORKSPACE_PATH"
    fi

    # Convert to absolute path
    if [[ ! "$WORKSPACE_PATH" = /* ]]; then
        export WORKSPACE_PATH="$SCRIPT_DIR/$WORKSPACE_PATH"
    fi

    echo "📁 Workspace: $WORKSPACE_PATH"
    echo "🔧 Starting services..."
    echo ""

    docker-compose up -d

    echo ""
    echo "✅ Services started!"
    echo ""
    echo "View logs: $0 logs"
    echo "Stop: $0 stop"
}

stop_docker() {
    echo "🛑 Stopping Docker services..."
    cd "$SCRIPT_DIR"
    docker-compose down
    echo "✅ Stopped"
}

view_logs() {
    cd "$SCRIPT_DIR"
    docker-compose logs -f
}

build_docker() {
    echo "🔨 Building Docker image..."
    cd "$SCRIPT_DIR"
    docker-compose build
    echo "✅ Build complete"
}

case "$MODE" in
    host)
        start_host
        ;;
    docker)
        start_docker
        ;;
    stop)
        stop_docker
        ;;
    logs)
        view_logs
        ;;
    build)
        build_docker
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
