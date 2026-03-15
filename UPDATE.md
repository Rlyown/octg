# OpenCode Telegram Plugin - 功能更新

## 新增命令

### `/attach [session-id]` - Attach 到现有 Session

**功能**: 连接到已有的 OpenCode Session，保留所有历史消息和上下文

**使用方式**:

```bash
# 方式 1: 列出所有可用 sessions
/attach

Bot 回复:
📋 可用 Sessions (3 个):

1. `abc123...` - My Project (2026-03-14)
2. `def456...` - Test Session (2026-03-13)
3. `xyz789...` - Bug Fix (2026-03-12)

使用 /attach <session-id> 连接到指定 session

# 方式 2: 直接指定 session ID
/attach abc123

Bot 回复:
✅ 已 attach 到 session

🆔 ID: `abc123...`
📌 标题: My Project
⏰ 创建时间: 2026/03/14 10:30:00
```

**使用场景**:
1. 从 TUI 切换到 Telegram，继续同一 Session
2. 恢复之前的工作
3. 多设备同步

---

### `/sessions` - 列出所有 Sessions

**功能**: 显示所有 OpenCode Sessions，并标记当前使用的 Session

**示例**:

```bash
/sessions

Bot 回复:
📋 OpenCode Sessions (3 个):

1. `abc123...` - My Project (2026-03-14) 👈 当前
2. `def456...` - Test Session (2026-03-13)
3. `xyz789...` - Bug Fix (2026-03-12)

使用 /attach <session-id> 切换 session
使用 /newsession 创建新 session
```

---

## 完整命令列表

| 命令 | 描述 | 示例 |
|------|------|------|
| `/start` | 开始使用 | `/start` |
| `/help` | 显示帮助 | `/help` |
| `/status` | 检查 OpenCode 状态 | `/status` |
| **`/sessions`** | **列出所有 sessions** | `/sessions` |
| **`/attach`** | **Attach 到现有 session** | `/attach abc123` |
| `/newsession` | 创建新 session | `/newsession` |
| `/ls [path]` | 列出文件 | `/ls src` |
| `/cat <file>` | 读取文件 | `/cat README.md` |
| `/code <desc>` | 生成代码 | `/code React button` |
| `/run <cmd>` | 执行命令 | `/run git status` |
| `/shell <cmd>` | 运行 shell 命令 | `/shell ls -la` |
| `/todos` | 列出任务 | `/todos` |

---

## 工作流程示例

### 场景 1: TUI → Telegram 切换

```bash
# 1. 在 TUI 中工作
$ opencode
(opencode TUI) Session: abc123, 消息: 10

# 2. 离开电脑，想在手机上继续
# 打开 Telegram Bot

# 3. Attach 到同一 session
User: /attach abc123
Bot: ✅ 已 attach 到 session: abc123...

# 4. 继续对话，历史保留
User: 继续之前的修改
Bot: (AI 知道上下文，继续对话)
```

### 场景 2: 多 Session 管理

```bash
# 查看所有 sessions
User: /sessions
Bot: 📋 OpenCode Sessions (3 个):
     1. `abc...` - Project A 👈 当前
     2. `def...` - Project B
     3. `xyz...` - Test

# 切换到另一个项目
User: /attach def
Bot: ✅ 已 attach 到 Project B

# 现在所有操作都在 Project B 的 session 中
User: /ls
Bot: (显示 Project B 的文件)
```

---

## 技术实现

### API 调用

```typescript
// 列出 sessions
GET /session → OpenCodeSession[]

// Attach 到 session
GET /session/:id → OpenCodeSession

// 验证 session 存在后创建映射
this.sessions.set({
  telegramUserId,
  openCodeSessionId: session.id,
  // ...
});
```

### Session 生命周期

```
Telegram User
    ↓
/sessions (查看所有)
    ↓
/attach abc123 (选择 session)
    ↓
Session 映射创建
    ↓
后续消息 → 该 Session
    ↓
/newsession (创建新 session)
    ↓
新映射替换旧映射
```

---

## 注意事项

1. **Session 验证**: Attach 时会验证 session 是否存在
2. **自动断开**: 切换 session 时自动断开旧的映射
3. **权限控制**: 受 `TELEGRAM_ALLOWED_USER_IDS` 限制
4. **消息同步**: Telegram 和 TUI 的消息是独立的（都发送到同一 OpenCode Session）

---

## 更新日志

### v1.1.0 (2026-03-14)

- ✅ 新增 `/attach` 命令 - Attach 到现有 session
- ✅ 新增 `/sessions` 命令 - 列出所有 sessions
- ✅ 支持 session ID 自动补全提示
- ✅ 显示 session 创建时间和标题
