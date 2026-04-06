#!/bin/bash

# OpenCode Telegram Plugin - Unified Control Script
# Usage: ./control.sh [command]
#
# Commands:
#   setup      - Interactive configuration setup
#   host       - Start in host mode (local development)
#   status     - Check service status
#   stop       - Stop all services
#   logs       - View logs
#   restart    - Restart services
#   update     - Update and rebuild
#
# Examples:
#   ./control.sh setup    # First time setup
#   ./control.sh host     # Run locally
#   ./control.sh status   # Check status

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="opencode-telegram"

LEGACY_GLOBAL_ENV_FILE="${HOME}/.config/agent-toolkits/opencode-telegram.env"
LOCAL_ENV_FILE="${SCRIPT_DIR}/.env"
DEFAULT_OPENCODE_WORKDIR="${HOME}/GitProject"

ENV_FILE="${LOCAL_ENV_FILE}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

print_header() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║     OpenCode Telegram Plugin - Control Center          ║"
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

get_cmd_prefix() {
    if [[ "${ATK_CALLER:-}" == "true" ]] || [[ "${0##*/}" == "opencode-telegram" ]]; then
        echo "atk plugins telegram"
    else
        echo "./control.sh"
    fi
}

is_macos() {
    [[ "$(uname -s)" == "Darwin" ]]
}

is_systemd_available() {
    command -v systemctl > /dev/null 2>&1 && systemctl --user status > /dev/null 2>&1
}

get_opencode_workdir() {
    local workdir="${WORKSPACE_PATH:-$DEFAULT_OPENCODE_WORKDIR}"

    case "$workdir" in
        "~")
            workdir="$HOME"
            ;;
        ~/*)
            workdir="$HOME/${workdir#~/}"
            ;;
    esac

    printf '%s\n' "$workdir"
}

check_opencode_server() {
    print_info "Checking OpenCode server..."
    if [ -n "${OPENCODE_PASSWORD:-}" ] && curl -sf -u "opencode:${OPENCODE_PASSWORD}" "${OPENCODE_SERVER_URL:-http://localhost:4096}/global/health" > /dev/null 2>&1; then
        local health version
        health=$(curl -s -u "opencode:${OPENCODE_PASSWORD}" "${OPENCODE_SERVER_URL}/global/health" 2>/dev/null)
        version=$(echo "$health" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
        print_success "OpenCode server running (v${version})"
        return 0
    elif curl -sf "${OPENCODE_SERVER_URL:-http://localhost:4096}/global/health" > /dev/null 2>&1; then
        local health version
        health=$(curl -s "${OPENCODE_SERVER_URL}/global/health" 2>/dev/null)
        version=$(echo "$health" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
        print_success "OpenCode server running (v${version})"
        return 0
    else
        print_error "Cannot connect to OpenCode server at ${OPENCODE_SERVER_URL:-http://localhost:4096}"
        print_info "Please start it manually: opencode serve --port 4096 --hostname 127.0.0.1"
        return 1
    fi
}

# Background daemon management
daemon_name="opencode-telegram"
LOG_DIR="${HOME}/.local/share/agent-toolkits/logs"
mkdir -p "$LOG_DIR"
pid_file="${LOG_DIR}/opencode-telegram.pid"
log_file="${LOG_DIR}/opencode-telegram.log"

cmd_start() {
    print_header
    
    if [ ! -f "$ENV_FILE" ]; then
        print_error "Configuration not found!"
        print_info "Run '$(get_cmd_prefix) setup' first"
        exit 1
    fi
    
    load_env
    
    # Check if already running
    if [ -f "$pid_file" ]; then
        local pid
        pid=$(cat "$pid_file" 2>/dev/null)
        if kill -0 "$pid" 2>/dev/null; then
            print_warning "Already running (PID: $pid)"
            exit 0
        else
            rm -f "$pid_file"
        fi
    fi
    
    # Build
    print_info "Building..."
    cd "$SCRIPT_DIR" && npm run build || { print_error "Build failed"; exit 1; }

    check_opencode_server || exit 1

    print_info "Starting in background mode..."
    
    if is_macos; then
        # macOS: Use launchd
        local plist_path="${HOME}/Library/LaunchAgents/com.opencode.telegram.plist"
        
        mkdir -p "${HOME}/Library/LaunchAgents"
        
        # Get actual node path
        local node_path
        node_path=$(which node)
        
        cat > "$plist_path" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.opencode.telegram</string>
    <key>ProgramArguments</key>
    <array>
        <string>${node_path}</string>
        <string>${SCRIPT_DIR}/dist/standalone.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${SCRIPT_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin</string>
        <key>TELEGRAM_BOT_TOKEN</key>
        <string>${TELEGRAM_BOT_TOKEN:-}</string>
        <key>TELEGRAM_MODE</key>
        <string>${TELEGRAM_MODE:-polling}</string>
        <key>TELEGRAM_WEBHOOK_URL</key>
        <string>${TELEGRAM_WEBHOOK_URL:-}</string>
        <key>TELEGRAM_WEBHOOK_PORT</key>
        <string>${TELEGRAM_WEBHOOK_PORT:-3000}</string>
        <key>TELEGRAM_ALLOWED_USER_IDS</key>
        <string>${TELEGRAM_ALLOWED_USER_IDS:-}</string>
        <key>OPENCODE_PASSWORD</key>
        <string>${OPENCODE_PASSWORD:-}</string>
        <key>OPENCODE_SERVER_URL</key>
        <string>${OPENCODE_SERVER_URL:-http://localhost:4096}</string>
        <key>OPENCODE_USERNAME</key>
        <string>${OPENCODE_USERNAME:-opencode}</string>
        <key>OPENCODE_REQUEST_TIMEOUT</key>
        <string>${OPENCODE_REQUEST_TIMEOUT:-60000}</string>
        <key>WHITELIST_FILE</key>
        <string>${WHITELIST_FILE:-${SCRIPT_DIR}/data/whitelist.json}</string>
        <key>PAIRING_CODE_TTL</key>
        <string>${PAIRING_CODE_TTL:-2}</string>
        <key>LOG_LEVEL</key>
        <string>${LOG_LEVEL:-info}</string>
        <key>MAX_MESSAGE_LENGTH</key>
        <string>${MAX_MESSAGE_LENGTH:-4000}</string>
        <key>CODE_BLOCK_TIMEOUT</key>
        <string>${CODE_BLOCK_TIMEOUT:-120000}</string>
        <key>ENABLE_SSE</key>
        <string>${ENABLE_SSE:-true}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${log_file}</string>
    <key>StandardErrorPath</key>
    <string>${log_file}</string>
</dict>
</plist>
EOF
        
        # Unload if already loaded
        launchctl unload "$plist_path" 2>/dev/null || true
        
        # Load the plist
        if launchctl load "$plist_path" 2>/dev/null; then
            print_success "Service loaded"
        else
            # Try modern launchctl for macOS 11+
            launchctl bootstrap user/$(id - u) "$plist_path" 2>/dev/null || {
                print_error "Failed to load service"
                exit 1
            }
        fi
        
        # Give it a moment to start
        sleep 2
        
        # Check if running
        if launchctl list | grep -q "com.opencode.telegram"; then
            local pid
            pid=$(launchctl list | grep com.opencode.telegram | awk '{print $1}')
            if [ -n "$pid" ] && [ "$pid" != "-" ]; then
                echo "$pid" > "$pid_file"
                print_success "Started (PID: $pid)"
                print_info "Logs: tail -f $log_file"
            else
                print_success "Service started"
                print_info "Logs: tail -f $log_file"
            fi
        else
            print_error "Failed to start"
            exit 1
        fi
        
    elif is_systemd_available; then
        # Linux with systemd
        local service_path="${HOME}/.config/systemd/user/opencode-telegram.service"
        
        mkdir -p "${HOME}/.config/systemd/user"
        
        cat > "$service_path" << EOF
[Unit]
Description=OpenCode Telegram Plugin
After=network.target

[Service]
Type=simple
WorkingDirectory=${SCRIPT_DIR}
ExecStart=/usr/bin/env node ${SCRIPT_DIR}/dist/standalone.js
Restart=on-failure
RestartSec=5
Environment=TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
Environment=TELEGRAM_MODE=${TELEGRAM_MODE:-polling}
Environment=TELEGRAM_WEBHOOK_URL=${TELEGRAM_WEBHOOK_URL:-}
Environment=TELEGRAM_WEBHOOK_PORT=${TELEGRAM_WEBHOOK_PORT:-3000}
Environment=TELEGRAM_ALLOWED_USER_IDS=${TELEGRAM_ALLOWED_USER_IDS:-}
Environment=OPENCODE_PASSWORD=${OPENCODE_PASSWORD:-}
Environment=OPENCODE_SERVER_URL=${OPENCODE_SERVER_URL:-http://localhost:4096}
Environment=OPENCODE_USERNAME=${OPENCODE_USERNAME:-opencode}
Environment=OPENCODE_REQUEST_TIMEOUT=${OPENCODE_REQUEST_TIMEOUT:-60000}
Environment=WHITELIST_FILE=${WHITELIST_FILE:-${SCRIPT_DIR}/data/whitelist.json}
Environment=PAIRING_CODE_TTL=${PAIRING_CODE_TTL:-2}
Environment=LOG_LEVEL=${LOG_LEVEL:-info}
Environment=MAX_MESSAGE_LENGTH=${MAX_MESSAGE_LENGTH:-4000}
Environment=CODE_BLOCK_TIMEOUT=${CODE_BLOCK_TIMEOUT:-120000}
Environment=ENABLE_SSE=${ENABLE_SSE:-true}

[Install]
WantedBy=default.target
EOF
        
        systemctl --user daemon-reload
        systemctl --user enable opencode-telegram
        systemctl --user start opencode-telegram
        
        # Get PID
        sleep 2
        local pid
        pid=$(systemctl --user show opencode-telegram --property=MainPID --value 2>/dev/null)
        if [ -n "$pid" ] && [ "$pid" != "0" ]; then
            echo "$pid" > "$pid_file"
            print_success "Started (PID: $pid)"
            print_info "Logs: journalctl --user -u opencode-telegram -f"
        else
            print_error "Failed to start"
            exit 1
        fi
        
    else
        # Linux without systemd: use nohup
        nohup node "${SCRIPT_DIR}/dist/standalone.js" > "$log_file" 2>&1 &
        local pid=$!
        
        # Verify it started
        sleep 2
        if kill -0 "$pid" 2>/dev/null; then
            echo "$pid" > "$pid_file"
            print_success "Started (PID: $pid)"
            print_info "Logs: tail -f $log_file"
        else
            print_error "Failed to start"
            rm -f "$pid_file"
            exit 1
        fi
    fi
}

check_env_file() {
    if [ ! -f "$ENV_FILE" ]; then
        print_error "Configuration not found!"
        echo ""
        echo "Expected location:"
        echo "  - $LOCAL_ENV_FILE"
        if [ -f "$LEGACY_GLOBAL_ENV_FILE" ]; then
            echo ""
            print_warning "Detected deprecated legacy config: $LEGACY_GLOBAL_ENV_FILE"
            print_info "Please migrate it to: $LOCAL_ENV_FILE"
        fi
        echo ""
        print_info "Run '$(get_cmd_prefix) setup' first to configure"
        exit 1
    fi
}

load_env() {
    if [ -f "$ENV_FILE" ]; then
        set -a
        # shellcheck disable=SC1090
        source "$ENV_FILE"
        set +a
    fi

    if [ -z "${WORKSPACE_PATH:-}" ]; then
        WORKSPACE_PATH="$DEFAULT_OPENCODE_WORKDIR"
        export WORKSPACE_PATH
    fi
}

# Setup command
cmd_setup() {
    print_header
    local cmd_prefix
    cmd_prefix="$(get_cmd_prefix)"
    
    local target_env_file="$LOCAL_ENV_FILE"

    if [ -f "$LOCAL_ENV_FILE" ]; then
        print_warning "Local config found: $LOCAL_ENV_FILE"
        read -p "Overwrite existing config? (y/N): " overwrite
        if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
            print_info "Setup cancelled"
            exit 0
        fi
    elif [ -f "$LEGACY_GLOBAL_ENV_FILE" ]; then
        print_warning "Detected deprecated legacy config: $LEGACY_GLOBAL_ENV_FILE"
        print_info "Setup will now write to local .env: $LOCAL_ENV_FILE"
    fi
    
    print_info "Configuring OpenCode Telegram Plugin (local .env mode)"
    echo ""
    
    # Telegram Bot Token
    echo -e "${CYAN}Step 1: Telegram Bot Token${NC}"
    echo "Get this from @BotFather on Telegram"
    read -p "Bot Token: " bot_token
    
    if [ -z "$bot_token" ]; then
        print_error "Bot token is required"
        exit 1
    fi
    
    # OpenCode Password
    echo ""
    echo -e "${CYAN}Step 2: OpenCode Server Password${NC}"
    echo "Optional: Press Enter to skip"
    read -p "Password: " opencode_password
    
    # Create .env
    mkdir -p "$(dirname "$target_env_file")"
    cat > "$target_env_file" << EOF
# Telegram Configuration
TELEGRAM_BOT_TOKEN=$bot_token
TELEGRAM_MODE=polling

# OpenCode Configuration
OPENCODE_SERVER_URL=http://localhost:4096
OPENCODE_USERNAME=opencode
OPENCODE_PASSWORD=$opencode_password

# Application Configuration
LOG_LEVEL=info
MAX_MESSAGE_LENGTH=4000
CODE_BLOCK_TIMEOUT=120000
EOF

    echo "WHITELIST_FILE=${SCRIPT_DIR}/data/whitelist.json" >> "$target_env_file"
    echo "PAIRING_CODE_TTL=2" >> "$target_env_file" 
    
    echo ""
    print_success "Configuration saved to: $target_env_file"
    
    # Create directories
    mkdir -p "${SCRIPT_DIR}/data"
    mkdir -p "${SCRIPT_DIR}/shared"
    
    print_success "Directories created"
    
    echo ""
    echo -e "${GREEN}Setup complete!${NC}"
    echo ""
    
    echo "Next steps:"
    echo "  ${cmd_prefix} host    - Run locally (requires opencode serve)"
    echo ""
}

# Host mode command
cmd_host() {
    print_header
    
    if [ ! -f "$ENV_FILE" ]; then
        print_error "Configuration not found!"
        echo ""
        echo "Expected location:"
        echo "  - $LOCAL_ENV_FILE"
        if [ -f "$LEGACY_GLOBAL_ENV_FILE" ]; then
            echo ""
            print_warning "Detected deprecated legacy config: $LEGACY_GLOBAL_ENV_FILE"
            print_info "Please migrate it to: $LOCAL_ENV_FILE"
        fi
        echo ""
        print_info "The Telegram Plugin needs configuration before starting."
        echo ""
        read -p "Run setup now? (Y/n): " run_setup
        if [[ ! "$run_setup" =~ ^[Nn]$ ]]; then
            cmd_setup
            exit 0
        else
            print_info "Setup cancelled. Run '$(get_cmd_prefix) setup' when ready."
            exit 1
        fi
    fi
    
    load_env
    
    print_info "Starting in HOST mode..."
    echo ""
    
    # Build
    print_info "Building..."
    cd "$SCRIPT_DIR" && npm run build || { print_error "Build failed"; exit 1; }

    check_opencode_server || exit 1

    echo ""
    print_info "Starting Telegram Bot..."
    echo "Press Ctrl+C to stop"
    echo ""
    
    cd "$SCRIPT_DIR" && node dist/standalone.js
}

# Status command
cmd_status() {
    print_header
    
    echo -e "${CYAN}Service Status${NC}"
    echo "=============================="
    echo ""
    
    # Check if .env exists
    if [ -f "$ENV_FILE" ]; then
        load_env
        print_success ".env configured"
    else
        print_warning ".env not configured"
        echo "  Run: $(get_cmd_prefix) setup"
    fi
    
    echo ""
    
    # Check background mode (via pid file or systemd/launchd)
    local bg_running=false
    local bg_pid=""
    
    if is_macos; then
        # macOS: check launchd
        if launchctl list | grep -q "com.opencode.telegram"; then
            bg_pid=$(launchctl list | grep com.opencode.telegram | awk '{print $1}')
            if [ -n "$bg_pid" ] && [ "$bg_pid" != "-" ]; then
                bg_running=true
            fi
        fi
    elif is_systemd_available; then
        # Linux with systemd
        if systemctl --user is-active opencode-telegram > /dev/null 2>&1; then
            bg_pid=$(systemctl --user show opencode-telegram --property=MainPID --value 2>/dev/null)
            if [ -n "$bg_pid" ] && [ "$bg_pid" != "0" ]; then
                bg_running=true
            fi
        fi
    elif [ -f "$pid_file" ]; then
        # Linux without systemd: check pid file
        bg_pid=$(cat "$pid_file" 2>/dev/null)
        if kill -0 "$bg_pid" 2>/dev/null; then
            bg_running=true
        else
            rm -f "$pid_file"
        fi
    fi
    
    # Check host mode (foreground)
    local fg_running=false
    local fg_pid=""
    if pgrep -f "node.*standalone.js" > /dev/null 2>&1; then
        fg_running=true
        fg_pid=$(pgrep -f "node.*standalone.js" | head -1)
    fi
    
    # Display status
    echo -e "${CYAN}Background Mode${NC}"
    echo "------------------------------"
    if [ "$bg_running" = true ]; then
        print_success "Telegram Bot: Running (PID: $bg_pid)"
        if is_macos; then
            print_info "Logs: tail -f $log_file"
        elif is_systemd_available; then
            print_info "Logs: journalctl --user -u opencode-telegram -f"
        else
            print_info "Logs: tail -f $log_file"
        fi
    else
        print_info "Telegram Bot: Not running (background)"
    fi
    
    echo ""
    
    echo -e "${CYAN}Foreground Mode${NC}"
    echo "------------------------------"
    if [ "$fg_running" = true ]; then
        print_success "Telegram Bot: Running (PID: $fg_pid)"
    else
        print_info "Telegram Bot: Not running (foreground)"
    fi
    
    echo ""

    load_env 2>/dev/null || true
    check_opencode_server
    
    echo ""
    echo -e "${CYAN}Quick Actions${NC}"
    echo "------------------------------"
    if [ -f "$ENV_FILE" ]; then
        echo "  $(get_cmd_prefix) host    - Start locally"
    fi
    echo "  $(get_cmd_prefix) setup   - Reconfigure"
}

# Stop command
cmd_stop() {
    print_header
    
    print_info "Stopping services..."
    echo ""
    
    local stopped=false
    
    # Stop background mode
    if is_macos; then
        if launchctl list | grep -q "com.opencode.telegram"; then
            launchctl stop com.opencode.telegram 2>/dev/null || true
            launchctl unload "${HOME}/Library/LaunchAgents/com.opencode.telegram.plist" 2>/dev/null || true
            print_success "Background service stopped"
            stopped=true
        fi
    elif is_systemd_available; then
        if systemctl --user is-active opencode-telegram > /dev/null 2>&1; then
            systemctl --user stop opencode-telegram
            print_success "Background service stopped"
            stopped=true
        fi
    elif [ -f "$pid_file" ]; then
        local pid
        pid=$(cat "$pid_file" 2>/dev/null)
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            print_success "Background process stopped (PID: $pid)"
            stopped=true
        fi
        rm -f "$pid_file"
    fi

    # Stop foreground mode
    if pgrep -f "node.*standalone.js" > /dev/null; then
        pkill -f "node.*standalone.js"
        print_success "Foreground process stopped"
        stopped=true
    fi
    
    
    if [ "$stopped" = false ]; then
        print_info "No running processes found"
    fi
    
    echo ""
    print_success "All services stopped"
}

# Logs command
cmd_logs() {
    # Check if running in background
    if is_macos; then
        if launchctl list | grep -q "com.opencode.telegram"; then
            print_info "Showing logs from background service (Ctrl+C to exit)..."
            tail -f "$log_file" 2>/dev/null || print_error "Log file not found: $log_file"
            return
        fi
    elif is_systemd_available; then
        if systemctl --user is-active opencode-telegram > /dev/null 2>&1; then
            print_info "Showing logs from systemd service (Ctrl+C to exit)..."
            journalctl --user -u opencode-telegram -f
            return
        fi
    elif [ -f "$log_file" ]; then
        print_info "Showing logs from background process (Ctrl+C to exit)..."
        tail -f "$log_file"
        return
    fi
    
    print_warning "No background logs found"
    print_info "Use '$(get_cmd_prefix) host' to see logs in real-time (foreground mode)"
}

# Restart command
cmd_restart() {
    cmd_stop
    echo ""
    echo "Restarting..."
    echo ""
    sleep 2

    cmd_start
}

# Update command
cmd_update() {
    print_header
    
    print_info "Updating..."
    echo ""
    
    # Stop services
    cmd_stop
    
    # Pull latest code
    if [ -d "${SCRIPT_DIR}/.git" ]; then
        cd "$SCRIPT_DIR" && git pull
    fi
    
    # Rebuild
    cd "$SCRIPT_DIR" && npm run build
    
    print_success "Update complete!"
    echo ""
    echo "Start with: $(get_cmd_prefix) host"
}

# Pair command - generate pairing code
cmd_pair() {
    print_header
    
    local is_host_mode=false
    if pgrep -f "node.*standalone.js" > /dev/null 2>&1; then
        is_host_mode=true
    fi
    
    if [[ "$is_host_mode" == "false" ]]; then
        print_error "Bot is not running"
        print_info "Start with: $(get_cmd_prefix) host"
        exit 1
    fi
    
    cd "$SCRIPT_DIR"

    load_env
    local whitelist_file="${WHITELIST_FILE:-${SCRIPT_DIR}/data/whitelist.json}"
    local pairing_code_ttl="${PAIRING_CODE_TTL:-2}"
    node -e "
        const fs = require('fs');
        const crypto = require('crypto');

        const whitelistFile = '$whitelist_file';
        const pairingCodeTtl = Number('$pairing_code_ttl') || 2;
        let data = { users: [], groups: [], pairingCodes: [] };

        if (fs.existsSync(whitelistFile)) {
            try {
                data = JSON.parse(fs.readFileSync(whitelistFile, 'utf8'));
            } catch(e) {}
        }

        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + pairingCodeTtl * 60 * 1000);

        data.pairingCodes.push({
            code,
            createdAt: now.toISOString(),
            expiresAt: expiresAt.toISOString()
        });

        fs.mkdirSync(require('path').dirname(whitelistFile), { recursive: true });
        fs.writeFileSync(whitelistFile, JSON.stringify(data, null, 2));

        console.log('📋 New Pairing Code: ' + code);
        console.log('');
        console.log('Share this code with the user or group to authorize.');
        console.log('They should send: /pair ' + code);
        console.log('');
        console.log('Valid for ' + pairingCodeTtl + ' minutes.');
    "
}

# Whitelist command - manage whitelist
cmd_whitelist() {
    local action="${1:-list}"
    load_env
    local whitelist_file="${WHITELIST_FILE:-${SCRIPT_DIR}/data/whitelist.json}"
    
    case "$action" in
        list|"")
            if [ -f "$whitelist_file" ]; then
                node -e "
                    const fs = require('fs');
                    const file = '$whitelist_file';
                    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                    
                    console.log('📋 Whitelisted Users (' + data.users.length + '):');
                    data.users.forEach((u, i) => {
                        console.log('  ' + (i+1) + '. ' + (u.username || 'unknown') + ' (' + u.id + ')');
                        console.log('     Paired: ' + new Date(u.pairedAt).toLocaleDateString());
                    });
                    
                    console.log('');
                    console.log('📋 Whitelisted Groups (' + data.groups.length + '):');
                    data.groups.forEach((g, i) => {
                        console.log('  ' + (i+1) + '. ' + (g.title || 'unknown') + ' (' + g.id + ')');
                        console.log('     Paired: ' + new Date(g.pairedAt).toLocaleDateString());
                    });
                    
                    if (data.users.length === 0 && data.groups.length === 0) {
                        console.log('No entries in whitelist.');
                        console.log('Generate a pairing code: ./control.sh pair');
                    }
                "
            else
                print_info "No whitelist file found"
                print_info "Generate a pairing code: ./control.sh pair"
            fi
            ;;
        remove)
            local whitelist_type="$2"
            local id="$3"
            
            if [ -z "$whitelist_type" ] || [ -z "$id" ]; then
                echo "Usage: ./control.sh whitelist remove <user|group> <id>"
                exit 1
            fi
            
            node -e "
                const fs = require('fs');
                const file = '$whitelist_file';

                if (!fs.existsSync(file)) {
                    console.log('✗ Whitelist file not found');
                    process.exit(1);
                }

                const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                
                if ('$whitelist_type' === 'user') {
                    const idx = data.users.findIndex(u => u.id === '$id');
                    if (idx >= 0) {
                        data.users.splice(idx, 1);
                        fs.writeFileSync(file, JSON.stringify(data, null, 2));
                        console.log('✓ Removed user from whitelist');
                    } else {
                        console.log('✗ User not found');
                    }
                } else {
                    const idx = data.groups.findIndex(g => g.id === '$id');
                    if (idx >= 0) {
                        data.groups.splice(idx, 1);
                        fs.writeFileSync(file, JSON.stringify(data, null, 2));
                        console.log('✓ Removed group from whitelist');
                    } else {
                        console.log('✗ Group not found');
                    }
                }
            "
            ;;
        *)
            echo "Usage: ./control.sh whitelist [list|remove <user|group> <id>]"
            exit 1
            ;;
    esac
}

# Help
cmd_help() {
    print_header

    local cmd_prefix
    cmd_prefix="$(get_cmd_prefix)"
    
    echo "OpenCode Telegram Plugin - Telegram Bot for OpenCode"
    echo ""
    echo "Usage: $cmd_prefix [command]"
    echo ""
    echo "Commands:"
    echo "  setup      Interactive configuration setup (run first)"
    echo "  host       Start in foreground mode (requires opencode serve)"
    echo "  start      Start in background mode (macOS: launchd, Linux: systemd/nohup)"
    echo "  status     Check service status"
    echo "  stop       Stop all services"
    echo "  logs       View logs (background mode only)"
    echo "  restart    Restart services in background mode"
    echo "  update     Update and rebuild"
    echo "  pair       Generate pairing code for authorization"
    echo "  whitelist  Manage whitelist (list|remove)"
    echo "  help       Show this help"
    echo ""
    echo "Security:"
    echo "  By default, only authorized users can use the bot."
    echo "  Run '$cmd_prefix pair' to generate a pairing code."
    echo "  New users must send '/pair <code>' in Telegram to authorize."
    echo ""
    echo "Quick Start:"
    echo "  1. $cmd_prefix setup    # Configure"
    echo "  2. $cmd_prefix pair     # Generate pairing code"
    echo "  3. $cmd_prefix start    # Start in background"
    echo "  4. Send /pair <code> in Telegram"
    echo ""
    echo "Or for foreground mode:"
    echo "  $cmd_prefix host        # Start in foreground (Ctrl+C to stop)"
    echo ""
    echo "Examples:"
    echo "  $cmd_prefix start                   # Start in background"
    echo "  $cmd_prefix status                  # Check if running"
    echo "  $cmd_prefix logs                    # View background logs"
    echo "  $cmd_prefix stop                    # Stop all instances"
    echo "  $cmd_prefix pair                    # Generate pairing code"
    echo "  $cmd_prefix whitelist               # Show whitelist"
    echo "  $cmd_prefix whitelist remove user 123456"
}

# Main
main() {
    cd "$SCRIPT_DIR"
    
    case "${1:-help}" in
        setup)
            cmd_setup
            ;;
        host)
            cmd_host
            ;;
        start)
            cmd_start
            ;;
        status)
            cmd_status
            ;;
        stop|down)
            cmd_stop
            ;;
        logs)
            cmd_logs
            ;;
        restart)
            cmd_restart
            ;;
        pair)
            cmd_pair
            ;;
        whitelist)
            cmd_whitelist "$2" "$3" "$4"
            ;;
        update)
            cmd_update
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
