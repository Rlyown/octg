# OpenCode Telegram Plugin

Standalone Telegram Bot for OpenCode Server. Supports both Host deployment and Docker deployment with local configuration and project path mounting.

## Features

- 💻 **Standalone Mode**: Runs as independent Node.js application
- 🔗 **HTTP API**: Connects to `opencode serve` via REST API
- 🐳 **Docker Support**: Full Docker Compose setup
- 📁 **Local Config Mount**: Uses your existing OpenCode configuration
- 👥 **Multi-User**: Each Telegram user gets separate OpenCode session
- 💾 **Persistent Sessions**: File-based or in-memory session storage

## Quick Start

### 1. Prerequisites

- Node.js 18+ (for host deployment)
- Docker & Docker Compose (for docker deployment)
- Telegram Bot Token ([@BotFather](https://t.me/botfather))
- OpenCode installed (`opencode serve` available)

### 2. Installation

```bash
# Clone or download
cd opencode-telegram-plugin

# Install dependencies
npm install

# Build
npm run build
```

### 3. Configuration

Copy example environment file:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Required
TELEGRAM_BOT_TOKEN=your_bot_token
OPENCODE_PASSWORD=your_opencode_password

# Optional
WORKSPACE_PATH=/path/to/your/project  # For Docker
```

## Deployment Options

### Option A: Host Deployment (Local Development)

**Terminal 1 - Start OpenCode Server:**

```bash
cd /path/to/your/project

export OPENCODE_SERVER_PASSWORD="your-password"
opencode serve --port 4096 --hostname 127.0.0.1
```

**Terminal 2 - Start Telegram Plugin:**

```bash
cd opencode-telegram-plugin

export TELEGRAM_BOT_TOKEN="your-token"
export OPENCODE_SERVER_URL="http://127.0.0.1:4096"
export OPENCODE_PASSWORD="your-password"

npm start
```

### Option B: Docker Deployment (Production)

**1. Configure environment:**

```bash
cp .env.example .env

# Edit .env
TELEGRAM_BOT_TOKEN=your_bot_token
OPENCODE_PASSWORD=your_password
WORKSPACE_PATH=/absolute/path/to/your/project
```

**2. Start services:**

```bash
docker-compose up -d
```

This will:
- Start `opencode serve` in a container
- Start Telegram Plugin in another container
- Mount your local workspace to OpenCode
- Mount your OpenCode config (optional)
- Persist session data in Docker volume

**3. View logs:**

```bash
# All services
docker-compose logs -f

# Just Telegram plugin
docker-compose logs -f telegram-plugin

# Just OpenCode
docker-compose logs -f opencode
```

**4. Stop:**

```bash
docker-compose down
```

## Project Structure with Docker

```
your-project/
├── .opencode/              # Your OpenCode config (mounted)
├── src/                    # Your code (mounted)
└── opencode-telegram-plugin/  # This plugin
    ├── docker-compose.yml
    ├── Dockerfile
    └── .env
```

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/start` | Start using the bot | `/start` |
| `/help` | Show help | `/help` |
| `/status` | Check OpenCode status | `/status` |
| `/sessions` | List all OpenCode sessions | `/sessions` |
| `/attach <id>` | Attach to existing session | `/attach abc123` |
| `/newsession` | Create new session | `/newsession` |
| `/ls [path]` | List files | `/ls src` |
| `/cat <file>` | Read file | `/cat README.md` |
| `/code <desc>` | Generate code | `/code React button` |
| `/run <cmd>` | Execute command | `/run git status` |
| `/shell <cmd>` | Run shell command | `/shell ls -la` |
| `/todos` | List todos | `/todos` |

## Configuration Options

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | Required |
| `TELEGRAM_MODE` | `polling` or `webhook` | `polling` |
| `TELEGRAM_ALLOWED_USER_IDS` | Comma-separated user IDs | (allow all) |
| `OPENCODE_SERVER_URL` | OpenCode HTTP URL | `http://localhost:4096` |
| `OPENCODE_PASSWORD` | Server password | Required |
| `SESSION_STORAGE` | `memory` or `file` | `memory` |
| `WORKSPACE_PATH` | Path to mount in Docker | `./workspace` |
| `CONFIG_PATH` | OpenCode config path | `~/.config/opencode` |

### Config File

You can also use a JSON config file (loaded from `./config.json` or path in `TELEGRAM_PLUGIN_CONFIG`):

```json
{
  "telegram": {
    "botToken": "your-token",
    "mode": "polling"
  },
  "opencode": {
    "serverUrl": "http://localhost:4096",
    "password": "your-password"
  }
}
```

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Telegram User   │────▶│ Telegram Cloud   │────▶│ Telegram Plugin  │
└──────────────────┘     └──────────────────┘     └────────┬─────────┘
                                                          │ HTTP
┌──────────────────┐     ┌──────────────────◀────────────┘
│  Your Project    │◀────│  opencode serve  │
│  (workspace)     │     │  (:4096)         │
└──────────────────┘     └──────────────────┘
```

## Development

```bash
# Install dependencies
npm install

# Development mode with hot reload
npm run dev

# Build
npm run build

# Type check
npm run typecheck
```

## Troubleshooting

**Cannot connect to OpenCode:**
```bash
# Check if opencode serve is running
curl -u opencode:your-password http://localhost:4096/global/health

# Should return: {"healthy":true,"version":"x.x.x"}
```

**Docker: Workspace not found:**
- Ensure `WORKSPACE_PATH` in `.env` is an absolute path
- Example: `/Users/username/projects/my-project`

**Session not persisting:**
- Set `SESSION_STORAGE=file` to persist across restarts
- Check that `data/` directory is writable

## License

MIT
