#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

OS="$(uname -s)"

echo "=========================================="
echo "OpenCode Telegram Plugin - Setup"
echo "=========================================="
echo ""

# Function to expand path
expand_path() {
    local path="$1"
    path="${path/#\~/$HOME}"
    if [[ "$OS" == "Darwin" ]]; then
        realpath "$path" 2>/dev/null || echo "$path"
    else
        readlink -f "$path" 2>/dev/null || echo "$path"
    fi
}

# Load existing values from .env
load_existing() {
    if [ -f ".env" ]; then
        source .env 2>/dev/null || true
    fi
}

# Load from global config
load_global_config() {
    local global_config="$HOME/.config/agent-toolkits/opencode-telegram.env"
    if [ -f "$global_config" ]; then
        source "$global_config" 2>/dev/null || true
        return 0
    fi
    return 1
}

# Show current value
show_current() {
    local var_name="$1"
    local current_value="${!var_name}"
    if [ -n "$current_value" ]; then
        echo -e "${CYAN}Current: $current_value${NC}"
    fi
}

# Check configs
config_source=""
if [ -f ".env" ]; then
    config_source="local"
    echo -e "${YELLOW}⚠ Found local configuration (.env)${NC}"
    load_existing
elif load_global_config; then
    config_source="global"
    echo -e "${YELLOW}⚠ Found global configuration (~/.config/agent-toolkits)${NC}"
fi

if [ -n "$config_source" ]; then
    echo ""
fi

# Step 1: Telegram Bot Token
echo -e "${BLUE}Step 1: Telegram Bot Token${NC}"
show_current TELEGRAM_BOT_TOKEN
read -p "Token (from @BotFather): " bot_token
bot_token="${bot_token:-$TELEGRAM_BOT_TOKEN}"

if [ -z "$bot_token" ]; then
    echo -e "${RED}✗ Bot token is required${NC}"
    exit 1
fi

# Step 2: OpenCode Password (optional)
echo ""
echo -e "${BLUE}Step 2: OpenCode Server Password${NC}"
echo "Optional: Press Enter to skip"
read -p "Password: " opencode_password

# Use existing if empty
opencode_password="${opencode_password:-$OPENCODE_PASSWORD}"

# Step 3: Workspace Path
echo ""
echo -e "${BLUE}Step 3: Workspace Directory${NC}"
echo "Your project directory (mounted to /workspace in container)"
read -p "Path (default: ./workspace): " workspace_input
workspace_path="${workspace_input:-${WORKSPACE_PATH:-./workspace}}"
WORKSPACE_PATH=$(expand_path "$workspace_path")

if [ ! -d "$WORKSPACE_PATH" ]; then
    echo -e "${YELLOW}⚠ Directory not found: $WORKSPACE_PATH${NC}"
    read -p "Create it? (y/N): " create_dir
    if [[ "$create_dir" =~ ^[Yy]$ ]]; then
        mkdir -p "$WORKSPACE_PATH"
        echo -e "${GREEN}✓ Created${NC}"
    fi
fi

# Step 4: Config Path
echo ""
echo -e "${BLUE}Step 4: OpenCode Config${NC}"
show_current CONFIG_PATH
read -p "Path [~/.config/opencode]: " config_input
CONFIG_PATH=$(expand_path "${config_input:-${CONFIG_PATH:-~/.config/opencode}}")

if [ ! -d "$CONFIG_PATH" ]; then
    echo -e "${YELLOW}⚠ Not found: $CONFIG_PATH${NC}"
fi

# Step 5: Data Path
echo ""
echo -e "${BLUE}Step 5: OpenCode Session Data${NC}"
show_current DATA_PATH
read -p "Path [~/.local/share/opencode]: " data_input
DATA_PATH=$(expand_path "${data_input:-${DATA_PATH:-~/.local/share/opencode}}")

if [ -f "$DATA_PATH/opencode.db" ]; then
    echo -e "${GREEN}✓ Database found${NC}"
else
    echo -e "${YELLOW}⚠ Database not found${NC}"
fi

# Summary
echo ""
echo "=========================================="
echo -e "${BLUE}Configuration Summary${NC}"
echo "=========================================="
echo "Bot Token: ${bot_token:0:20}..."
echo "Password: ${opencode_password:+****}${opencode_password:-(none)}"
echo "Workspace: $WORKSPACE_PATH"
echo "Config: $CONFIG_PATH"
echo "Data: $DATA_PATH"
echo ""

read -p "Save configuration? (Y/n): " confirm
if [[ "$confirm" =~ ^[Nn]$ ]]; then
    echo "Setup cancelled"
    exit 0
fi

# Create .env
cat > .env << EOF
# Telegram
TELEGRAM_BOT_TOKEN=$bot_token
TELEGRAM_MODE=polling

# OpenCode (password optional)
OPENCODE_SERVER_URL=http://localhost:4096
OPENCODE_USERNAME=opencode
OPENCODE_PASSWORD=${opencode_password}

# Paths
WORKSPACE_PATH=$WORKSPACE_PATH
CONFIG_PATH=$CONFIG_PATH
DATA_PATH=$DATA_PATH

# Session
SESSION_STORAGE=file
SESSION_FILE_PATH=/app/data/sessions.json
SESSION_TTL=86400

# App
LOG_LEVEL=info
MAX_MESSAGE_LENGTH=4000
CODE_BLOCK_TIMEOUT=120000
EOF

mkdir -p data shared

echo ""
echo -e "${GREEN}✓ Configuration saved!${NC}"
echo ""
echo "Commands:"
echo "  ./control.sh host   - Start locally"
echo "  ./control.sh docker - Start with Docker"
echo "  ./control.sh status - Check status"
