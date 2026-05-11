#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ENV_FILE="${SCRIPT_DIR}/.env"
DEFAULT_WORKDIR="${HOME}/GitProject"
DEFAULT_PORT=4096
DEFAULT_HOSTNAME="127.0.0.1"
ENV_FILE="$DEFAULT_ENV_FILE"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

print_header() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║        OpenCode Server - Foreground Helper            ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_info() { echo -e "${CYAN}ℹ${NC} $1"; }

load_env() {
    if [ -f "$ENV_FILE" ]; then
        set -a
        # shellcheck disable=SC1090
        source "$ENV_FILE"
        set +a
    fi

    OPENCODE_MANAGED="${OPENCODE_MANAGED:-true}"
    OPENCODE_PORT="${OPENCODE_PORT:-$DEFAULT_PORT}"
    OPENCODE_HOSTNAME="${OPENCODE_HOSTNAME:-$DEFAULT_HOSTNAME}"
    WORKSPACE_PATH="${WORKSPACE_PATH:-$DEFAULT_WORKDIR}"
}

derive_server_url() {
    if [ "${OPENCODE_MANAGED:-true}" = "true" ]; then
        printf 'http://%s:%s\n' "$OPENCODE_HOSTNAME" "$OPENCODE_PORT"
    else
        printf '%s\n' "${OPENCODE_SERVER_URL:-http://127.0.0.1:4096}"
    fi
}

check_server() {
    local health_url="$(derive_server_url)/global/health"
    local curl_args=(--connect-timeout 2 --max-time 5 -sf)

    if [ -n "${OPENCODE_PASSWORD:-}" ] && curl "${curl_args[@]}" -u "opencode:${OPENCODE_PASSWORD}" "$health_url" > /dev/null 2>&1; then
        return 0
    fi

    curl "${curl_args[@]}" "$health_url" > /dev/null 2>&1
}

cmd_fg() {
    print_header
    load_env

    if [ "${OPENCODE_MANAGED:-true}" != "true" ]; then
        print_error "This env file points to an external OpenCode server"
        print_info "Use manage-bots.sh start <name> only for the bot service in this case"
        exit 1
    fi

    local opencode_bin="${OPENCODE_BIN:-opencode}"
    if ! command -v "$opencode_bin" > /dev/null 2>&1; then
        print_error "OpenCode CLI not found in PATH (looked for: $opencode_bin)"
        exit 1
    fi

    mkdir -p "$WORKSPACE_PATH"
    export OPENCODE_SERVER_PASSWORD="${OPENCODE_PASSWORD:-}"

    local args=(serve --port "$OPENCODE_PORT" --hostname "$OPENCODE_HOSTNAME")
    if [ -n "${OPENCODE_CORS:-}" ]; then
        args+=(--cors "$OPENCODE_CORS")
    fi

    print_info "Starting OpenCode server in foreground"
    print_info "Workspace: $WORKSPACE_PATH"
    print_info "URL: $(derive_server_url)"

    cd "$WORKSPACE_PATH"
    exec "$opencode_bin" "${args[@]}"
}

cmd_status() {
    print_header
    load_env
    print_info "Env file: $ENV_FILE"
    print_info "Managed locally: ${OPENCODE_MANAGED:-true}"
    print_info "Server URL: $(derive_server_url)"
    if [ "${OPENCODE_MANAGED:-true}" = "true" ]; then
        print_info "Workspace: $WORKSPACE_PATH"
    fi

    if check_server; then
        print_success "OpenCode server reachable"
    else
        print_warning "OpenCode server unreachable"
    fi
}

cmd_help() {
    print_header
    cat <<EOF
Usage: ./opencode-server.sh [--env-file PATH] <command>

Commands:
  fg        Run a managed local OpenCode server in foreground
  status    Show the configured URL and connectivity
  help      Show this help message

Notes:
  - Background lifecycle management moved to ./manage-bots.sh
  - For managed instances, pass --env-file instances/<name>/server.env to debug one server in foreground
EOF
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --env-file)
                ENV_FILE="$2"
                shift 2
                ;;
            --help|-h)
                cmd_help
                exit 0
                ;;
            *)
                break
                ;;
        esac
    done

    COMMAND="${1:-help}"
}

main() {
    parse_args "$@"
    case "$COMMAND" in
        fg)
            cmd_fg
            ;;
        status)
            cmd_status
            ;;
        start|stop|restart|logs)
            print_error "'$COMMAND' was removed from opencode-server.sh"
            print_info "Use ./manage-bots.sh for service lifecycle management"
            exit 1
            ;;
        help)
            cmd_help
            ;;
        *)
            print_error "Unknown command: $COMMAND"
            cmd_help
            exit 1
            ;;
    esac
}

main "$@"
