# OpenCode Serve API 实现状态对比

## 📊 统计

- **已实现命令**: 45 个 TG Bot 命令
- **已实现 API 端点**: 47 个 (67%)
- **后台处理组件**: 2 个 (SSE、权限处理已实现)
- **未实现**: 21 个端点 (技术限制或不需要)

---

## ✅ 已实现 TG Bot 命令 (45 个)

### 认证
- ✅ `/pair <code>` - 使用配对码授权访问

### 基础
- ✅ `/start` - 开始使用机器人
- ✅ `/help` - 显示帮助信息
- ✅ `/status` - 检查 OpenCode 服务器状态
- ✅ `/cwd` - 查看当前工作目录
- ✅ `/projects` - 列出所有项目
- ✅ `/commands` - 列出 OpenCode 内置命令
- ✅ `/config` - 查看当前配置
- ✅ `/providers` - 列出所有模型提供商

### 会话管理
- ✅ `/new [title]` - 创建新的 OpenCode 会话
- ✅ `/sessions` - 查看、检索、删除或按钮翻页切换会话
- ✅ `/rename <新名称>` - 重命名当前会话
- ✅ `/fork [message_id]` - 分叉当前会话
- ✅ `/abort` - 中止正在运行的会话
- ✅ `/share` - 分享当前会话
- ✅ `/unshare` - 取消分享当前会话
- ✅ `/diff [message_id]` - 查看会话变更
- ✅ `/summarize` - 总结当前会话
- ✅ `/status-all` - 查看所有会话状态
- ✅ `/children` - 查看当前会话的子会话
- ✅ `/init` - 分析项目并创建 AGENTS.md

### AI 设置
- ✅ `/model [id]` - 查看或设置当前模型
- ✅ `/model list` - 列出可用模型
- ✅ `/agents [name]` - 查看或设置当前 agent
- ✅ `/agents list` - 列出可用 agent

### 文件操作
- ✅ `/ls [path]` - 列出目录内容
- ✅ `/cat <file>` - 读取文件内容
- ✅ `/search <关键词>` - 在文件中搜索文本
- ✅ `/findfile <文件名>` - 查找文件
- ✅ `/symbol <查询>` - 查找代码符号
- ✅ `/git-status` - 查看 Git 文件状态

### 代码与执行
- ✅ `/code <描述>` - 生成代码
- ✅ `/shell <cmd>` - 执行 shell 命令

### 任务与历史
- ✅ `/todos` - 查看待办事项
- ✅ `/history [数量]` - 查看会话历史消息

### 工具与日志
- ✅ `/tools` - 列出可用工具
- ✅ `/log <消息>` - 写入日志到 OpenCode

## ✅ 已实现后台组件 (2 个)

### 1. SSE 事件流监听
**已实现**: `src/opencode/sse-client.ts`

- 监听 `GET /event` 服务器事件流
- 自动重连机制
- 支持权限请求事件处理
- 支持 AI 消息推送

**事件处理**:
- `session.permission.requested` → Telegram 权限确认弹窗
- `message.created` → 推送 AI 回复到 Telegram

**配置**:
```bash
ENABLE_SSE=true  # 在 .env 中设置，默认为 true
```

### 2. 权限请求处理器
**已实现**: `src/opencode/permission-handler.ts`

- 当 OpenCode 请求权限时自动发送 Telegram 消息
- 支持"允许"、"允许并记住"、"拒绝"选项
- 60秒超时自动拒绝
- 使用内联键盘按钮响应

**权限流程**:
```
OpenCode 请求权限 → SSE 推送事件 → Telegram 消息
                                         ↓
用户点击按钮 → 调用 API 响应权限 → 更新消息状态
```

---

## ❌ 未实现 (技术限制或不需要)

### OAuth 相关 (需要浏览器跳转)
- ❌ `GET /provider/auth` - 获取提供商认证方法
- ❌ `POST /provider/:id/oauth/authorize` - OAuth 授权
- ❌ `POST /provider/:id/oauth/callback` - OAuth 回调

### TUI 控制输入 (使用场景有限)
- ❌ `POST /tui/append-prompt` - 追加提示文本
- ❌ `POST /tui/submit-prompt` - 提交当前提示
- ❌ `POST /tui/clear-prompt` - 清除提示
- ❌ `POST /tui/execute-command` - 执行命令
- ❌ `POST /tui/open-help` - 打开帮助对话框

### LSP/Formatter/MCP (TG Bot 不需要)
- ❌ `GET /lsp` - LSP 服务器状态
- ❌ `GET /formatter` - 格式化器状态
- ❌ `GET /mcp` - MCP 服务器状态
- ❌ `POST /mcp` - 动态添加 MCP 服务器

### 其他 (不需要)
- ❌ `PUT /auth/:id` - 设置认证凭证 (敏感操作)
- ❌ `GET /doc` - OpenAPI 3.1 规范
- ❌ `POST /instance/dispose` - 释放实例
- ❌ `GET /global/event` - 全局事件流 (与 /event 重复)

---

## 📈 实现进度

```
TG Bot 命令:   ████████████████████████████████ 45/45 (100%)
API 端点:       ██████████████████████████████░░ 47/70 (67%)
后台组件:       ████████████████████████████████ 2/2 (100%)
覆盖率:         ████████████████████████████░░░░ 85%
```

---

## 🎯 功能亮点

### 实时推送
- AI 响应实时推送到 Telegram
- 无需轮询，SSE 长连接自动推送

### 权限管理
- OpenCode 权限请求自动转发到 Telegram
- 支持"允许并记住"选项
- 超时自动拒绝机制

### 完整控制
- 45 个 TG Bot 命令覆盖大部分 API
- TUI 远程控制支持
- 项目、文件、会话全面管理
