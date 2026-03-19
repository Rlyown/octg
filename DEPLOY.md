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

### 3. Start OpenCode Server

```bash
export OPENCODE_SERVER_PASSWORD="your-password"
opencode serve --port 4096 --hostname 127.0.0.1
```

### 4. Start Telegram Plugin

#### Option A: Background Mode (Recommended)

```bash
atk plugins telegram start
```

Background mode uses:
- **macOS**: `launchd` via `~/Library/LaunchAgents/com.opencode.telegram.plist`
- **Linux with systemd**: user service via `~/.config/systemd/user/opencode-telegram.service`
- **Linux without systemd**: `nohup` with pid file

Check status:
```bash
atk plugins telegram status
```

View logs:
```bash
atk plugins telegram logs
```

Stop:
```bash
atk plugins telegram stop
```

#### Option B: Foreground Mode

```bash
atk plugins telegram host
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
| `WORKSPACE_PATH` | No | `~/GitProject` | Default `opencode serve` working directory for auto-start |
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

When `atk` auto-starts OpenCode, it now launches `opencode serve` inside `WORKSPACE_PATH`.
If you do not set it, the default working directory is `~/GitProject`.

### Re-run setup

```bash
atk plugins telegram setup
```
