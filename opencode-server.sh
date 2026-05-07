#!/bin/bash

# OpenCode Server Control Script
# Usage: ./opencode-server.sh [command]
#
# Commands:
#   start      - Start OpenCode server in background
#   stop       - Stop OpenCode server
#   status     - Check OpenCode server status
#   restart    - Restart OpenCode server
#   logs       - View OpenCode server logs
#   fg         - Start OpenCode server in foreground
#
# Examples:
#   ./opencode-server.sh start    # Start in background
#   ./opencode-server.sh status   # Check status
#   ./opencode-server.sh stop     # Stop server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Default configuration
DEFAULT_PORT=4096
DEFAULT_HOSTNAME="127.0.0.1"
DEFAULT_WORKDIR="${HOME}/GitProject"
DEFAULT_CONFIG_PATH="${HOME}/.config/opencode"
DEFAULT_DATA_PATH="${HOME}/.local/share/opencode"

# Log and PID files
LOG_DIR="${SCRIPT_DIR}/logs"
PID_FILE="${LOG_DIR}/opencode-server.pid"
LOG_FILE="${LOG_DIR}/opencode-server.log"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

print_header() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║        OpenCode Server Control Center                  ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
    echo -e "${CYAN}ℹ${NC} $1"
}

is_macos() {
    [[ "$(uname -s)" == "Darwin" ]]
}

# Load environment variables from .env file
load_env() {
    local env_file="${SCRIPT_DIR}/.env"
    if [ -f "$env_file" ]; then
        set -a
        # shellcheck disable=SC1090
        source "$env_file"
        set +a
    fi
}

# Get configuration values with defaults
get_config() {
    load_env
    OPENCODE_PORT="${OPENCODE_PORT:-$DEFAULT_PORT}"
    OPENCODE_HOSTNAME="${OPENCODE_HOSTNAME:-$DEFAULT_HOSTNAME}"
    OPENCODE_WORKDIR="${WORKSPACE_PATH:-$DEFAULT_WORKDIR}"
    OPENCODE_CONFIG_PATH="${CONFIG_PATH:-$DEFAULT_CONFIG_PATH}"
    OPENCODE_DATA_PATH="${DATA_PATH:-$DEFAULT_DATA_PATH}"
    OPENCODE_PASSWORD="${OPENCODE_PASSWORD:-}"
}

# Check if opencode command is available
check_opencode_cmd() {
    if ! command -v opencode &> /dev/null; then
        print_error "OpenCode CLI not found in PATH"
        print_info "Please install OpenCode first: https://opencode.ai"
        return 1
    fi
    return 0
}

# Check if server is running
check_server() {
    local health_url="http://${OPENCODE_HOSTNAME}:${OPENCODE_PORT}/global/health"
    local curl_args=(--connect-timeout 2 --max-time 5 -sf)

    if [ -n "$OPENCODE_PASSWORD" ]; then
        if curl "${curl_args[@]}" -u "opencode:${OPENCODE_PASSWORD}" "$health_url" > /dev/null 2>&1; then
            return 0
        fi
    else
        if curl "${curl_args[@]}" "$health_url" > /dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

# Get server version
get_server_version() {
    local health_url="http://${OPENCODE_HOSTNAME}:${OPENCODE_PORT}/global/health"
    local health version

    if [ -n "$OPENCODE_PASSWORD" ]; then
        health=$(curl --connect-timeout 2 --max-time 5 -s -u "opencode:${OPENCODE_PASSWORD}" "$health_url" 2>/dev/null)
    else
        health=$(curl --connect-timeout 2 --max-time 5 -s "$health_url" 2>/dev/null)
    fi

    version=$(echo "$health" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
    echo "$version"
}

# Start OpenCode server in background
cmd_start() {
    print_header
    get_config

    if ! check_opencode_cmd; then
        exit 1
    fi

    # Check if already running on the configured port
    if check_server; then
        local version
        version=$(get_server_version)
        print_warning "OpenCode server is already running on port ${OPENCODE_PORT} (v${version})"

        # Check if we have a PID file for it
        if [ -f "$PID_FILE" ]; then
            local existing_pid
            existing_pid=$(cat "$PID_FILE" 2>/dev/null)
            if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
                print_info "PID: $existing_pid"
            else
                print_info "PID: unknown (managed by another process)"
                rm -f "$PID_FILE"
            fi
        else
            print_info "PID: unknown (started by another process)"
        fi

        print_info "URL: http://${OPENCODE_HOSTNAME}:${OPENCODE_PORT}"
        exit 0
    fi

    # Remove stale PID file
    if [ -f "$PID_FILE" ]; then
        rm -f "$PID_FILE"
    fi

    # Ensure working directory exists
    if [ ! -d "$OPENCODE_WORKDIR" ]; then
        print_info "Creating working directory: $OPENCODE_WORKDIR"
        mkdir -p "$OPENCODE_WORKDIR"
    fi

    # Build command arguments
    local cmd_args=(
        "serve"
        "--port" "$OPENCODE_PORT"
        "--hostname" "$OPENCODE_HOSTNAME"
    )

    # Add CORS if specified
    if [ -n "${OPENCODE_CORS:-}" ]; then
        cmd_args+=("--cors" "$OPENCODE_CORS")
    fi

    print_info "Starting OpenCode server..."
    print_info "  Port: $OPENCODE_PORT"
    print_info "  Hostname: $OPENCODE_HOSTNAME"
    print_info "  Working Directory: $OPENCODE_WORKDIR"
    if [ -n "$OPENCODE_PASSWORD" ]; then
        print_info "  Authentication: enabled"
    else
        print_info "  Authentication: disabled"
    fi
    echo ""

    # Set environment variables
    export OPENCODE_SERVER_PASSWORD="$OPENCODE_PASSWORD"

    # Start in background
    (
        cd "$OPENCODE_WORKDIR"
        nohup opencode "${cmd_args[@]}" > "$LOG_FILE" 2>&1 &
        echo $! > "$PID_FILE"
    )

    # Wait for server to start
    print_info "Waiting for server to start..."
    local attempts=0
    local max_attempts=30

    while [ $attempts -lt $max_attempts ]; do
        if check_server; then
            local version
            version=$(get_server_version)
            echo ""
            print_success "OpenCode server started successfully (v${version})"
            print_info "  PID: $(cat "$PID_FILE")"
            print_info "  URL: http://${OPENCODE_HOSTNAME}:${OPENCODE_PORT}"
            print_info "  Logs: tail -f $LOG_FILE"
            echo ""
            print_info "To stop: ./opencode-server.sh stop"
            exit 0
        fi
        sleep 1
        ((attempts++))
    done

    echo ""
    print_error "Failed to start OpenCode server (timeout)"
    print_info "Check logs: tail -f $LOG_FILE"
    rm -f "$PID_FILE"
    exit 1
}

# Start OpenCode server in foreground
cmd_fg() {
    print_header
    get_config

    if ! check_opencode_cmd; then
        exit 1
    fi

    # Check if already running
    if check_server; then
        local version
        version=$(get_server_version)
        print_warning "OpenCode server is already running (v${version})"
        exit 0
    fi

    # Ensure working directory exists
    if [ ! -d "$OPENCODE_WORKDIR" ]; then
        print_info "Creating working directory: $OPENCODE_WORKDIR"
        mkdir -p "$OPENCODE_WORKDIR"
    fi

    # Build command arguments
    local cmd_args=(
        "serve"
        "--port" "$OPENCODE_PORT"
        "--hostname" "$OPENCODE_HOSTNAME"
    )

    if [ -n "${OPENCODE_CORS:-}" ]; then
        cmd_args+=("--cors" "$OPENCODE_CORS")
    fi

    print_info "Starting OpenCode server in foreground..."
    print_info "  Port: $OPENCODE_PORT"
    print_info "  Hostname: $OPENCODE_HOSTNAME"
    print_info "  Working Directory: $OPENCODE_WORKDIR"
    echo ""
    print_info "Press Ctrl+C to stop"
    echo ""

    export OPENCODE_SERVER_PASSWORD="$OPENCODE_PASSWORD"

    cd "$OPENCODE_WORKDIR"
    exec opencode "${cmd_args[@]}"
}

# Stop OpenCode server
cmd_stop() {
    print_header
    get_config

    print_info "Stopping OpenCode server..."
    local stopped=false
    local killed_pids=""

    # Try to stop by PID file
    if [ -f "$PID_FILE" ]; then
        local pid
        pid=$(cat "$PID_FILE" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            sleep 2
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null || true
            fi
            print_success "Stopped OpenCode server (PID: $pid)"
            killed_pids="$pid"
            stopped=true
        fi
        rm -f "$PID_FILE"
    fi

    # Also try to find and stop by process name (matching port and hostname)
    local pids
    pids=$(pgrep -f "opencode serve.*--port ${OPENCODE_PORT}" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        while IFS= read -r pid; do
            if [ -n "$pid" ] && [ "$pid" != "$killed_pids" ]; then
                if kill -0 "$pid" 2>/dev/null; then
                    kill "$pid" 2>/dev/null || true
                    sleep 1
                    if kill -0 "$pid" 2>/dev/null; then
                        kill -9 "$pid" 2>/dev/null || true
                    fi
                    print_success "Stopped OpenCode server process (PID: $pid)"
                    stopped=true
                fi
            fi
        done <<< "$pids"
    fi

    # Wait a moment and verify
    sleep 2
    local still_running=false
    local retry_count=0
    local max_retries=3

    while [ $retry_count -lt $max_retries ]; do
        if check_server; then
            still_running=true
            print_warning "OpenCode server is still running after stop attempt (attempt $((retry_count+1))/$max_retries)"

            # Try more aggressive termination
            local remaining_pids
            remaining_pids=$(pgrep -f "opencode serve.*--port ${OPENCODE_PORT}" 2>/dev/null || true)
            if [ -n "$remaining_pids" ]; then
                while IFS= read -r pid; do
                    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                        print_info "Force killing remaining process (PID: $pid)..."
                        kill -9 "$pid" 2>/dev/null || true
                    fi
                done <<< "$remaining_pids"
            fi

            sleep 2
            ((retry_count++))
        else
            still_running=false
            break
        fi
    done

    if [ "$still_running" = true ]; then
        print_error "OpenCode server is still running after $max_retries stop attempts"
        print_info "You may need to stop it manually:"
        print_info "  1. Find processes: pgrep -f 'opencode serve'"
        print_info "  2. Kill manually: kill -9 <PID>"
        print_info "  3. Or use: killall opencode"
    fi

    if [ "$stopped" = false ]; then
        print_warning "No running OpenCode server found"
    elif [ "$still_running" = false ]; then
        echo ""
        print_success "OpenCode server stopped"
    fi
}

# Check server status
cmd_status() {
    print_header
    get_config

    if ! check_opencode_cmd; then
        exit 1
    fi

    echo -e "${CYAN}Configuration${NC}"
    echo "------------------------------"
    print_info "Port: $OPENCODE_PORT"
    print_info "Hostname: $OPENCODE_HOSTNAME"
    print_info "Working Directory: $OPENCODE_WORKDIR"
    print_info "Config Path: $OPENCODE_CONFIG_PATH"
    print_info "Data Path: $OPENCODE_DATA_PATH"
    echo ""

    echo -e "${CYAN}Server Status${NC}"
    echo "------------------------------"

    if check_server; then
        local version
        version=$(get_server_version)
        print_success "OpenCode server is running (v${version})"

        if [ -f "$PID_FILE" ]; then
            local pid
            pid=$(cat "$PID_FILE" 2>/dev/null)
            if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                print_info "PID: $pid"
            fi
        fi

        print_info "URL: http://${OPENCODE_HOSTNAME}:${OPENCODE_PORT}"
        print_info "Health: http://${OPENCODE_HOSTNAME}:${OPENCODE_PORT}/global/health"

        if [ -f "$LOG_FILE" ]; then
            print_info "Logs: $LOG_FILE"
        fi
    else
        print_warning "OpenCode server is not running"
        if [ -f "$PID_FILE" ]; then
            rm -f "$PID_FILE"
        fi
    fi

    echo ""
    echo -e "${CYAN}Quick Commands${NC}"
    echo "------------------------------"
    echo "  ./opencode-server.sh start   - Start server"
    echo "  ./opencode-server.sh fg      - Start in foreground"
    echo "  ./opencode-server.sh stop    - Stop server"
    echo "  ./opencode-server.sh logs    - View logs"
}

# View logs
cmd_logs() {
    get_config

    if [ -f "$LOG_FILE" ]; then
        print_info "Showing logs (Ctrl+C to exit)..."
        echo ""
        tail -f "$LOG_FILE"
    else
        print_warning "No log file found: $LOG_FILE"
        print_info "Start the server first: ./opencode-server.sh start"
    fi
}

# Restart server
cmd_restart() {
    print_header
    cmd_stop
    echo ""
    sleep 2
    cmd_start
}

# Show help
cmd_help() {
    print_header

    echo "OpenCode Server Control Script"
    echo ""
    echo "Usage: ./opencode-server.sh [command]"
    echo ""
    echo "Commands:"
    echo "  start      Start OpenCode server in background"
    echo "  stop       Stop OpenCode server"
    echo "  status     Check server status and configuration"
    echo "  restart    Restart OpenCode server"
    echo "  logs       View server logs"
    echo "  fg         Start in foreground mode (Ctrl+C to stop)"
    echo "  help       Show this help message"
    echo ""
    echo "Configuration (via .env file):"
    echo "  OPENCODE_PORT          Server port (default: 4096)"
    echo "  OPENCODE_HOSTNAME      Server hostname (default: 127.0.0.1)"
    echo "  WORKSPACE_PATH         Working directory (default: ~/GitProject)"
    echo "  OPENCODE_PASSWORD      Server password (optional)"
    echo "  OPENCODE_CORS          CORS origin (optional)"
    echo ""
    echo "Examples:"
    echo "  ./opencode-server.sh start         # Start server"
    echo "  ./opencode-server.sh status        # Check status"
    echo "  ./opencode-server.sh logs          # View logs"
    echo "  ./opencode-server.sh restart       # Restart server"
    echo ""
    echo "Integration with Telegram Plugin:"
    echo "  1. ./opencode-server.sh start      # Start OpenCode"
    echo "  2. ./control.sh host               # Start Telegram Bot"
}

# Main command dispatcher
main() {
    case "${1:-help}" in
        start)
            cmd_start
            ;;
        stop)
            cmd_stop
            ;;
        status)
            cmd_status
            ;;
        restart)
            cmd_restart
            ;;
        logs)
            cmd_logs
            ;;
        fg)
            cmd_fg
            ;;
        help|--help|-h)
            cmd_help
            ;;
        *)
            print_error "Unknown command: $1"
            echo ""
            cmd_help
            exit 1
            ;;
    esac
}

main "$@"
