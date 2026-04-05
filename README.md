# OpenCode Telegram Plugin

Standalone Telegram Bot for OpenCode Server with host-based deployment.

## Features

- 💻 **Standalone Mode**: Runs as independent Node.js application
- 🔗 **HTTP API**: Connects to `opencode serve` via REST API
- 📁 **Local Config Mount**: Uses your existing OpenCode configuration
- 👥 **Multi-User**: Each Telegram user gets separate OpenCode session
- 💾 **Persistent Sessions**: File-based or in-memory session storage

## Quick Start

### 1. Prerequisites

- Node.js 18+ (for host deployment)
- Telegram Bot Token ([@BotFather](https://t.me/botfather))
- OpenCode installed (`opencode serve` available)

### 2. Installation

```bash
# Clone or download
cd octg

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

# Optional: default OpenCode auto-start working directory
WORKSPACE_PATH=~/GitProject
```

When `./control.sh host` auto-starts `opencode serve`, it uses `WORKSPACE_PATH`
as the server working directory. If unset, it defaults to `~/GitProject`.

## Deployment

### Host Deployment

**Terminal 1 - Start OpenCode Server:**

```bash
cd ~/GitProject

export OPENCODE_SERVER_PASSWORD="your-password"
opencode serve --port 4096 --hostname 127.0.0.1
```

**Terminal 2 - Start Telegram Plugin:**

```bash
cd octg

export TELEGRAM_BOT_TOKEN="your-token"
export OPENCODE_SERVER_URL="http://127.0.0.1:4096"
export OPENCODE_PASSWORD="your-password"

npm start
```

Using the provided control script:

```bash
# Interactive first-time setup
./control.sh setup

# Run in foreground
./control.sh host

# Or build and start directly
npm run build
npm start
```

Other useful commands:

```bash
./control.sh status
./control.sh logs
./control.sh restart
./control.sh stop
```

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/start` | Start using the bot | `/start` |
| `/help` | Show help | `/help` |
| `/status` | Check OpenCode status | `/status` |
| `/sessions` | List sessions, search, and paginate with buttons | `/sessions` |
| `/sessions <index>` | Attach to a session by list index | `/sessions 3` |
| `/sessions <id-prefix>` | Attach to a session by id prefix | `/sessions abc123` |
| `/new [title]` | Create a new session | `/new bugfix flow` |
| `/cwd` | Show current directory | `/cwd` |
| `/model` | Show current model override | `/model` |
| `/model list [provider]` | List models locally via CLI | `/model list github-copilot` |
| `/model <provider/model>` | Set the model override for future messages | `/model packy-gpt/gpt-5.4` |
| `/agents` | Show current agent override | `/agents` |
| `/agents list` | List agents locally via CLI | `/agents list` |
| `/agents <name>` | Set the agent override for future messages | `/agents build` |
| `/ls [path]` | List files | `/ls src` |
| `/cat <file>` | Read file | `/cat README.md` |
| `/code <desc>` | Generate code | `/code React button` |
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
| `WORKSPACE_PATH` | Local workspace path for context | `./workspace` |
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

**Workspace not found:**
- Ensure `WORKSPACE_PATH` in `.env` is an absolute path
- Example: `/Users/username/projects/my-project`

**Session not persisting:**
- Set `SESSION_STORAGE=file` to persist across restarts
- Check that `data/` directory is writable

## License

MIT
