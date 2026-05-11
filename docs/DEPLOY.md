# OpenCode Telegram Plugin - Host Deployment

## Quick Start

### 1. Prerequisites

- Node.js 18+
- Telegram Bot Token from @BotFather
- OpenCode installed locally

### 2. Configure

```bash
atk plugins telegram setup
```

### 3. Create an Instance

```bash
./manage-bots.sh add bot1
```

### 4. Start Services

#### Option A: Service Mode (Recommended)

```bash
./manage-bots.sh start bot1
```

Service mode uses:
- **macOS**: `launchd` with per-instance labels like `com.opencode.telegram.bot1`
- **Linux**: `systemd --user` with per-instance units like `opencode-telegram-bot1.service`

If the `opencode` binary is installed outside common service PATH locations, set `OPENCODE_BIN` in `instances/<name>/server.env` to its absolute path before starting the instance.

Check status:
```bash
./manage-bots.sh status bot1
```

View logs:
```bash
./manage-bots.sh logs bot1 bot
```

Stop:
```bash
./manage-bots.sh stop bot1
```

#### Option B: Foreground Mode

```bash
./control.sh --env-file instances/bot1/bot.env host
```

If the instance manages a local OpenCode server, you can also run it in foreground:

```bash
./opencode-server.sh --env-file instances/bot1/server.env fg
```

Foreground mode runs in the current terminal. Press `Ctrl+C` to stop.

## Makefile Commands

```bash
make run
make dev
make test
make update
make clean
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | - | Telegram bot token |
| `OPENCODE_PASSWORD` | Yes | - | OpenCode server password |
| `WORKSPACE_PATH` | No | `~/GitProject` | Default `opencode serve` working directory for managed local instances |
| `CONFIG_PATH` | No | `~/.config/opencode` | OpenCode config path |
| `DATA_PATH` | No | `~/.local/share/opencode` | OpenCode data path |

## Troubleshooting

### OpenCode server not reachable

```bash
curl -u opencode:your-password http://127.0.0.1:4096/global/health
```

### Workspace path should be absolute

```bash
WORKSPACE_PATH=/Users/username/projects/my-project
```

When `manage-bots.sh` creates a managed local instance, it writes `WORKSPACE_PATH` into `instances/<name>/server.env`.
If you do not override it during `add`, the default working directory is `~/GitProject`.

### Re-run setup

```bash
atk plugins telegram setup
```
