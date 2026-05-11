#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ENV_FILE="${SCRIPT_DIR}/.env"
DEFAULT_OPENCODE_WORKDIR="${HOME}/GitProject"
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
    echo "║        OpenCode Telegram Plugin - Foreground          ║"
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

    export WORKSPACE_PATH="${WORKSPACE_PATH:-$DEFAULT_OPENCODE_WORKDIR}"
    export OCTG_LOG_PATH="${OCTG_LOG_PATH:-${SCRIPT_DIR}/logs/opencode-telegram.log}"
    export WHITELIST_FILE="${WHITELIST_FILE:-${SCRIPT_DIR}/data/whitelist.json}"
    export PAIRING_CODE_TTL="${PAIRING_CODE_TTL:-2}"
}

require_env_file() {
    if [ ! -f "$ENV_FILE" ]; then
        print_error "Configuration not found: $ENV_FILE"
        print_info "Create one with './control.sh setup' or pass --env-file"
        exit 1
    fi
}

check_opencode_server() {
    local health_url="${OPENCODE_SERVER_URL:-http://localhost:4096}/global/health"
    local curl_args=(--connect-timeout 2 --max-time 5 -sf)

    if [ -n "${OPENCODE_PASSWORD:-}" ] && curl "${curl_args[@]}" -u "${OPENCODE_USERNAME:-opencode}:${OPENCODE_PASSWORD}" "$health_url" > /dev/null 2>&1; then
        return 0
    fi

    if curl "${curl_args[@]}" "$health_url" > /dev/null 2>&1; then
        return 0
    fi

    return 1
}

get_server_version() {
    local health_url="${OPENCODE_SERVER_URL:-http://localhost:4096}/global/health"
    local health=''
    if [ -n "${OPENCODE_PASSWORD:-}" ]; then
        health=$(curl --connect-timeout 2 --max-time 5 -s -u "${OPENCODE_USERNAME:-opencode}:${OPENCODE_PASSWORD}" "$health_url" 2>/dev/null || true)
    else
        health=$(curl --connect-timeout 2 --max-time 5 -s "$health_url" 2>/dev/null || true)
    fi
    printf '%s\n' "$health" | grep -o '"version":"[^"]*"' | cut -d'"' -f4
}

cmd_setup() {
    print_header

    if [ -f "$ENV_FILE" ]; then
        print_warning "Existing config found: $ENV_FILE"
        read -r -p "Overwrite it? (y/N): " overwrite
        if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
            print_info "Setup cancelled"
            exit 0
        fi
    fi

    read -r -p "Telegram Bot Token: " bot_token
    if [ -z "$bot_token" ]; then
        print_error "Bot token is required"
        exit 1
    fi

    read -r -p "OpenCode Server URL [http://127.0.0.1:4096]: " server_url
    server_url="${server_url:-http://127.0.0.1:4096}"

    read -r -p "OpenCode password (optional): " opencode_password

    mkdir -p "$(dirname "$ENV_FILE")" "${SCRIPT_DIR}/logs" "${SCRIPT_DIR}/data"

    cat > "$ENV_FILE" <<EOF
# Telegram Configuration
TELEGRAM_BOT_TOKEN=$bot_token
TELEGRAM_MODE=polling
TELEGRAM_HANDLER_TIMEOUT=600000

# OpenCode Configuration
OPENCODE_SERVER_URL=$server_url
OPENCODE_USERNAME=opencode
OPENCODE_PASSWORD=$opencode_password
OPENCODE_REQUEST_TIMEOUT=600000

# Application Configuration
LOG_LEVEL=info
OCTG_LOG_PATH=${SCRIPT_DIR}/logs/opencode-telegram.log
WHITELIST_FILE=${SCRIPT_DIR}/data/whitelist.json
PAIRING_CODE_TTL=2
MAX_MESSAGE_LENGTH=4000
CODE_BLOCK_TIMEOUT=120000
ENABLE_SSE=true
EOF

    print_success "Configuration written to $ENV_FILE"
    print_info "Service management now lives in ./manage-bots.sh"
}

cmd_host() {
    print_header
    require_env_file
    load_env

    print_info "Building project..."
    (cd "$SCRIPT_DIR" && npm run build)

    if ! check_opencode_server; then
        print_error "Cannot connect to OpenCode server at ${OPENCODE_SERVER_URL:-http://localhost:4096}"
        print_info "For service-managed instances use ./manage-bots.sh start <name>"
        exit 1
    fi

    local version=''
    version=$(get_server_version || true)
    if [ -n "$version" ]; then
        print_success "Connected to OpenCode server v$version"
    fi

    print_info "Starting bot in foreground with $ENV_FILE"
    mkdir -p "$(dirname "$OCTG_LOG_PATH")"
    cd "$SCRIPT_DIR"
    exec node dist/standalone.js
}

cmd_status() {
    print_header

    if [ -f "$ENV_FILE" ]; then
        load_env
        print_success "Config loaded from $ENV_FILE"
        print_info "Log file: $OCTG_LOG_PATH"
        print_info "Whitelist: $WHITELIST_FILE"
        print_info "OpenCode URL: ${OPENCODE_SERVER_URL:-http://localhost:4096}"
    else
        print_warning "Config file not found: $ENV_FILE"
    fi

    echo ""
    if check_opencode_server; then
        print_success "OpenCode server reachable"
        local version=''
        version=$(get_server_version || true)
        if [ -n "$version" ]; then
            print_info "Version: $version"
        fi
    else
        print_warning "OpenCode server unreachable"
    fi

    local pid=''
    pid=$(pgrep -f "node.*dist/standalone.js" | head -1 || true)
    if [ -n "$pid" ]; then
        print_info "Foreground bot process detected (PID: $pid)"
    else
        print_info "No foreground bot process detected"
    fi
}

cmd_logs() {
    require_env_file
    load_env

    if [ ! -f "$OCTG_LOG_PATH" ]; then
        print_error "Log file not found: $OCTG_LOG_PATH"
        exit 1
    fi

    print_info "Showing logs from $OCTG_LOG_PATH"
    tail -f "$OCTG_LOG_PATH"
}

cmd_pair() {
    require_env_file
    load_env

    mkdir -p "$(dirname "$WHITELIST_FILE")"

    node -e "
        const fs = require('fs');
        const crypto = require('crypto');

        const whitelistFile = process.argv[1];
        const ttl = Number(process.argv[2]) || 2;
        let data = { users: [], groups: [], pairingCodes: [] };

        if (fs.existsSync(whitelistFile)) {
          try {
            data = JSON.parse(fs.readFileSync(whitelistFile, 'utf8'));
          } catch {}
        }

        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + ttl * 60 * 1000);

        data.pairingCodes.push({ code, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() });
        fs.writeFileSync(whitelistFile, JSON.stringify(data, null, 2));

        console.log('📋 New Pairing Code: ' + code);
        console.log('Use in Telegram: /pair ' + code);
        console.log('Valid for ' + ttl + ' minutes.');
    " "$WHITELIST_FILE" "$PAIRING_CODE_TTL"
}

cmd_whitelist() {
    local action="${1:-list}"
    require_env_file
    load_env

    case "$action" in
        list)
            if [ ! -f "$WHITELIST_FILE" ]; then
                print_warning "Whitelist file not found: $WHITELIST_FILE"
                exit 0
            fi

            node -e "
                const fs = require('fs');
                const file = process.argv[1];
                const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                console.log('Users:', data.users.length);
                data.users.forEach((user) => console.log('  user', user.id, user.username || 'unknown'));
                console.log('Groups:', data.groups.length);
                data.groups.forEach((group) => console.log('  group', group.id, group.title || 'unknown'));
                console.log('Pending pairing codes:', (data.pairingCodes || []).length);
            " "$WHITELIST_FILE"
            ;;
        remove)
            local whitelist_type="${2:-}"
            local target_id="${3:-}"

            if [ -z "$whitelist_type" ] || [ -z "$target_id" ]; then
                print_error "Usage: ./control.sh whitelist remove <user|group> <id>"
                exit 1
            fi

            node -e "
                const fs = require('fs');
                const file = process.argv[1];
                const targetType = process.argv[2];
                const targetId = process.argv[3];

                if (!fs.existsSync(file)) {
                  console.error('Whitelist file not found');
                  process.exit(1);
                }

                const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                const key = targetType === 'user' ? 'users' : 'groups';
                const before = data[key].length;
                data[key] = data[key].filter((entry) => entry.id !== targetId);

                if (data[key].length === before) {
                  console.error('Entry not found');
                  process.exit(1);
                }

                fs.writeFileSync(file, JSON.stringify(data, null, 2));
                console.log('Removed', targetType, targetId);
            " "$WHITELIST_FILE" "$whitelist_type" "$target_id"
            ;;
        *)
            print_error "Usage: ./control.sh whitelist [list|remove <user|group> <id>]"
            exit 1
            ;;
    esac
}

cmd_help() {
    print_header
    cat <<EOF
Usage: ./control.sh [--env-file PATH] <command>

Foreground/debug commands:
  setup      Create a local env file for a single foreground bot
  host       Build and run the Telegram bot in foreground
  status     Show config and foreground connectivity status
  logs       Tail the configured bot log file
  pair       Generate a pairing code into the configured whitelist file
  whitelist  List or remove whitelist entries
  help       Show this help message

Notes:
  - Service management moved to ./manage-bots.sh
  - For multi-instance service deployment, create instances with ./manage-bots.sh add <name>
  - To debug one managed instance in foreground, pass its env file with --env-file instances/<name>/bot.env
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
    shift || true
    REMAINING_ARGS=("$@")
}

main() {
    parse_args "$@"
    cd "$SCRIPT_DIR"

    case "$COMMAND" in
        setup)
            cmd_setup
            ;;
        host)
            cmd_host
            ;;
        status)
            cmd_status
            ;;
        logs)
            cmd_logs
            ;;
        pair)
            cmd_pair
            ;;
        whitelist)
            cmd_whitelist "${REMAINING_ARGS[@]:-}"
            ;;
        start|stop|restart|update)
            print_error "'$COMMAND' was removed from control.sh"
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
