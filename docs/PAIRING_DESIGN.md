# OpenCode Telegram Plugin - Pairing Code System

## 安全机制设计

### 核心概念

```
┌─────────────────────────────────────────────────────────┐
│                    首次使用流程                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. 用户发送 /start                                     │
│     Bot: "请提供配对码，使用 /pair <code>"              │
│                                                         │
│  2. 管理员在服务器查看配对码                             │
│     $ ./control.sh pair                                 │
│     📋 Current Pairing Code: ABCD1234                   │
│                                                         │
│  3. 用户发送配对码                                      │
│     /pair ABCD1234                                      │
│                                                         │
│  4. Bot 验证配对码                                      │
│     ✓ 配对成功，已添加到白名单                          │
│                                                         │
│  5. 后续对话                                            │
│     自动通过，无需再次配对                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 白名单存储

```json
// data/whitelist.json
{
  "users": [
    {
      "id": "123456789",
      "username": "voidchen",
      "pairedAt": "2026-03-15T10:30:00Z",
      "pairedBy": "ABCD1234"
    }
  ],
  "groups": [
    {
      "id": "-987654321",
      "title": "My Dev Group",
      "pairedAt": "2026-03-15T11:00:00Z",
      "pairedBy": "EFGH5678"
    }
  ],
  "pairingCodes": [
    {
      "code": "ABCD1234",
      "createdAt": "2026-03-15T10:00:00Z",
      "usedBy": "123456789",
      "usedAt": "2026-03-15T10:30:00Z"
    }
  ]
}
```

### Bot 命令

| 命令 | 描述 | 权限 |
|------|------|------|
| `/pair <code>` | 提供配对码进行授权 | 所有人 |
| `/start` | 开始对话（未授权时提示配对） | 所有人 |
| `/help` | 帮助（仅白名单用户可见详细命令） | 白名单用户 |

### Control 脚本命令

```bash
# 生成新配对码
./control.sh pair
# 输出: 📋 New Pairing Code: XXXXYYYY

# 查看白名单
./control.sh whitelist
# 输出:
# 📋 Whitelisted Users (2):
#    1. voidchen (123456789) - Paired: 2026-03-15
#    2. otheruser (987654321) - Paired: 2026-03-15
# 📋 Whitelisted Groups (1):
#    1. My Dev Group (-456789) - Paired: 2026-03-15

# 移除用户
./control.sh whitelist remove user 123456789

# 移除群组
./control.sh whitelist remove group -456789

# 查看配对码历史
./control.sh pair history
```

## 实现要点

1. **配对码生成**：8位字母数字随机字符串
2. **时效性**：配对码30分钟内有效
3. **一次性**：每个配对码只能使用一次
4. **审计日志**：记录谁、何时、通过哪个配对码授权
5. **持久化**：白名单存储在 data/whitelist.json

## 配置选项

```bash
# .env
# 是否启用配对码机制
ENABLE_PAIRING=true

# 配对码有效期（分钟）
PAIRING_CODE_TTL=30

# 白名单文件路径
WHITELIST_FILE=./data/whitelist.json
```
