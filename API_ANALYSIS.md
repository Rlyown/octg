# OpenCode Serve API 分类分析

## 📊 API 端点分类

### ✅ 适合作为 TG Bot 命令（用户主动调用）

这些 API 适合做成 `/command` 形式，用户需要时手动调用：

| 端点 | 建议命令 | 用途 |
|------|---------|------|
| `GET /config` | `/config` | 查看当前配置 |
| `PATCH /config` | `/config-set <key>=<value>` | 修改配置 |
| `GET /provider` | `/providers` | 列出所有提供商 |
| `GET /session/status` | `/status-all` | 查看所有会话状态 |
| `GET /session/:id/children` | `/children` | 查看子会话 |
| `POST /session/:id/init` | `/init` | 分析应用创建 AGENTS.md |
| `GET /find/symbol` | `/symbol <查询>` | 查找工作区符号 |
| `GET /file/status` | `/git-status` | 查看 Git 状态 |
| `GET /experimental/tool/ids` | `/tools` | 列出可用工具 ID |
| `POST /log` | `/log <消息>` | 写入日志到 OpenCode |
| `POST /instance/dispose` | `/dispose` | 释放当前实例 |

### 🔄 需要后台自动处理（不适合作为命令）

这些 API 需要后台监听/自动响应，不适合用户手动调用：

| 端点 | 处理方式 | 原因 |
|------|---------|------|
| `GET /global/event` | **SSE 后台监听** | 全局事件流，需要持续监听 |
| `GET /event` | **SSE 后台监听** | 服务器事件流，实时推送消息 |
| `POST /session/:id/prompt_async` | **自动使用** | 异步发送，无需等待响应，适合后台 |
| `POST /session/:id/permissions/:permissionID` | **权限请求处理器** | 当 OpenCode 请求权限时自动弹出 TG 确认 |
| `GET /tui/control/next` | **TUI 控制后台** | 等待控制请求，需要轮询或长连接 |
| `POST /tui/control/response` | **自动响应** | 响应控制请求，配合上面的端点使用 |

### ❌ 不适合 TG Bot（技术限制或不适用）

| 端点 | 原因 |
|------|------|
| `GET /provider/auth` + OAuth | OAuth 需要浏览器跳转，不适合 TG Bot |
| `POST /provider/:id/oauth/authorize` | 同上，需要浏览器 |
| `POST /provider/:id/oauth/callback` | 回调需要 Web 服务器接收 |
| `GET /lsp` | LSP 状态主要用于 IDE/TUI 显示 |
| `GET /formatter` | 格式化器状态，TG Bot 不需要 |
| `GET /mcp` | MCP 服务器状态，TG Bot 不需要 |
| `POST /mcp` | 添加 MCP 服务器需要复杂配置 |
| `GET /experimental/tool` | 工具 schemas 主要用于编程 |
| `POST /tui/append-prompt` | 需要配合 TUI 实时交互 |
| `POST /tui/submit-prompt` | 同上 |
| `POST /tui/clear-prompt` | TUI 特定操作 |
| `POST /tui/execute-command` | TUI 特定操作 |
| `POST /tui/open-help` | TUI 特定操作 |
| `PUT /auth/:id` | 设置认证凭证敏感，不适合 TG |
| `GET /doc` | OpenAPI 规范，TG Bot 不需要 |

---

## 🎯 推荐实现优先级

### 高优先级（新增 11 个命令）

```typescript
// 配置管理
/config          - GET /config
/config-set      - PATCH /config

// 提供商和状态
/providers       - GET /provider
/status-all      - GET /session/status
/children        - GET /session/:id/children

// 项目初始化
/init            - POST /session/:id/init

// 代码导航
/symbol          - GET /find/symbol

// Git 集成
/git-status      - GET /file/status

// 工具
/tools           - GET /experimental/tool/ids

// 日志
/log             - POST /log

// 实例管理
/dispose         - POST /instance/dispose
```

### 后台自动处理（3 个组件）

1. **SSE 事件监听器**
   - 监听 `GET /event`
   - 当有新消息时推送到 Telegram
   - 需要后台任务

2. **权限请求处理器**
   - 监听权限请求事件
   - 在 Telegram 发送确认按钮
   - 用户确认后调用 `POST /session/:id/permissions/:permissionID`

3. **异步消息发送**
   - 长消息使用 `POST /session/:id/prompt_async`
   - 不阻塞 Telegram 响应

### 不建议实现

- OAuth 相关（3 个端点）- 需要浏览器
- TUI 控制输入（5 个端点）- 太复杂，使用 `/tui-*` 命令足够
- LSP/Formatter/MCP（4 个端点）- TG Bot 不需要
- `/doc` - 不需要

---

## 📈 最终统计

当前状态：
- 已实现：35 个端点
- 建议新增命令：11 个端点
- 建议后台处理：6 个端点
- 不建议实现：18 个端点

如果全部实现：
- **TG Bot 命令**：46 个（35 + 11）
- **后台组件**：3 个（SSE、权限、异步）
- **覆盖率**：85%（46/54 可用端点）
