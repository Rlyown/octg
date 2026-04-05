# octg TODO

## Current unstable areas

- OpenCode `1.2.27` `serve` endpoint `POST /session/:id/command` returns HTTP 500 for slash commands.
- This affects forwarded slash-command behavior in general, not only `/agents`.
- Directly observed failing examples over `serve`: `help`, `model`, `cd`, `agents`, and unknown commands.

## Current workaround in octg

- Keep normal chat messages on `/session/:id/message`.
- Keep session management local in Telegram (`/sessions`, `/new`).
- Keep `/model` local: show current override, list models via local CLI, clear, set override.
- Keep `/agents` local: show current override, list agents via local CLI, clear, set override.
- Disable generic slash-command forwarding in Telegram until `serve /command` is stable.

## Backlog

- Retest `POST /session/:id/command` after upgrading OpenCode.
- Re-check whether command payload schema changed again in newer OpenCode versions.
- Re-test representative commands after upgrade:
  - `/help`
  - `/model`
  - `/agents`
  - `/cwd`
  - generic forwarded slash commands
- If `serve /command` becomes stable, consider restoring Telegram forwarding for selected commands.
- If `serve /command` remains unstable, evaluate whether ACP exposes a safer command-execution path.
- If neither `serve` nor ACP can support slash commands reliably, keep only local Telegram wrappers for high-value commands.

## Candidate future adaptations

- Add `/models` as a dedicated Telegram command instead of `/model list`.
- Validate `/agents <name>` against local `opencode agent list` output before saving.
- Add version-gated behavior so `octg` can enable forwarding only for OpenCode versions known to support it.
- Add a small runtime self-check on startup to detect whether `serve /command` is healthy.
