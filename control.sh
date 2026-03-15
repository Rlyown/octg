#!/bin/bash

# OpenCode Telegram Plugin - Unified Control Script
# Usage: ./control.sh [command]
#
# Commands:
#   setup      - Interactive configuration setup
#   host       - Start in host mode (local development)
#   docker     - Start with Docker/OrbStack
#   status     - Check service status
#   stop       - Stop all services
#   logs       - View logs
#   restart    - Restart services
#   shell      - Open shell in container
#   update     - Update and rebuild
#
# Examples:
#   ./control.sh setup    # First time setup
#   ./control.sh host     # Run locally
#   ./control.sh docker   # Run in Docker
#   ./control.sh status   # Check status

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="opencode-telegram"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
ENV_FILE="${SCRIPT_DIR}/.env"

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

check_env_file() {
    if [ ! -f "$ENV_FILE" ]; then
        print_error ".env file not found!"
        print_info "Run './control.sh setup' first to configure"
        exit 1
    fi
}

load_env() {
    if [ -f "$ENV_FILE" ]; then
        export $(grep -v '^#' "$ENV_FILE" | xargs)
    fi
}

# Setup command
cmd_setup() {
    print_header
    
    if [ -f "$ENV_FILE" ]; then
        print_warning ".env file already exists"
        read -p "Overwrite? (y/N): " overwrite
        if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
            print_info "Setup cancelled"
            exit 0
        fi
    fi
    
    print_info "Let's configure your OpenCode Telegram Plugin"
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
    
    # Workspace Path
    echo ""
    echo -e "${CYAN}Step 3: Workspace Directory${NC}"
    echo "Your project directory (mounted to /workspace in container)"
    read -p "Path (default: ./workspace): " workspace_path
    workspace_path="${workspace_path:-./workspace}"
    
    # Expand ~ to $HOME first
    workspace_path="${workspace_path/#\~/$HOME}"
    
    # Expand to absolute path
    if [[ "$workspace_path" = /* ]]; then
        WORKSPACE_PATH="$workspace_path"
    else
        WORKSPACE_PATH="${SCRIPT_DIR}/${workspace_path}"
    fi
    
    # Create workspace if not exists
    if [ ! -d "$WORKSPACE_PATH" ]; then
        print_warning "Directory does not exist: $WORKSPACE_PATH"
        read -p "Create it? (y/N): " create_dir
        if [[ "$create_dir" =~ ^[Yy]$ ]]; then
            mkdir -p "$WORKSPACE_PATH"
            print_success "Created: $WORKSPACE_PATH"
        fi
    fi
    
    # Config Path
    echo ""
    echo -e "${CYAN}Step 4: OpenCode Config Path${NC}"
    read -p "Config path (default: ~/.config/opencode): " config_path
    CONFIG_PATH="${config_path:-$HOME/.config/opencode}"
    
    # Data Path
    echo ""
    echo -e "${CYAN}Step 5: OpenCode Data Path${NC}"
    echo "This contains session database for /attach support"
    read -p "Data path (default: ~/.local/share/opencode): " data_path
    DATA_PATH="${data_path:-$HOME/.local/share/opencode}"
    
    # Check if data exists
    if [ -f "$DATA_PATH/opencode.db" ]; then
        db_size=$(ls -lh "$DATA_PATH/opencode.db" 2>/dev/null | awk '{print $5}')
        print_success "Found session database: $db_size"
    else
        print_warning "Session database not found at $DATA_PATH"
        print_info "Run 'opencode' first to initialize, or continue without /attach support"
    fi
    
    # Create .env
    cat > "$ENV_FILE" << EOF
# Telegram Configuration
TELEGRAM_BOT_TOKEN=$bot_token
TELEGRAM_MODE=polling

# OpenCode Configuration
OPENCODE_SERVER_URL=http://localhost:4096
OPENCODE_USERNAME=opencode
OPENCODE_PASSWORD=$opencode_password

# Paths (using absolute paths)
WORKSPACE_PATH=$WORKSPACE_PATH
CONFIG_PATH=$CONFIG_PATH
DATA_PATH=$DATA_PATH

# Session Configuration
SESSION_STORAGE=file
SESSION_FILE_PATH=/app/data/sessions.json
SESSION_TTL=86400

WHITELIST_FILE=${SCRIPT_DIR}/data/whitelist.json
PAIRING_CODE_TTL=2

# Application Configuration
LOG_LEVEL=info
MAX_MESSAGE_LENGTH=4000
CODE_BLOCK_TIMEOUT=120000
EOF
    
    echo ""
    print_success ".env file created!"
    
    # Create directories
    mkdir -p "${SCRIPT_DIR}/data"
    mkdir -p "${SCRIPT_DIR}/shared"
    mkdir -p "$WORKSPACE_PATH"
    
    print_success "Directories created"
    
    echo ""
    echo -e "${GREEN}Setup complete!${NC}"
    echo ""
    echo "Next steps:"
    echo "  ./control.sh host    - Run locally (requires opencode serve)"
    echo "  ./control.sh docker  - Run with Docker/OrbStack"
    echo ""
}

# Host mode command
cmd_host() {
    print_header
    
    if [ ! -f "$ENV_FILE" ]; then
        print_error ".env file not found!"
        print_info "The Telegram Plugin needs configuration before starting."
        echo ""
        read -p "Run setup now? (Y/n): " run_setup
        if [[ ! "$run_setup" =~ ^[Nn]$ ]]; then
            cmd_setup
            exit 0
        else
            print_info "Setup cancelled. Run './control.sh setup' when ready."
            exit 1
        fi
    fi
    
    load_env
    
    print_info "Starting in HOST mode..."
    echo ""
    
    # Check if compiled
    if [ ! -f "${SCRIPT_DIR}/dist/standalone.js" ]; then
        print_warning "Compiled code not found, building..."
        cd "$SCRIPT_DIR" && npm run build
    fi
    
    # Check OpenCode server
    print_info "Checking OpenCode server..."
    if curl -s -u "opencode:${OPENCODE_PASSWORD}" "${OPENCODE_SERVER_URL}/global/health" > /dev/null 2>&1; then
        health=$(curl -s -u "opencode:${OPENCODE_PASSWORD}" "${OPENCODE_SERVER_URL}/global/health" 2>/dev/null)
        version=$(echo "$health" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
        print_success "OpenCode server running (v${version})"
    else
        print_warning "OpenCode server not running at ${OPENCODE_SERVER_URL}"
        echo ""
        read -p "Start OpenCode server automatically? (Y/n): " start_opencode
        
        if [[ ! "$start_opencode" =~ ^[Nn]$ ]]; then
            print_info "Starting OpenCode server..."
            export OPENCODE_SERVER_PASSWORD="${OPENCODE_PASSWORD}"
            
            # Check if opencode command exists
            if ! command -v opencode &> /dev/null; then
                print_error "opencode command not found"
                print_info "Please install OpenCode: https://opencode.ai"
                exit 1
            fi
            
            # Start OpenCode in background
            opencode serve --port 4096 --hostname 127.0.0.1 &
            OPENCODE_PID=$!
            
            # Wait for OpenCode to be ready
            print_info "Waiting for OpenCode server..."
            for i in {1..30}; do
                if curl -s "${OPENCODE_SERVER_URL}/global/health" > /dev/null 2>&1; then
                    health=$(curl -s "${OPENCODE_SERVER_URL}/global/health" 2>/dev/null)
                    version=$(echo "$health" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
                    print_success "OpenCode server ready (v${version})"
                    break
                fi
                sleep 1
            done
            
            # Check if started successfully
            if ! curl -s "${OPENCODE_SERVER_URL}/global/health" > /dev/null 2>&1; then
                print_error "Failed to start OpenCode server"
                exit 1
            fi
        else
            print_error "OpenCode server is required"
            print_info "Start it manually: opencode serve --port 4096"
            exit 1
        fi
    fi
    
    echo ""
    print_info "Starting Telegram Bot..."
    echo "Press Ctrl+C to stop"
    echo ""
    
    cd "$SCRIPT_DIR" && node dist/standalone.js
}

# Docker command
cmd_docker() {
    print_header
    
    if [ ! -f "$ENV_FILE" ]; then
        print_error ".env file not found!"
        print_info "The Telegram Plugin needs configuration before starting."
        echo ""
        read -p "Run setup now? (Y/n): " run_setup
        if [[ ! "$run_setup" =~ ^[Nn]$ ]]; then
            cmd_setup
            exit 0
        else
            print_info "Setup cancelled. Run './control.sh setup' when ready."
            exit 1
        fi
    fi
    
    load_env
    
    local runtime=""
    local runtime_name=""
    
    if command -v orb &> /dev/null; then
        runtime="docker"
        runtime_name="OrbStack"
        print_success "OrbStack detected"
    elif command -v docker &> /dev/null; then
        runtime="docker"
        runtime_name="Docker"
        print_info "Docker detected"
    else
        print_error "No container runtime found"
        echo ""
        echo "For macOS, we recommend OrbStack:"
        echo "  brew install --cask orbstack"
        echo ""
        echo "Or install Docker Desktop:"
        echo "  https://www.docker.com/products/docker-desktop"
        echo ""
        print_info "Alternatively, use './control.sh host' for local mode"
        exit 1
    fi
    
    echo ""
    print_info "Starting with Docker..."
    echo ""
    
    # Validate paths are absolute
    if [[ ! "$WORKSPACE_PATH" = /* ]]; then
        print_error "WORKSPACE_PATH must be absolute: $WORKSPACE_PATH"
        print_info "Please run './control.sh setup' to fix"
        exit 1
    fi
    
    # Export for docker-compose
    export WORKSPACE_PATH CONFIG_PATH DATA_PATH
    
    # Start services
    docker-compose -f "$COMPOSE_FILE" --profile full up -d
    
    echo ""
    print_success "Services started!"
    echo ""
    echo "Commands:"
    echo "  ./control.sh status  - Check status"
    echo "  ./control.sh logs    - View logs"
    echo "  ./control.sh stop    - Stop services"
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
        echo "  Workspace: ${WORKSPACE_PATH:-Not set}"
        echo "  Config:    ${CONFIG_PATH:-Not set}"
        echo "  Data:      ${DATA_PATH:-Not set}"
    else
        print_warning ".env not configured"
        echo "  Run: ./control.sh setup"
    fi
    
    echo ""
    
    # Check Docker containers
    if command -v docker &> /dev/null; then
        echo -e "${CYAN}Docker Containers${NC}"
        echo "------------------------------"
        
        if docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -q "opencode"; then
            docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep "opencode"
            echo ""
            
            # Check OpenCode health
            if docker exec opencode-server wget -q --spider http://localhost:4096/global/health 2>/dev/null; then
                print_success "OpenCode server: Healthy"
            else
                print_warning "OpenCode server: Starting..."
            fi
        else
            print_info "No containers running"
        fi
    fi
    
    echo ""
    
    # Check host mode
    echo -e "${CYAN}Host Mode${NC}"
    echo "------------------------------"
    if pgrep -f "node.*standalone.js" > /dev/null; then
        print_success "Telegram Bot: Running (PID: $(pgrep -f "node.*standalone.js"))"
    else
        print_info "Telegram Bot: Not running"
    fi
    
    # Check OpenCode server
    print_info "Checking OpenCode server..."
    
    # Try without password first
    if curl -s "${OPENCODE_SERVER_URL}/global/health" > /dev/null 2>&1; then
        # No password required
        OPENCODE_AUTH=""
        health=$(curl -s "${OPENCODE_SERVER_URL}/global/health" 2>/dev/null)
        version=$(echo "$health" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
        print_success "OpenCode server running (v${version}, no password)"
    elif curl -s -u "opencode:${OPENCODE_PASSWORD}" "${OPENCODE_SERVER_URL}/global/health" > /dev/null 2>&1; then
        # Password required and correct
        OPENCODE_AUTH="-u opencode:${OPENCODE_PASSWORD}"
        health=$(curl -s -u "opencode:${OPENCODE_PASSWORD}" "${OPENCODE_SERVER_URL}/global/health" 2>/dev/null)
        version=$(echo "$health" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
        print_success "OpenCode server running (v${version}, password protected)"
    elif [ -n "${OPENCODE_PASSWORD}" ]; then
        # Password provided but auth failed
        print_error "OpenCode server authentication failed"
        print_info "Check OPENCODE_PASSWORD in .env"
        exit 1
    else
        # No password provided and auth required
        print_warning "OpenCode server requires password"
        print_info "Add OPENCODE_PASSWORD to .env file"
        exit 1
    fi
    
    echo ""
    echo -e "${CYAN}Quick Actions${NC}"
    echo "------------------------------"
    if [ -f "$ENV_FILE" ]; then
        echo "  ./control.sh host    - Start locally"
        echo "  ./control.sh docker  - Start with Docker"
    fi
    echo "  ./control.sh setup   - Reconfigure"
}

# Stop command
cmd_stop() {
    print_header
    
    print_info "Stopping services..."
    echo ""
    
    # Stop Docker containers
    if command -v docker &> /dev/null; then
        if docker ps | grep -q "opencode"; then
            docker-compose -f "$COMPOSE_FILE" --profile full down
            print_success "Docker containers stopped"
        else
            print_info "No Docker containers running"
        fi
    fi
    
    # Stop host mode
    if pgrep -f "node.*standalone.js" > /dev/null; then
        pkill -f "node.*standalone.js"
        print_success "Host mode process stopped"
    fi
    
    echo ""
    print_success "All services stopped"
}

# Logs command
cmd_logs() {
    if command -v docker &> /dev/null && docker ps | grep -q "opencode"; then
        # Docker mode
        docker-compose -f "$COMPOSE_FILE" logs -f
    else
        # Host mode - no persistent logs
        print_warning "Host mode doesn't have persistent logs"
        print_info "Use './control.sh host' to see logs in real-time"
    fi
}

# Restart command
cmd_restart() {
    cmd_stop
    echo ""
    echo "Restarting..."
    echo ""
    sleep 2
    
    if command -v docker &> /dev/null && docker ps | grep -q "opencode"; then
        cmd_docker
    else
        cmd_host
    fi
}

# Shell command
cmd_shell() {
    if [ -z "$1" ]; then
        echo "Usage: ./control.sh shell [opencode|telegram]"
        exit 1
    fi
    
    case "$1" in
        opencode)
            docker exec -it opencode-server sh
            ;;
        telegram)
            docker exec -it opencode-telegram sh
            ;;
        *)
            print_error "Unknown container: $1"
            echo "Available: opencode, telegram"
            exit 1
            ;;
    esac
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
    
    if command -v docker &> /dev/null; then
        docker-compose -f "$COMPOSE_FILE" build
    fi
    
    print_success "Update complete!"
    echo ""
    echo "Start with: ./control.sh docker or ./control.sh host"
}

# Pair command - generate pairing code
cmd_pair() {
    print_header
    
    local is_host_mode=false
    local is_docker_mode=false
    
    if pgrep -f "node.*standalone.js" > /dev/null 2>&1; then
        is_host_mode=true
    fi
    
    if command -v docker &> /dev/null && docker ps --format "{{.Names}}" | grep -q "opencode-telegram"; then
        is_docker_mode=true
    fi
    
    if [[ "$is_host_mode" == "false" && "$is_docker_mode" == "false" ]]; then
        print_error "Bot is not running"
        print_info "Start with: ./control.sh host or ./control.sh docker"
        exit 1
    fi
    
    cd "$SCRIPT_DIR"
    
    if [[ "$is_docker_mode" == "true" ]]; then
        docker exec opencode-telegram node -e "
            const fs = require('fs');
            const crypto = require('crypto');
            
            const whitelistFile = '/app/data/whitelist.json';
            let data = { users: [], groups: [], pairingCodes: [] };
            
            if (fs.existsSync(whitelistFile)) {
                try {
                    data = JSON.parse(fs.readFileSync(whitelistFile, 'utf8'));
                } catch(e) {}
            }
            
            const code = crypto.randomBytes(4).toString('hex').toUpperCase();
            const now = new Date();
            const expiresAt = new Date(now.getTime() + 2 * 60 * 1000);
            
            data.pairingCodes.push({
                code,
                createdAt: now.toISOString(),
                expiresAt: expiresAt.toISOString()
            });
            
            fs.mkdirSync('/app/data', { recursive: true });
            fs.writeFileSync(whitelistFile, JSON.stringify(data, null, 2));
            
            console.log('📋 New Pairing Code: ' + code);
            console.log('');
            console.log('Share this code with the user or group to authorize.');
            console.log('They should send: /pair ' + code);
            console.log('');
            console.log('Valid for 2 minutes.');
        "
    else
        load_env
        local whitelist_file="${WHITELIST_FILE:-${SCRIPT_DIR}/data/whitelist.json}"
        node -e "
            const fs = require('fs');
            const crypto = require('crypto');
            
            const whitelistFile = '$whitelist_file';
            let data = { users: [], groups: [], pairingCodes: [] };
            
            if (fs.existsSync(whitelistFile)) {
                try {
                    data = JSON.parse(fs.readFileSync(whitelistFile, 'utf8'));
                } catch(e) {}
            }
            
            const code = crypto.randomBytes(4).toString('hex').toUpperCase();
            const now = new Date();
            const expiresAt = new Date(now.getTime() + 2 * 60 * 1000);
            
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
            console.log('Valid for 2 minutes.');
        "
    fi
}

# Whitelist command - manage whitelist
cmd_whitelist() {
    local action="${1:-list}"
    
    case "$action" in
        list|"")
            if [ -f "${SCRIPT_DIR}/data/whitelist.json" ]; then
                node -e "
                    const fs = require('fs');
                    const data = JSON.parse(fs.readFileSync('./data/whitelist.json', 'utf8'));
                    
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
                const file = './data/whitelist.json';
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
    
    echo "Unified Control Script for OpenCode Telegram Plugin"
    echo ""
    echo "Usage: ./control.sh [command]"
    echo ""
    echo "Commands:"
    echo "  setup      Interactive configuration setup (run first)"
    echo "  host       Start in host mode (requires opencode serve)"
    echo "  docker     Start with Docker/OrbStack"
    echo "  status     Check service status"
    echo "  stop       Stop all services"
    echo "  logs       View logs (Docker mode only)"
    echo "  restart    Restart services"
    echo "  shell      Open shell in container (opencode|telegram)"
    echo "  update     Update and rebuild"
    echo "  pair       Generate pairing code for authorization"
    echo "  whitelist  Manage whitelist (list|remove)"
    echo "  help       Show this help"
    echo ""
    echo "Security:"
    echo "  By default, only authorized users can use the bot."
    echo "  Run './control.sh pair' to generate a pairing code."
    echo "  New users must send '/pair <code>' to authorize."
    echo ""
    echo "Quick Start:"
    echo "  1. ./control.sh setup    # Configure"
    echo "  2. ./control.sh pair     # Generate pairing code"
    echo "  3. ./control.sh host     # Start locally"
    echo "  4. Send /pair <code> in Telegram"
    echo ""
    echo "Examples:"
    echo "  ./control.sh pair                    # Generate pairing code"
    echo "  ./control.sh whitelist               # Show whitelist"
    echo "  ./control.sh whitelist remove user 123456"
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
        docker|start)
            cmd_docker
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
        shell)
            cmd_shell "$2"
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
