# OpenCode Telegram Plugin - Volume Mount 详解

## 数据共享架构

```
主机 (Host)                          容器 (Container)
├─ ~/.config/opencode/      ────►   ├─ /root/.config/opencode/
│   ├─ config.json                    │   ├─ config.json
│   ├─ themes/                        │   ├─ themes/
│   └─ providers/                     │   └─ providers/
│                                      │
├─ ~/.local/share/opencode/  ────►   ├─ /root/.local/share/opencode/
│   ├─ opencode.db  ◄── Session       │   ├─ opencode.db
│   ├─ auth.json                      │   ├─ auth.json
│   └─ storage/                       │   └─ storage/
│                                      │
├─ /your/project/           ────►   ├─ /workspace/
│   ├─ src/                           │   ├─ src/
│   ├─ package.json                   │   ├─ package.json
│   └─ README.md                      │   └─ README.md
│                                      │
└─ ./shared/                ────►   └─ /shared/
    (双向共享)                            (双向共享)
```

## Volume 详解

### 1. 工作目录 (WORKSPACE_PATH) - 必需 ⭐

**主机路径**: 你的项目目录
**容器路径**: `/workspace`
**用途**: 代码、文件编辑、Git 操作

```yaml
volumes:
  - ${WORKSPACE_PATH}:/workspace
```

**示例**:
```bash
# .env
WORKSPACE_PATH=/Users/voidchen/projects/my-app

# 效果
# 主机: /Users/voidchen/projects/my-app/src/main.ts
# 容器: /workspace/src/main.ts
```

**使用场景**:
- `/ls` 列出项目文件
- `/cat README.md` 查看代码
- `/code 修改 src/main.ts` AI 编辑代码
- `/run git status` Git 操作

---

### 2. 配置目录 (CONFIG_PATH) - 可选

**主机路径**: `~/.config/opencode/`
**容器路径**: `/root/.config/opencode/`
**权限**: 只读 (`:ro`)
**用途**: 模型配置、主题、providers

```yaml
volumes:
  - ${CONFIG_PATH:-~/.config/opencode}:/root/.config/opencode:ro
```

**包含文件**:
- `config.json` - 主配置
- `themes/` - 自定义主题
- `providers/` - API 提供商配置

**注意**: 敏感信息(API keys)建议通过环境变量传入，不要硬编码在配置文件中

---

### 3. Session 数据 (DATA_PATH) - 可选但推荐 ⭐⭐

**主机路径**: `~/.local/share/opencode/`
**容器路径**: `/root/.local/share/opencode/`
**用途**: **Session 数据库，用于 `/attach` 命令**

```yaml
volumes:
  - ${DATA_PATH:-~/.local/share/opencode}:/root/.local/share/opencode
```

**关键文件**:
- `opencode.db` - SQLite 数据库，包含所有 sessions
- `auth.json` - 认证信息
- `storage/` - 其他数据

**为什么重要**:

```bash
# 如果不挂载
主机: opencode serve (sessions: abc123, def456)
容器: opencode serve (sessions: 空)
Bot: /attach abc123
结果: ❌ Session not found

# 如果挂载
主机: opencode serve (sessions: abc123, def456)
容器: opencode serve (sessions: abc123, def456)  ← 共享数据库
Bot: /attach abc123
结果: ✅ Attached successfully
```

---

### 4. 共享目录 (shared-data) - 可选

**主机路径**: `./shared/`
**容器路径**: `/shared/`
**用途**: 双向文件共享

```yaml
volumes:
  - ./shared:/shared
```

**使用场景**:
- 从容器导出文件到主机
- 从主机导入文件到容器
- 临时文件交换

---

## Attach 工作原理

### 场景: TUI → Telegram 无缝切换

```bash
# 1. 主机 TUI 中工作
$ opencode
(opencode TUI) 
Session: abc123 (SQLite 存储在 ~/.local/share/opencode/opencode.db)
消息: 10

# 2. 部署 Telegram Bot (挂载 DATA_PATH)
export DATA_PATH=~/.local/share/opencode
export WORKSPACE_PATH=/path/to/project
docker-compose up -d

# 3. Telegram 中
User: /sessions
Bot: 📋 Available Sessions:
     1. abc123... - My Project (10 messages) ← 能看到主机的 session！

User: /attach abc123
Bot: ✅ Attached to session abc123...

User: 继续之前的工作
Bot: (AI 知道上下文，从第 11 条消息继续)
```

### 数据库共享验证

```bash
# 1. 检查主机数据库
sqlite3 ~/.local/share/opencode/opencode.db ".tables"
# 输出: sessions messages ...

# 2. 检查容器数据库 (应该相同)
docker-compose exec opencode sqlite3 /root/.local/share/opencode/opencode.db ".tables"
# 输出: sessions messages ...

# 3. 对比数据
sqlite3 ~/.local/share/opencode/opencode.db "SELECT id, title FROM sessions LIMIT 5;"
docker-compose exec opencode sqlite3 /root/.local/share/opencode/opencode.db "SELECT id, title FROM sessions LIMIT 5;"
# 结果应该一致！
```

---

## 完整配置示例

### .env

```bash
# Telegram
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...

# OpenCode
OPENCODE_PASSWORD=secure_password

# Paths - 使用绝对路径！
WORKSPACE_PATH=/Users/voidchen/projects/my-project
CONFIG_PATH=/Users/voidchen/.config/opencode
DATA_PATH=/Users/voidchen/.local/share/opencode
```

### docker-compose.yml 关键部分

```yaml
services:
  opencode:
    volumes:
      # 工作目录
      - ${WORKSPACE_PATH}:/workspace
      # 配置 (只读)
      - ${CONFIG_PATH}:/root/.config/opencode:ro
      # Session 数据 (关键！)
      - ${DATA_PATH}:/root/.local/share/opencode
  
  telegram-plugin:
    volumes:
      # 插件自己的数据
      - telegram-data:/app/data
      # 共享目录
      - shared-data:/shared
```

---

## 故障排查

### 问题 1: /attach 显示 "Session not found"

**原因**: DATA_PATH 未正确挂载

**解决**:
```bash
# 1. 检查环境变量
export DATA_PATH=~/.local/share/opencode
echo $DATA_PATH  # 应该是绝对路径

# 2. 检查目录存在
ls -la ~/.local/share/opencode/opencode.db

# 3. 重启服务
docker-compose down
docker-compose up -d

# 4. 验证挂载
docker-compose exec opencode ls -la /root/.local/share/opencode/
```

### 问题 2: 工作目录为空

**原因**: WORKSPACE_PATH 是相对路径

**解决**:
```bash
# 错误
WORKSPACE_PATH=./my-project

# 正确
WORKSPACE_PATH=/Users/voidchen/projects/my-project
```

### 问题 3: 权限错误

**解决**:
```bash
# 修复权限
chmod 755 ~/.local/share/opencode
chmod 644 ~/.local/share/opencode/opencode.db

# 或使用 sudo (不推荐)
sudo chown -R $USER:$USER ~/.local/share/opencode
```

---

## OrbStack 特殊配置

OrbStack 在 Mac 上与 Docker Desktop 完全兼容，但有一些优化：

```yaml
networks:
  opencode-network:
    driver: bridge
    driver_opts:
      com.docker.network.driver.mtu: 1450  # OrbStack 优化
```

### OrbStack 快速验证

```bash
# 启动
make up

# OrbStack 会自动检测挂载
orb list
# 输出:
# CONTAINER          STATUS
# opencode-server    running
# opencode-telegram  running
```

---

## 安全建议

### 敏感数据处理

**不要挂载的文件**:
- `~/.local/share/opencode/auth.json` (包含 API keys)

**推荐做法**:
```yaml
# 通过环境变量传入敏感信息
environment:
  - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
  - OPENAI_API_KEY=${OPENAI_API_KEY}

# 只挂载非敏感配置
volumes:
  - ${CONFIG_PATH}/themes:/root/.config/opencode/themes:ro
  - ${CONFIG_PATH}/config.json:/root/.config/opencode/config.json:ro
```

---

## 总结

| Volume | 必需 | 用途 | Attach 支持 |
|--------|------|------|-------------|
| `WORKSPACE_PATH` | ✅ | 代码、项目文件 | - |
| `CONFIG_PATH` | ❌ | 配置、主题 | - |
| `DATA_PATH` | ⭐⭐ | **Session 数据库** | **必需** |
| `shared-data` | ❌ | 文件交换 | - |

**关键点**:
1. **DATA_PATH 必须挂载** 才能使用 `/attach` 连接到已有 sessions
2. **使用绝对路径** 避免挂载失败
3. **Session 数据是 SQLite 数据库**，不是配置文件
4. **所有 containers 共享同一个数据库文件**
