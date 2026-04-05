# 特殊 API 集成方案设计

## 1️⃣ SSE 事件流集成 (`GET /event`)

### 用途
实时监听 OpenCode 的事件流，将重要事件推送到 Telegram。

### 实现方案

```typescript
// 在 client.ts 中添加 SSE 支持
class OpenCodeClient {
  private eventSource: EventSource | null = null;

  // 启动 SSE 监听
  async startEventStream(callback: (event: any) => void): Promise<void> {
    const url = `${this.config.baseUrl}/event`;
    this.eventSource = new EventSource(url);

    this.eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      callback(data);
    };

    this.eventSource.onerror = (error) => {
      console.error('SSE error:', error);
    };
  }

  // 停止 SSE 监听
  stopEventStream(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}
```

### 需要推送到 Telegram 的事件类型

| 事件类型 | TG 消息示例 |
|---------|------------|
| `message.created` | "🤖 AI 回复了消息" |
| `session.permission.requested` | "🔐 需要权限确认: 删除文件?" |
| `session.completed` | "✅ 任务完成" |
| `session.error` | "❌ 会话出错: ..." |
| `tool.execution.started` | "🔧 开始执行工具: ..." |
| `tool.execution.completed` | "✅ 工具执行完成" |

### 注意事项
- SSE 连接需要保持长连接
- 断线需要自动重连
- 过滤不必要的事件，避免消息轰炸

---

## 2️⃣ 权限请求处理 (`POST /session/:id/permissions/:permissionID`)

### 用途
当 OpenCode 需要用户确认权限时（如删除文件、执行危险命令），在 Telegram 弹出确认按钮。

### 实现方案

```typescript
// 权限请求处理器
class PermissionHandler {
  private pendingPermissions: Map<string, {
    sessionId: string;
    permissionId: string;
    userId: string;
    description: string;
    messageId: number;
  }> = new Map();

  // 处理权限请求事件
  async handlePermissionRequest(event: {
    sessionID: string;
    permissionID: string;
    description: string;
  }): Promise<void> {
    const session = await this.getSession(event.sessionID);
    if (!session) return;

    // 在 Telegram 发送确认消息
    const message = await this.bot.telegram.sendMessage(
      session.telegramChatId,
      `🔐 权限请求\n\n${event.description}\n\n是否允许？`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ 允许', callback_data: `perm:allow:${event.permissionID}` },
            { text: '❌ 拒绝', callback_data: `perm:deny:${event.permissionID}` },
          ]],
        },
      }
    );

    // 保存到待处理权限列表
    this.pendingPermissions.set(event.permissionID, {
      sessionId: event.sessionID,
      permissionId: event.permissionID,
      userId: session.telegramUserId,
      description: event.description,
      messageId: message.message_id,
    });
  }

  // 处理用户响应
  async handlePermissionResponse(
    permissionId: string,
    allowed: boolean,
    remember: boolean = false
  ): Promise<void> {
    const pending = this.pendingPermissions.get(permissionId);
    if (!pending) return;

    // 调用 OpenCode API 响应权限请求
    await this.opencode.respondToPermission(
      pending.sessionId,
      permissionId,
      allowed,
      remember
    );

    // 更新 Telegram 消息状态
    await this.bot.telegram.editMessageText(
      pending.userId,
      pending.messageId,
      undefined,
      `${allowed ? '✅ 已允许' : '❌ 已拒绝'}\n\n${pending.description}`
    );

    this.pendingPermissions.delete(permissionId);
  }
}
```

### 集成到 handlers.ts

```typescript
// 在 setupHandlers 中添加权限响应处理
this.bot.action(/^perm:(allow|deny):(.+)$/, this.handlePermissionAction.bind(this));

private async handlePermissionAction(ctx: Context<Update.CallbackQueryUpdate>): Promise<void> {
  const match = ctx.match as RegExpMatchArray;
  const action = match[1]; // 'allow' or 'deny'
  const permissionId = match[2];

  await this.permissionHandler.handlePermissionResponse(
    permissionId,
    action === 'allow'
  );

  await ctx.answerCbQuery('权限已处理');
}
```

---

## 3️⃣ 异步消息发送 (`POST /session/:id/prompt_async`)

### 用途
对于长消息或不需要立即响应的操作，使用异步发送避免阻塞 Telegram。

### 实现方案

```typescript
// 在 client.ts 中
async sendMessageAsync(sessionId: string, text: string): Promise<void> {
  await this.request(`/session/${sessionId}/prompt_async`, {
    method: 'POST',
    body: JSON.stringify({ parts: [{ type: 'text', text }] }),
  });
}

// 在 handlers.ts 中，长消息自动使用异步
private async handleLongMessage(ctx: Context, text: string): Promise<void> {
  const processingMsg = await ctx.reply('🤔 处理中（可能需要较长时间）...');

  try {
    // 使用异步发送
    await this.opencode.sendMessageAsync(sessionId, text);

    // 等待一段时间让 AI 开始响应
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 查询最新消息
    const messages = await this.opencode.listMessages(sessionId, 5);
    // ... 处理并发送响应

    await ctx.deleteMessage(processingMsg.message_id);
  } catch (error) {
    await ctx.reply(`❌ 错误: ${error}`);
  }
}
```

---

## 4️⃣ TUI 控制输入（高级）

### 用途
通过 Telegram 直接控制 TUI 的输入和操作。

### 实现方案

```typescript
// 追加文本到 TUI 输入框
async tuiAppendPrompt(text: string): Promise<boolean> {
  return this.request('/tui/append-prompt', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

// 提交当前输入
async tuiSubmitPrompt(): Promise<boolean> {
  return this.request('/tui/submit-prompt', { method: 'POST' });
}

// 清除输入框
async tuiClearPrompt(): Promise<boolean> {
  return this.request('/tui/clear-prompt', { method: 'POST' });
}
```

### 可能的 Telegram 命令

- `/tui-append <文本>` - 追加文本到 TUI 输入框
- `/tui-submit` - 提交当前输入
- `/tui-clear` - 清空输入框

**评估**: 这些命令与现有的 `/tui-*` 命令重复度较高，且使用场景有限，暂不实现。

---

## 🎯 实施优先级

### P0 - 立即实施
1. **SSE 事件流监听** - 让 Telegram 能收到 AI 的实时响应
2. **权限请求处理** - 安全相关的关键功能

### P1 - 后续实施
3. **异步消息发送** - 优化长消息体验
4. **TUI 控制输入** - 增强 TUI 远程控制能力

---

## ⚠️ 技术挑战

### SSE 在 Node.js 中的实现
```typescript
// 使用 eventsource 库或原生 http 模块
import { EventSource } from 'eventsource';

// 需要注意:
// 1. 代理设置 (如果需要)
// 2. 重连逻辑
// 3. 错误处理
// 4. 连接管理（避免多个连接）
```

### 权限请求的时效性
- 权限请求通常有时效性（可能 30 秒超时）
- 需要在 Telegram 消息中显示倒计时
- 超时后自动拒绝并更新消息状态

### 事件过滤
- OpenCode 会产生大量事件
- 需要建立过滤机制，只推送用户关心的事件
- 可以配置哪些事件推送到 Telegram

---

## 📋 配置建议

```typescript
// 在 config.ts 中添加
interface AppConfig {
  // ... 现有配置

  // SSE 配置
  enableSSE: boolean;              // 是否启用事件推送
  sseEvents: string[];             // 允许推送的事件类型

  // 权限配置
  autoAllowPermissions: string[];  // 自动允许的权限类型
  permissionTimeout: number;       // 权限请求超时时间（秒）

  // 异步配置
  useAsyncForLongMessages: boolean; // 长消息使用异步
  longMessageThreshold: number;     // 长消息阈值（字符数）
}
```
