#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTANCES_DIR="${SCRIPT_DIR}/instances"
GENERATED_LAUNCHD_DIR="${SCRIPT_DIR}/services/launchd"
GENERATED_SYSTEMD_DIR="${SCRIPT_DIR}/services/systemd-user"
RUN_BOT_SCRIPT="${SCRIPT_DIR}/scripts/run-bot-instance.sh"
RUN_SERVER_SCRIPT="${SCRIPT_DIR}/scripts/run-opencode-instance.sh"
MACOS_LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
LINUX_SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
COMMON_PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

print_header() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║         OpenCode Telegram - Instance Manager          ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_info() { echo -e "${CYAN}ℹ${NC} $1"; }

is_macos() {
    [[ "$(uname -s)" == "Darwin" ]]
}

is_systemd_available() {
    command -v systemctl > /dev/null 2>&1 && systemctl --user status > /dev/null 2>&1
}

require_supported_service_manager() {
    if is_macos; then
        return 0
    fi

    if is_systemd_available; then
        return 0
    fi

    print_error "This manager currently supports macOS launchd and Linux systemd --user"
    exit 1
}

assert_instance_name() {
    local name="$1"
    if [[ ! "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
        print_error "Invalid instance name: $name"
        print_info "Use letters, numbers, dot, underscore, or hyphen"
        exit 1
    fi
}

instance_dir() {
    printf '%s/%s\n' "$INSTANCES_DIR" "$1"
}

bot_env_file() {
    printf '%s/bot.env\n' "$(instance_dir "$1")"
}

server_env_file() {
    printf '%s/server.env\n' "$(instance_dir "$1")"
}

meta_env_file() {
    printf '%s/meta.env\n' "$(instance_dir "$1")"
}

read_env_value() {
    local file="$1"
    local key="$2"
    local default_value="${3:-}"
    local line=''

    if [ -f "$file" ]; then
        line=$(grep -E "^${key}=" "$file" | tail -n 1 || true)
    fi

    if [ -z "$line" ]; then
        printf '%s\n' "$default_value"
        return
    fi

    line="${line#*=}"
    line="${line#\"}"
    line="${line%\"}"
    printf '%s\n' "$line"
}

load_instance_meta() {
    local name="$1"
    BOT_ENV_FILE="$(bot_env_file "$name")"
    SERVER_ENV_FILE="$(server_env_file "$name")"
    META_ENV_FILE="$(meta_env_file "$name")"

    if [ ! -f "$BOT_ENV_FILE" ] || [ ! -f "$SERVER_ENV_FILE" ]; then
        print_error "Instance '$name' is missing env files"
        exit 1
    fi

    INSTANCE_DIR="$(instance_dir "$name")"
    INSTANCE_MANAGED="$(read_env_value "$SERVER_ENV_FILE" OPENCODE_MANAGED true)"
    INSTANCE_SERVER_URL="$(read_env_value "$BOT_ENV_FILE" OPENCODE_SERVER_URL http://127.0.0.1:4096)"
    INSTANCE_SERVER_PASSWORD="$(read_env_value "$BOT_ENV_FILE" OPENCODE_PASSWORD '')"
    INSTANCE_SERVER_USERNAME="$(read_env_value "$BOT_ENV_FILE" OPENCODE_USERNAME opencode)"
    INSTANCE_BOT_LOG="$(read_env_value "$BOT_ENV_FILE" OCTG_LOG_PATH "${SCRIPT_DIR}/logs/${name}/bot.log")"
    INSTANCE_SERVER_LOG="$(read_env_value "$SERVER_ENV_FILE" OPENCODE_LOG_PATH "${SCRIPT_DIR}/logs/${name}/opencode-server.log")"
}

list_instance_names() {
    if [ ! -d "$INSTANCES_DIR" ]; then
        return 0
    fi

    for path in "$INSTANCES_DIR"/*; do
        [ -d "$path" ] || continue
        basename "$path"
    done | sort
}

require_instance() {
    local name="$1"
    if [ ! -d "$(instance_dir "$name")" ]; then
        print_error "Instance not found: $name"
        exit 1
    fi
}

prompt_default() {
    local label="$1"
    local default_value="$2"
    local answer=''
    read -r -p "$label [$default_value]: " answer
    printf '%s\n' "${answer:-$default_value}"
}

build_loopback_url() {
    local hostname="$1"
    local port="$2"
    local host_for_bot="$hostname"

    case "$hostname" in
        0.0.0.0|::|::0|localhost)
            host_for_bot="127.0.0.1"
            ;;
    esac

    printf 'http://%s:%s\n' "$host_for_bot" "$port"
}

next_default_port() {
    local port=4096
    local used_ports=''

    while IFS= read -r name; do
        [ -n "$name" ] || continue
        local file
        file="$(server_env_file "$name")"
        if [ -f "$file" ] && [ "$(read_env_value "$file" OPENCODE_MANAGED true)" = "true" ]; then
            used_ports+=" $(read_env_value "$file" OPENCODE_PORT '')"
        fi
    done < <(list_instance_names)

    while [[ " $used_ports " == *" $port "* ]]; do
        port=$((port + 1))
    done

    printf '%s\n' "$port"
}

launchd_label() {
    printf '%s.%s\n' "$1" "$2"
}

launchd_bot_label() {
    launchd_label com.opencode.telegram "$1"
}

launchd_server_label() {
    launchd_label com.opencode.server "$1"
}

systemd_bot_unit() {
    printf 'opencode-telegram-%s.service\n' "$1"
}

systemd_server_unit() {
    printf 'opencode-server-%s.service\n' "$1"
}

generated_launchd_path() {
    printf '%s/%s.plist\n' "$GENERATED_LAUNCHD_DIR" "$1"
}

generated_systemd_path() {
    printf '%s/%s\n' "$GENERATED_SYSTEMD_DIR" "$1"
}

user_launchd_path() {
    printf '%s/%s.plist\n' "$MACOS_LAUNCH_AGENTS_DIR" "$1"
}

user_systemd_path() {
    printf '%s/%s\n' "$LINUX_SYSTEMD_USER_DIR" "$1"
}

render_bot_launchd() {
    local name="$1"
    local label
    label="$(launchd_bot_label "$name")"
    local target
    target="$(generated_launchd_path "$label")"
    mkdir -p "$GENERATED_LAUNCHD_DIR"

    cat > "$target" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${RUN_BOT_SCRIPT}</string>
        <string>${BOT_ENV_FILE}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${SCRIPT_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${COMMON_PATH}</string>
    </dict>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <false/>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>StandardOutPath</key>
    <string>${INSTANCE_BOT_LOG}</string>
    <key>StandardErrorPath</key>
    <string>${INSTANCE_BOT_LOG}</string>
</dict>
</plist>
EOF
}

render_server_launchd() {
    local name="$1"
    local label
    label="$(launchd_server_label "$name")"
    local target
    target="$(generated_launchd_path "$label")"
    mkdir -p "$GENERATED_LAUNCHD_DIR"

    cat > "$target" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${RUN_SERVER_SCRIPT}</string>
        <string>${SERVER_ENV_FILE}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${SCRIPT_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${COMMON_PATH}</string>
    </dict>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <false/>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>StandardOutPath</key>
    <string>${INSTANCE_SERVER_LOG}</string>
    <key>StandardErrorPath</key>
    <string>${INSTANCE_SERVER_LOG}</string>
</dict>
</plist>
EOF
}

render_bot_systemd() {
    local name="$1"
    local unit
    unit="$(systemd_bot_unit "$name")"
    local target
    target="$(generated_systemd_path "$unit")"
    mkdir -p "$GENERATED_SYSTEMD_DIR"

    cat > "$target" <<EOF
[Unit]
Description=OpenCode Telegram Bot (${name})
After=network.target

[Service]
Type=simple
WorkingDirectory=${SCRIPT_DIR}
Environment=PATH=${COMMON_PATH}
ExecStart=${RUN_BOT_SCRIPT} ${BOT_ENV_FILE}
Restart=on-failure
RestartSec=5
StandardOutput=append:${INSTANCE_BOT_LOG}
StandardError=append:${INSTANCE_BOT_LOG}

[Install]
WantedBy=default.target
EOF
}

render_server_systemd() {
    local name="$1"
    local unit
    unit="$(systemd_server_unit "$name")"
    local target
    target="$(generated_systemd_path "$unit")"
    mkdir -p "$GENERATED_SYSTEMD_DIR"

    cat > "$target" <<EOF
[Unit]
Description=OpenCode Server (${name})
After=network.target

[Service]
Type=simple
WorkingDirectory=${SCRIPT_DIR}
Environment=PATH=${COMMON_PATH}
ExecStart=${RUN_SERVER_SCRIPT} ${SERVER_ENV_FILE}
Restart=on-failure
RestartSec=5
StandardOutput=append:${INSTANCE_SERVER_LOG}
StandardError=append:${INSTANCE_SERVER_LOG}

[Install]
WantedBy=default.target
EOF
}

sync_service_files() {
    local name="$1"
    if is_macos; then
        mkdir -p "$MACOS_LAUNCH_AGENTS_DIR"
        cp "$(generated_launchd_path "$(launchd_bot_label "$name")")" "$(user_launchd_path "$(launchd_bot_label "$name")")"
        if [ "$INSTANCE_MANAGED" = "true" ]; then
            cp "$(generated_launchd_path "$(launchd_server_label "$name")")" "$(user_launchd_path "$(launchd_server_label "$name")")"
        else
            rm -f "$(user_launchd_path "$(launchd_server_label "$name")")"
        fi
        return
    fi

    mkdir -p "$LINUX_SYSTEMD_USER_DIR"
    cp "$(generated_systemd_path "$(systemd_bot_unit "$name")")" "$(user_systemd_path "$(systemd_bot_unit "$name")")"
    if [ "$INSTANCE_MANAGED" = "true" ]; then
        cp "$(generated_systemd_path "$(systemd_server_unit "$name")")" "$(user_systemd_path "$(systemd_server_unit "$name")")"
    else
        rm -f "$(user_systemd_path "$(systemd_server_unit "$name")")"
    fi
}

render_service_files() {
    local name="$1"
    load_instance_meta "$name"
    mkdir -p "$(dirname "$INSTANCE_BOT_LOG")" "$(dirname "$INSTANCE_SERVER_LOG")"

    if is_macos; then
        render_bot_launchd "$name"
        if [ "$INSTANCE_MANAGED" = "true" ]; then
            render_server_launchd "$name"
        else
            rm -f "$(generated_launchd_path "$(launchd_server_label "$name")")"
        fi
    else
        render_bot_systemd "$name"
        if [ "$INSTANCE_MANAGED" = "true" ]; then
            render_server_systemd "$name"
        else
            rm -f "$(generated_systemd_path "$(systemd_server_unit "$name")")"
        fi
    fi

    sync_service_files "$name"
}

start_launchd_service() {
    local label="$1"
    local plist="$2"
    local domain="gui/$(id -u)"
    launchctl bootout "$domain" "$plist" > /dev/null 2>&1 || true
    launchctl bootstrap "$domain" "$plist"
    launchctl enable "$domain/$label" > /dev/null 2>&1 || true
    launchctl kickstart -k "$domain/$label" > /dev/null 2>&1 || true
}

stop_launchd_service() {
    local plist="$1"
    local domain="gui/$(id -u)"
    launchctl bootout "$domain" "$plist" > /dev/null 2>&1 || true
}

start_systemd_service() {
    local unit="$1"
    systemctl --user daemon-reload
    systemctl --user enable "$unit" > /dev/null 2>&1 || true
    systemctl --user restart "$unit" > /dev/null 2>&1 || systemctl --user start "$unit"
}

stop_systemd_service() {
    local unit="$1"
    systemctl --user stop "$unit" > /dev/null 2>&1 || true
}

server_health_ok() {
    local url="$1"
    local username="$2"
    local password="$3"
    local curl_args=(--connect-timeout 2 --max-time 5 -sf)

    if [ -n "$password" ] && curl "${curl_args[@]}" -u "${username}:${password}" "$url/global/health" > /dev/null 2>&1; then
        return 0
    fi

    curl "${curl_args[@]}" "$url/global/health" > /dev/null 2>&1
}

wait_for_server_health() {
    local url="$1"
    local username="$2"
    local password="$3"
    local attempts=0

    while [ $attempts -lt 30 ]; do
        if server_health_ok "$url" "$username" "$password"; then
            return 0
        fi
        sleep 1
        attempts=$((attempts + 1))
    done

    return 1
}

service_state() {
    local name="$1"
    local kind="$2"

    if is_macos; then
        local label=''
        if [ "$kind" = "bot" ]; then
            label="$(launchd_bot_label "$name")"
        else
            label="$(launchd_server_label "$name")"
        fi
        local row=''
        row=$(launchctl list | grep -F "$label" || true)
        if [ -z "$row" ]; then
            printf 'stopped\n'
            return
        fi
        local pid
        pid=$(printf '%s\n' "$row" | awk '{print $1}')
        if [ -n "$pid" ] && [ "$pid" != "-" ]; then
            printf 'running:%s\n' "$pid"
        else
            printf 'loaded\n'
        fi
        return
    fi

    local unit=''
    if [ "$kind" = "bot" ]; then
        unit="$(systemd_bot_unit "$name")"
    else
        unit="$(systemd_server_unit "$name")"
    fi

    if systemctl --user is-active "$unit" > /dev/null 2>&1; then
        local pid=''
        pid=$(systemctl --user show "$unit" --property=MainPID --value 2>/dev/null || true)
        printf 'running:%s\n' "$pid"
    elif systemctl --user is-enabled "$unit" > /dev/null 2>&1; then
        printf 'enabled\n'
    else
        printf 'stopped\n'
    fi
}

resolve_target_names() {
    local target="${1:-all}"

    if [ "$target" = "all" ] || [ -z "$target" ]; then
        list_instance_names
        return
    fi

    require_instance "$target"
    printf '%s\n' "$target"
}

cmd_add() {
    print_header
    require_supported_service_manager

    local name="${1:-}"
    if [ -z "$name" ]; then
        print_error "Usage: ./manage-bots.sh add <name>"
        exit 1
    fi

    assert_instance_name "$name"

    local dir
    dir="$(instance_dir "$name")"
    if [ -d "$dir" ]; then
        print_error "Instance already exists: $name"
        exit 1
    fi

    mkdir -p "$dir" "$INSTANCES_DIR" "${SCRIPT_DIR}/logs/${name}"

    local bot_token=''
    read -r -p "Telegram Bot Token: " bot_token
    if [ -z "$bot_token" ]; then
        print_error "Bot token is required"
        exit 1
    fi

    local allowed_user_ids=''
    read -r -p "Allowed Telegram user IDs (comma-separated, optional): " allowed_user_ids

    local manage_local_answer=''
    read -r -p "Manage a local OpenCode server for this bot? (Y/n): " manage_local_answer
    local managed_local='true'
    if [[ "$manage_local_answer" =~ ^[Nn]$ ]]; then
        managed_local='false'
    fi

    local opencode_password=''
    local bot_server_url=''
    local server_hostname='127.0.0.1'
    local server_port=''
    local workspace_path=''
    local config_path=''
    local data_path=''

    if [ "$managed_local" = "true" ]; then
        server_port="$(prompt_default "OpenCode port" "$(next_default_port)")"
        server_hostname="$(prompt_default "OpenCode hostname" "127.0.0.1")"
        workspace_path="$(prompt_default "OpenCode workspace path" "${HOME}/GitProject")"
        config_path="$(prompt_default "OpenCode config path" "${HOME}/.config/opencode")"
        data_path="$(prompt_default "OpenCode data path" "${HOME}/.local/share/opencode-${name}")"
        read -r -p "OpenCode password (optional): " opencode_password
        bot_server_url="$(build_loopback_url "$server_hostname" "$server_port")"
    else
        read -r -p "External OpenCode server URL: " bot_server_url
        if [ -z "$bot_server_url" ]; then
            print_error "External OpenCode server URL is required"
            exit 1
        fi
        read -r -p "OpenCode password (optional): " opencode_password
    fi

    local bot_log_path="${SCRIPT_DIR}/logs/${name}/bot.log"
    local server_log_path="${SCRIPT_DIR}/logs/${name}/opencode-server.log"
    local whitelist_file="${dir}/whitelist.json"

    cat > "$(bot_env_file "$name")" <<EOF
# Generated by manage-bots.sh
TELEGRAM_BOT_TOKEN=${bot_token}
TELEGRAM_MODE=polling
TELEGRAM_HANDLER_TIMEOUT=600000
TELEGRAM_ALLOWED_USER_IDS=${allowed_user_ids}

OPENCODE_SERVER_URL=${bot_server_url}
OPENCODE_USERNAME=opencode
OPENCODE_PASSWORD=${opencode_password}
OPENCODE_REQUEST_TIMEOUT=600000

LOG_LEVEL=info
OCTG_LOG_PATH=${bot_log_path}
WHITELIST_FILE=${whitelist_file}
PAIRING_CODE_TTL=2
MAX_MESSAGE_LENGTH=4000
CODE_BLOCK_TIMEOUT=120000
ENABLE_SSE=true
EOF

    cat > "$(server_env_file "$name")" <<EOF
# Generated by manage-bots.sh
OPENCODE_MANAGED=${managed_local}
OPENCODE_SERVER_URL=${bot_server_url}
OPENCODE_USERNAME=opencode
OPENCODE_PASSWORD=${opencode_password}
OPENCODE_BIN=opencode
OPENCODE_HOSTNAME=${server_hostname}
OPENCODE_PORT=${server_port}
WORKSPACE_PATH=${workspace_path}
CONFIG_PATH=${config_path}
DATA_PATH=${data_path}
OPENCODE_LOG_PATH=${server_log_path}
OPENCODE_CORS=
EOF

    cat > "$(meta_env_file "$name")" <<EOF
INSTANCE_NAME=${name}
INSTANCE_DIR=${dir}
EOF

    render_service_files "$name"

    print_success "Instance created: $name"
    print_info "Bot env: $(bot_env_file "$name")"
    if [ "$managed_local" = "true" ]; then
        print_info "Server URL: $bot_server_url"
    else
        print_info "External server URL: $bot_server_url"
    fi
    print_info "Start it with: ./manage-bots.sh start $name"
}

cmd_list() {
    print_header
    local found=false
    while IFS= read -r name; do
        [ -n "$name" ] || continue
        found=true
        load_instance_meta "$name"
        local mode='local'
        if [ "$INSTANCE_MANAGED" != "true" ]; then
            mode='external'
        fi
        echo "- ${name} (${mode}) -> ${INSTANCE_SERVER_URL}"
    done < <(list_instance_names)

    if [ "$found" = false ]; then
        print_info "No instances found"
    fi
}

cmd_start() {
    print_header
    require_supported_service_manager

    local target="${1:-all}"
    local names=()
    while IFS= read -r name; do
        [ -n "$name" ] || continue
        names+=("$name")
    done < <(resolve_target_names "$target")

    if [ ${#names[@]} -eq 0 ]; then
        print_warning "No instances to start"
        exit 0
    fi

    print_info "Building project before start..."
    (cd "$SCRIPT_DIR" && npm run build)

    for name in "${names[@]}"; do
        load_instance_meta "$name"
        render_service_files "$name"

        if [ "$INSTANCE_MANAGED" = "true" ]; then
            if is_macos; then
                start_launchd_service "$(launchd_server_label "$name")" "$(user_launchd_path "$(launchd_server_label "$name")")"
            else
                start_systemd_service "$(systemd_server_unit "$name")"
            fi

            if wait_for_server_health "$INSTANCE_SERVER_URL" "$INSTANCE_SERVER_USERNAME" "$INSTANCE_SERVER_PASSWORD"; then
                print_success "OpenCode server ready for $name"
            else
                print_error "OpenCode server failed health check for $name"
                continue
            fi
        fi

        if is_macos; then
            start_launchd_service "$(launchd_bot_label "$name")" "$(user_launchd_path "$(launchd_bot_label "$name")")"
        else
            start_systemd_service "$(systemd_bot_unit "$name")"
        fi

        print_success "Started instance $name"
    done
}

cmd_stop() {
    print_header
    require_supported_service_manager

    local target="${1:-all}"
    local names=()
    while IFS= read -r name; do
        [ -n "$name" ] || continue
        names+=("$name")
    done < <(resolve_target_names "$target")

    for name in "${names[@]}"; do
        load_instance_meta "$name"
        if is_macos; then
            stop_launchd_service "$(user_launchd_path "$(launchd_bot_label "$name")")"
            if [ "$INSTANCE_MANAGED" = "true" ]; then
                stop_launchd_service "$(user_launchd_path "$(launchd_server_label "$name")")"
            fi
        else
            stop_systemd_service "$(systemd_bot_unit "$name")"
            if [ "$INSTANCE_MANAGED" = "true" ]; then
                stop_systemd_service "$(systemd_server_unit "$name")"
            fi
        fi
        print_success "Stopped instance $name"
    done
}

cmd_status() {
    print_header

    local target="${1:-all}"
    local names=()
    while IFS= read -r name; do
        [ -n "$name" ] || continue
        names+=("$name")
    done < <(resolve_target_names "$target")

    if [ ${#names[@]} -eq 0 ]; then
        print_warning "No instances found"
        exit 0
    fi

    for name in "${names[@]}"; do
        load_instance_meta "$name"
        echo "${name}"
        echo "  server: ${INSTANCE_SERVER_URL}"
        if [ "$INSTANCE_MANAGED" = "true" ]; then
            echo "  server-service: $(service_state "$name" server)"
        else
            echo "  server-service: external"
        fi
        echo "  bot-service: $(service_state "$name" bot)"
        if server_health_ok "$INSTANCE_SERVER_URL" "$INSTANCE_SERVER_USERNAME" "$INSTANCE_SERVER_PASSWORD"; then
            echo "  health: reachable"
        else
            echo "  health: unreachable"
        fi
        echo "  bot-log: ${INSTANCE_BOT_LOG}"
        if [ "$INSTANCE_MANAGED" = "true" ]; then
            echo "  server-log: ${INSTANCE_SERVER_LOG}"
        fi
        echo ""
    done
}

cmd_logs() {
    local target="${1:-}"
    local stream="${2:-bot}"

    if [ -z "$target" ]; then
        local names=()
        while IFS= read -r name; do
            [ -n "$name" ] || continue
            names+=("$name")
        done < <(list_instance_names)

        if [ ${#names[@]} -eq 1 ]; then
            target="${names[0]}"
        else
            print_error "Usage: ./manage-bots.sh logs <name> [bot|server]"
            exit 1
        fi
    fi

    require_instance "$target"
    load_instance_meta "$target"

    local file=''
    case "$stream" in
        bot)
            file="$INSTANCE_BOT_LOG"
            ;;
        server)
            if [ "$INSTANCE_MANAGED" != "true" ]; then
                print_error "Instance '$target' uses an external server and has no local server log"
                exit 1
            fi
            file="$INSTANCE_SERVER_LOG"
            ;;
        *)
            print_error "Unknown log stream: $stream"
            exit 1
            ;;
    esac

    if [ ! -f "$file" ]; then
        print_error "Log file not found: $file"
        exit 1
    fi

    print_info "Tailing $stream logs for $target"
    tail -f "$file"
}

cmd_pair() {
    print_header

    local name="${1:-}"
    if [ -z "$name" ]; then
        print_error "Usage: ./manage-bots.sh pair <name>"
        exit 1
    fi

    require_instance "$name"
    load_instance_meta "$name"

    print_info "Generating pairing code for $name"
    "$SCRIPT_DIR/control.sh" --env-file "$BOT_ENV_FILE" pair
}

cmd_whitelist() {
    print_header

    local name="${1:-}"
    shift || true

    if [ -z "$name" ]; then
        print_error "Usage: ./manage-bots.sh whitelist <name> [list|remove <user|group> <id>]"
        exit 1
    fi

    require_instance "$name"
    load_instance_meta "$name"

    local action="${1:-list}"
    case "$action" in
        list)
            "$SCRIPT_DIR/control.sh" --env-file "$BOT_ENV_FILE" whitelist list
            ;;
        remove)
            if [ $# -lt 3 ]; then
                print_error "Usage: ./manage-bots.sh whitelist <name> remove <user|group> <id>"
                exit 1
            fi
            "$SCRIPT_DIR/control.sh" --env-file "$BOT_ENV_FILE" whitelist remove "$2" "$3"
            ;;
        *)
            print_error "Usage: ./manage-bots.sh whitelist <name> [list|remove <user|group> <id>]"
            exit 1
            ;;
    esac
}

cmd_remove() {
    print_header

    local name="${1:-}"
    if [ -z "$name" ]; then
        print_error "Usage: ./manage-bots.sh remove <name>"
        exit 1
    fi

    require_instance "$name"
    load_instance_meta "$name"

    read -r -p "Remove instance '$name' and its generated service files? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        print_info "Remove cancelled"
        exit 0
    fi

    cmd_stop "$name" > /dev/null

    rm -rf "$(instance_dir "$name")"
    rm -f "$(generated_launchd_path "$(launchd_bot_label "$name")")" "$(generated_launchd_path "$(launchd_server_label "$name")")"
    rm -f "$(generated_systemd_path "$(systemd_bot_unit "$name")")" "$(generated_systemd_path "$(systemd_server_unit "$name")")"
    rm -f "$(user_launchd_path "$(launchd_bot_label "$name")")" "$(user_launchd_path "$(launchd_server_label "$name")")"
    rm -f "$(user_systemd_path "$(systemd_bot_unit "$name")")" "$(user_systemd_path "$(systemd_server_unit "$name")")"

    if ! is_macos && is_systemd_available; then
        systemctl --user daemon-reload
    fi

    print_success "Removed instance $name"
}

cmd_help() {
    print_header
    cat <<EOF
Usage: ./manage-bots.sh <command> [args]

Commands:
  add <name>            Create a new bot instance and generate service files
  list                  List all configured instances
  start [name|all]      Start one instance or all instances (default: all)
  stop [name|all]       Stop one instance or all instances (default: all)
  status [name|all]     Show service and health status (default: all)
  logs <name> [stream]  Tail bot or server logs for one instance
  pair <name>           Generate a pairing code for one instance
  whitelist <name> ...  Manage whitelist for one instance
  remove <name>         Remove one instance after confirmation
  help                  Show this help message

Layout:
  instances/<name>/bot.env
  instances/<name>/server.env
  instances/<name>/meta.env

Notes:
  - Existing control.sh and opencode-server.sh are now foreground/debug helpers.
  - This manager is the only place that registers launchd/systemd services.
EOF
}

main() {
    local command="${1:-help}"
    shift || true

    case "$command" in
        add)
            cmd_add "$@"
            ;;
        list)
            cmd_list
            ;;
        start)
            cmd_start "$@"
            ;;
        stop)
            cmd_stop "$@"
            ;;
        status)
            cmd_status "$@"
            ;;
        logs)
            cmd_logs "$@"
            ;;
        pair)
            cmd_pair "$@"
            ;;
        whitelist)
            cmd_whitelist "$@"
            ;;
        remove)
            cmd_remove "$@"
            ;;
        help|--help|-h)
            cmd_help
            ;;
        *)
            print_error "Unknown command: $command"
            cmd_help
            exit 1
            ;;
    esac
}

main "$@"
