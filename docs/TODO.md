# octg TODO

## Current unstable areas

| 名称 | 描述 | 优先级 |
|------|------|--------|
| `session管理` | 每个session配置根目录，project信息，对齐opencode server API； 对话开始时提示当前 session，或默认进入第一个session | 高 |
| `configer` | 当前启动脚本中涉及项目路径，白名单配置等路径，考虑在同一个agent下管理多个项目，因此白名单也只需要一个；另外opencode server启动有问题 | 高 |
| `对话支持富文本` | 当前启动脚本中涉及项目路径，白名单配置等路径，考虑在同一个agent下管理多个项目，因此白名单也只需要一个；另外opencode server启动有问题 | 高 |
| `POST /session/:id/command` 500 | OpenCode `1.2.27` `serve` endpoint 对 slash commands 返回 HTTP 500，影响所有转发的斜杠命令，包括 `help`、`model`、`cd`、`agents` 及未知命令 | 高 |

## Current workaround in octg

| 名称 | 描述 | 优先级 |
|------|------|--------|
| 普通对话走 `/message` | 保持 chat 消息走 `POST /session/:id/message` | - |
| session 管理本地化 | `/sessions`、`/new` 在 Telegram 侧本地处理 | - |
| `/model` 本地化 | 显示当前 override、本地列出模型、清除/设置 override | - |
| `/agents` 本地化 | 显示当前 override、本地列出 agents、清除/设置 override | - |
| 禁用 slash-command 转发 | 在 `serve /command` 稳定之前，禁用 Telegram 通用斜杠命令转发 | - |

## Backlog

| 名称 | 描述 | 优先级 |
|------|------|--------|
| 升级后重测 `/command` | 升级 OpenCode 后重新测试 `POST /session/:id/command` | 高 |
| 确认命令 payload schema | 检查新版 OpenCode 中命令 payload schema 是否再次变更 | 中 |
| 代表性命令回归测试 | 升级后重测 `/help`、`/model`、`/agents`、`/cwd` 及通用转发命令 | 中 |
| 恢复命令转发 | 若 `serve /command` 稳定，考虑为部分命令恢复 Telegram 转发 | 低 |
| 评估 ACP 路径 | 若 `serve /command` 持续不稳定，评估 ACP 是否提供更安全的命令执行路径 | 低 |
| 仅保留本地高价值命令 | 若 `serve` 和 ACP 均不可靠，只保留高价值命令的本地 Telegram wrapper | 低 |

## Candidate future adaptations

| 名称 | 描述 | 优先级 |
|------|------|--------|
| 独立 `/models` 命令 | 新增 `/models` 作为专用 Telegram 命令，替代 `/model list` | 低 |
| `/agents <name>` 校验 | 保存前对照本地 `opencode agent list` 输出校验 agent 名称 | 低 |
| 版本门控转发 | 添加版本判断，仅对已知支持 `/command` 的 OpenCode 版本启用转发 | 低 |
| 启动时自检 | 启动时自动检测 `serve /command` 是否健康 | 中 |
