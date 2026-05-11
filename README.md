# OpenCode Telegram Plugin

Standalone Telegram Bot for OpenCode Server with multi-instance service deployment.

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

For a quick single-instance foreground setup, you can still copy `.env.example` to `.env` and use the foreground helpers.

For long-running service deployment, use `manage-bots.sh` instead.

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

`./control.sh` and `./opencode-server.sh` are now foreground/debug helpers only.
They no longer register background services.

## Deployment

### Host Deployment

**Using the Multi-Instance Manager (Recommended):**

```bash
# Create one instance
./manage-bots.sh add bot1

# Start one instance
./manage-bots.sh start bot1

# Start all configured instances
./manage-bots.sh start all

# Check status
./manage-bots.sh status

# View logs for one instance
./manage-bots.sh logs bot1 bot

# Generate a pairing code for one instance
./manage-bots.sh pair bot1

# Inspect or remove whitelist entries for one instance
./manage-bots.sh whitelist bot1
./manage-bots.sh whitelist bot1 remove user 123456789

# Stop one instance
./manage-bots.sh stop bot1
```

If `opencode` is not on a system service PATH like `/usr/local/bin` or `/opt/homebrew/bin`, set `OPENCODE_BIN` in `instances/<name>/server.env` to an absolute executable path.

**Manual Method - Terminal 1 - Start OpenCode Server:**

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

Using the foreground helper scripts:

```bash
# Create a local debug env
./control.sh setup

# Run the bot in foreground against the configured server
./control.sh host

# Or debug a managed instance
./control.sh --env-file instances/bot1/bot.env host
./opencode-server.sh --env-file instances/bot1/server.env fg
```

Other useful commands:

```bash
# Multi-instance service control
./manage-bots.sh list
./manage-bots.sh start all
./manage-bots.sh stop all
./manage-bots.sh status all
./manage-bots.sh logs bot1 bot

# Foreground helpers
./control.sh status
./control.sh logs
./opencode-server.sh --env-file instances/bot1/server.env status
```

## Commands

| Command                               | Description                                                | Example                       |
| ------------------------------------- | ---------------------------------------------------------- | ----------------------------- |
| `/start`                              | Start using the bot                                        | `/start`                      |
| `/help`                               | Show help                                                  | `/help`                       |
| `/status`                             | Check OpenCode status                                      | `/status`                     |
| `/sessions`                           | List sessions, search, paginate, or remove with subcommand | `/sessions`                   |
| `/sessions <index>`                   | Attach to a session by list index                          | `/sessions 3`                 |
| `/sessions <id-prefix>`               | Attach to a session by id prefix                           | `/sessions abc123`            |
| `/sessions remove <index\|id-prefix>` | Remove a session by list index or id prefix                | `/sessions remove 3`          |
| `/new [title]`                        | Create a new session                                       | `/new bugfix flow`            |
| `/cwd`                                | Show current directory                                     | `/cwd`                        |
| `/model`                              | Show current model override                                | `/model`                      |
| `/model list [provider]`              | List models locally via CLI                                | `/model list github-copilot`  |
| `/model <provider/model>`             | Set the model override for future messages                 | `/model packy-gpt/gpt-5.4`    |
| `/agents`                             | Show current agent override                                | `/agents`                     |
| `/agents list`                        | List agents locally via CLI                                | `/agents list`                |
| `/agents <name>`                      | Set the agent override for future messages                 | `/agents build`               |
| `/ls [path]`                          | List files                                                 | `/ls src`                     |
| `/cat <file>`                         | Read file                                                  | `/cat README.md`              |
| `/task <desc>`                        | Submit async task (long-running)                           | `/task create a React button` |
| `/shell <cmd>`                        | Run shell command                                          | `/shell ls -la`               |
| `/todos`                              | List todos                                                 | `/todos`                      |

## Configuration Options

### Environment Variables

| Variable                    | Description                        | Default                 |
| --------------------------- | ---------------------------------- | ----------------------- |
| `TELEGRAM_BOT_TOKEN`        | Bot token from @BotFather          | Required                |
| `TELEGRAM_MODE`             | `polling` or `webhook`             | `polling`               |
| `TELEGRAM_ALLOWED_USER_IDS` | Comma-separated user IDs           | (allow all)             |
| `OPENCODE_SERVER_URL`       | OpenCode HTTP URL                  | `http://localhost:4096` |
| `OPENCODE_PASSWORD`         | Server password                    | Required                |
| `SESSION_STORAGE`           | `memory` or `file`                 | `memory`                |
| `WORKSPACE_PATH`            | Local workspace path for context   | `./workspace`           |
| `CONFIG_PATH`               | OpenCode config path               | `~/.config/opencode`    |
| `DATA_PATH`                 | OpenCode session data path         | `~/.local/share/opencode` |
| `OPENCODE_PORT`             | OpenCode server port               | `4096`                  |
| `OPENCODE_HOSTNAME`         | OpenCode server hostname           | `127.0.0.1`             |
| `OPENCODE_CORS`             | CORS origin for web clients        | (disabled)              |

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
