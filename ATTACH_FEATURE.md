# Attach to Existing Session 功能设计

## 当前行为

```
Telegram User A
    ↓
插件自动创建新 OpenCode Session
    ↓
AI 对话（新 Session，无历史）
```

## 期望行为

```
Telegram User A
    ↓
/attach 命令
    ↓
列出所有已有 Sessions
    ↓
用户选择 Session ID
    ↓
Attach 到已有 Session
    ↓
AI 对话（保留历史）
```

## 实现方案

### 方案 1：/attach 命令（推荐）

添加 `/attach [session-id]` 命令：

```bash
# 列出所有可用 sessions
User: /attach
Bot: 📋 可用 Sessions:
     1. abc123... - My Project (5 消息)
     2. def456... - Test Session (12 消息)
     
     请回复数字选择，或直接使用 /attach <session-id>

# 直接指定 session ID
User: /attach abc123
Bot: ✅ 已 attach 到 session: abc123...
     📁 项目: My Project
     💬 消息数: 5
```

### 方案 2：自动检测最近 Session

如果用户没有活跃 session，自动列出最近的 sessions 供选择。

### 方案 3：Session 别名映射

允许用户给 session 设置别名：

```bash
/alias myproject abc123
/attach myproject
```

## API 支持

OpenCode API 已支持：
- `GET /session` - 列出所有 sessions
- `GET /session/:id` - 获取 session 详情
- `POST /session` - 创建新 session

## 代码修改建议

### 1. 添加 /attach 命令

```typescript
// handlers.ts
private async handleAttach(ctx: Context): Promise<void> {
  const message = ctx.message as Message.TextMessage;
  const args = message.text.split(' ').slice(1);
  
  if (args.length === 0) {
    // 列出所有 sessions
    const sessions = await this.opencode.listSessions();
    // 显示列表供选择
  } else {
    // 直接 attach 到指定 session
    const sessionId = args[0];
    await this.attachToSession(ctx.from.id.toString(), sessionId);
  }
}
```

### 2. 修改 SessionManager

```typescript
// session/manager.ts
async attachSession(
  telegramUserId: string, 
  openCodeSessionId: string
): Promise<void> {
  // 验证 session 存在
  const session = await this.opencode.getSession(openCodeSessionId);
  
  // 创建或更新映射
  this.set({
    telegramUserId,
    openCodeSessionId: session.id,
    // ... other fields
  });
}
```

### 3. 添加 Session 列表格式化

```typescript
// formatters.ts
export function formatSessionList(sessions: OpenCodeSession[]): string {
  return sessions.map((s, i) => 
    `${i + 1}. ${s.id.slice(0, 8)}... - ${s.title || 'Untitled'}`
  ).join('\n');
}
```

## 使用场景

### 场景 1：从 TUI 切换到 Telegram

1. 用户在 TUI 中工作，创建了 Session
2. 想在手机上继续，打开 Telegram
3. 使用 `/attach <session-id>` 连接到同一 Session
4. 所有历史消息和上下文都保留

### 场景 2：多设备同步

1. Telegram Bot 作为另一个客户端
2. 可以 attach 到任何活跃的 OpenCode Session
3. 消息通过 Telegram 发送，效果与 TUI 相同

### 场景 3：共享 Session

1. 多个 Telegram 用户可以 attach 到同一 OpenCode Session
2. 协作开发场景

## 注意事项

1. **Session 冲突**：如果多个用户 attach 到同一 session，同时发送消息可能导致冲突
2. **权限控制**：需要验证用户有权限访问该 session
3. **Session 过期**：如果 session 已被删除，attach 会失败

## 实现优先级

1. **高**：基础 `/attach <session-id>` 命令
2. **中**：`/attach` 无参数时列出 sessions
3. **低**：Session 别名功能

需要我实现这个功能吗？
