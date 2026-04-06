# OpenCode Telegram Plugin - Host Paths

## Local Paths Used by the Plugin

- `WORKSPACE_PATH`
  - Your project directory
  - Used for file access, code edits, and shell commands
- `CONFIG_PATH`
  - Usually `~/.config/opencode`
  - Used for OpenCode configuration
- `DATA_PATH`
  - Usually `~/.local/share/opencode`
  - Used for OpenCode session data such as `opencode.db`
- `WHITELIST_FILE`
  - Usually `~/.config/agent-toolkits/opencode-telegram-data/whitelist.json`
  - Used for pairing and authorization state

## Why `DATA_PATH` Matters

The Telegram plugin reads the same OpenCode session data as your local `opencode serve` process.
That is what allows commands like `/sessions` and `/attach` to work against your existing local sessions.

## Example Configuration

```bash
TELEGRAM_BOT_TOKEN=123456:ABC-DEF
OPENCODE_PASSWORD=secure_password
WORKSPACE_PATH=/Users/voidchen/projects/my-project
CONFIG_PATH=/Users/voidchen/.config/opencode
DATA_PATH=/Users/voidchen/.local/share/opencode
```

## Verifying Session Data

```bash
sqlite3 ~/.local/share/opencode/opencode.db ".tables"
sqlite3 ~/.local/share/opencode/opencode.db "SELECT id, title FROM sessions LIMIT 5;"
```

## Common Problems

### `/attach` says session not found

- Check that `DATA_PATH` points to the same OpenCode data directory used by your local `opencode serve`

### Workspace path is wrong

- Use an absolute path for `WORKSPACE_PATH`

### Permission errors

```bash
chmod 755 ~/.local/share/opencode
chmod 644 ~/.local/share/opencode/opencode.db
```
