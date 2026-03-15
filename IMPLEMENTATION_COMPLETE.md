# ✅ Attach 功能实现完成

## 新增功能

### 1. `/attach [session-id]` - Attach 到现有 Session

**功能说明**:
- 连接到已有的 OpenCode Session
- 保留所有历史消息和上下文
- 支持从 TUI 无缝切换到 Telegram

**使用方法**:
```bash
# 查看所有可用 sessions
/attach

# 直接指定 session ID
/attach abc123def456
```

### 2. `/sessions` - 列出所有 Sessions

**功能说明**:
- 显示所有 OpenCode Sessions
- 标记当前使用的 Session
- 显示 Session 创建时间和标题

**使用方法**:
```bash
/sessions
```

## 代码变更

### 修改文件

1. **src/bot/handlers.ts**
   - 添加 `handleAttach()` 方法
   - 添加 `handleListSessions()` 方法
   - 注册 `/attach` 和 `/sessions` 命令

2. **README.md**
   - 更新命令列表

3. **UPDATE.md** (新增)
   - 详细功能说明文档

### 实现细节

```typescript
// /attach 命令处理
async handleAttach(ctx) {
  if (args.length === 0) {
    // 列出所有 sessions
    const sessions = await this.opencode.listSessions();
    // 显示列表
  } else {
    // Attach 到指定 session
    const sessionId = args[0];
    const session = await this.opencode.getSession(sessionId);
    // 创建新映射
    this.sessions.set({...});
  }
}

// /sessions 命令处理
async handleListSessions(ctx) {
  const sessions = await this.opencode.listSessions();
  // 显示所有 sessions，标记当前
}
```

## 使用场景

### 场景 1: TUI → Telegram
```
1. TUI: opencode (session: abc123)
2. Telegram: /attach abc123
3. 继续对话，历史保留
```

### 场景 2: 多 Session 管理
```
User: /sessions
Bot: 1. abc... - Project A 👈 当前
     2. def... - Project B
     3. xyz... - Test

User: /attach def
Bot: ✅ 已 attach 到 Project B
```

## 测试

### ✅ 编译测试
```bash
npm run build
# ✅ 无错误
```

### ✅ 单元测试
```bash
./test.sh
# ✅ 所有测试通过
```

### ✅ 代码验证
```bash
grep "handleAttach" dist/bot/handlers.js
# ✅ 方法已编译
```

## 部署

### Host 模式
```bash
export TELEGRAM_BOT_TOKEN="your-token"
export OPENCODE_PASSWORD="your-password"
node dist/standalone.js
```

### Host 模式
```bash
export TELEGRAM_BOT_TOKEN="your-token"
export OPENCODE_PASSWORD="your-password"
node dist/standalone.js
```

## 可用命令 (完整列表)

| 命令 | 描述 |
|------|------|
| `/start` | 开始使用 |
| `/help` | 显示帮助 |
| `/status` | 检查 OpenCode 状态 |
| **`/sessions`** | **列出所有 sessions** |
| **`/attach <id>`** | **Attach 到现有 session** |
| `/newsession` | 创建新 session |
| `/ls [path]` | 列出文件 |
| `/cat <file>` | 查看文件 |
| `/code <desc>` | 生成代码 |
| `/run <cmd>` | 执行命令 |
| `/shell <cmd>` | 执行 shell 命令 |
| `/todos` | 查看任务列表 |

## 下一步

现在你可以：
1. 使用 `/sessions` 查看所有 OpenCode sessions
2. 使用 `/attach <session-id>` 连接到正在使用的 session
3. 在 TUI 和 Telegram 之间无缝切换

**代码已准备好部署！** ✅
