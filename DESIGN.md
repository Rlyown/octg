# OpenCode Telegram Plugin 设计方案

## 概述

一个 OpenCode 插件，允许用户通过 Telegram Bot 与 OpenCode 进行远程交互，支持代码生成、文件查看、任务管理和命令执行等功能。

**支持两种运行模式：**
1. **Plugin 模式**：作为 OpenCode 插件运行（`opencode` 启动时加载）
2. **Standalone 模式**：独立运行，通过 HTTP API 连接 OpenCode Server（`opencode serve`）

**架构原则：一个 OpenCode 实例 ↔ 一个 Telegram Bot**

---

## 架构设计

### 1. 运行模式对比

| 特性 | Plugin 模式 | Standalone 模式 |
|------|-------------|-----------------|
| 启动方式 | `opencode` 自动加载 | `node dist/standalone.js` |
| OpenCode 运行 | CLI/TUI 模式 | `opencode serve` (headless) |
| 连接方式 | 进程内 API | HTTP API (localhost:4096) |
| 适用场景 | 本地开发、个人使用 | 远程部署、服务器运行 |
| 配置复杂度 | 低 | 中 |

### 2. 系统架构

#### 模式 A：Plugin 模式（进程内）

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户层 (Telegram)                          │
│  ┌─────────────┐                                               │
│  │ Telegram App│                                               │
│  └──────┬──────┘                                               │
└─────────┼────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────┐
│           Telegram Bot API (Cloud)           │
└────────────────────┬────────────────────────┘
                     │ Webhook / Long Polling
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OpenCode (CLI/TUI)                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Telegram Plugin (进程内)                      │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │   │
│  │  │ Bot Server   │  │ Command      │  │ OpenCode     │    │   │
│  │  │ (telegraf)   │  │ Router       │  │ Client       │    │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │   │
│  └─────────┼─────────────────┼─────────────────┼────────────┘   │
│            │                 │                 │                │
│            ▼                 ▼                 ▼                │
│     Telegram API      Plugin API        File System            │
│  (接收/发送消息)      (tools/hooks)     (工作目录)               │
└─────────────────────────────────────────────────────────────────┘
```

#### 模式 B：Standalone 模式（HTTP API）

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户层 (Telegram)                          │
│  ┌─────────────┐                                               │
│  │ Telegram App│                                               │
│  └──────┬──────┘                                               │
└─────────┼────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────┐
│           Telegram Bot API (Cloud)           │
└────────────────────┬────────────────────────┘
                     │ Webhook / Long Polling
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              Telegram Plugin (Standalone)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ Bot Server   │  │ Command      │  │ OpenCode     │           │
│  │ (telegraf)   │  │ Router       │  │ HTTP Client  │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         │                 │                 │                   │
│         ▼                 ▼                 │                   │
│  Telegram API       本地状态管理           │                   │
│                     (session/config)        │                   │
│                                           ▼                   │
│                              ┌─────────────────────────────┐   │
│                              │    HTTP API (:4096)         │   │
│                              │  (opencode serve)           │   │
│                              └─────────────┬───────────────┘   │
│                                            │                   │
└────────────────────────────────────────────┼───────────────────┘
                                             │
                                             ▼
                              ┌─────────────────────────────┐
│                              │      OpenCode Core          │
│                              │   (Tools, Hooks, Files)     │
│                              └─────────────────────────────┘
```

---

## OpenCode Server API 详解

基于官方文档 [OpenCode Server](https://opencode.ai/docs/server/)

### 1. 基础信息

**启动命令：**
```bash
opencode serve [--port <number>] [--hostname <string>] [--cors <origin>]
```

**默认配置：**
- 端口：`4096`
- 主机：`127.0.0.1`
- OpenAPI 文档：`http://localhost:4096/doc`

**认证：**
```bash
# 设置密码（HTTP Basic Auth）
export OPENCODE_SERVER_PASSWORD="your-password"
export OPENCODE_SERVER_USERNAME="opencode"  # 可选，默认 opencode

opencode serve
```

### 2. 核心 API 端点

#### 健康检查
```http
GET /global/health
```
响应：
```json
{
  "healthy": true,
  "version": "0.x.x"
}
```

#### Session 管理

**列出所有 Sessions：**
```http
GET /session
```
响应：`Session[]`

**创建新 Session：**
```http
POST /session
Content-Type: application/json

{
  "parentID": "optional-parent-id",
  "title": "optional-title"
}
```
响应：`Session`

**获取 Session 详情：**
```http
GET /session/:id
```

**删除 Session：**
```http
DELETE /session/:id
```

**获取 Session 的 Todo 列表：**
```http
GET /session/:id/todo
```
响应：`Todo[]`

#### 消息发送（核心）

**发送消息并等待响应：**
```http
POST /session/:id/message
Content-Type: application/json

{
  "messageID": "optional-id",
  "model": "anthropic/claude-sonnet-4-5",  // 可选
  "agent": "agent-id",  // 可选
  "noReply": false,  // 是否不需要回复
  "system": "optional-system-prompt",
  "tools": ["tool1", "tool2"],  // 可选工具
  "parts": [
    {
      "type": "text",
      "text": "你的消息内容"
    }
  ]
}
```

响应：
```json
{
  "info": { /* Message */ },
  "parts": [ /* Part[] */ ]
}
```

**异步发送消息（不等待）：**
```http
POST /session/:id/prompt_async
Content-Type: application/json

{
  "parts": [
    { "type": "text", "text": "你的消息" }
  ]
}
```
响应：`204 No Content`

**列出 Messages：**
```http
GET /session/:id/message?limit=50
```
响应：
```json
{
  "info": /* Message */,
  "parts": /* Part[] */
}[]
```

#### 命令执行

**执行 Slash Command：**
```http
POST /session/:id/command
Content-Type: application/json

{
  "messageID": "optional",
  "agent": "agent-id",
  "model": "model-id",
  "command": "/command-name",
  "arguments": ["arg1", "arg2"]
}
```

**执行 Shell 命令：**
```http
POST /session/:id/shell
Content-Type: application/json

{
  "agent": "agent-id",
  "model": "model-id",  // 可选
  "command": "ls -la"
}
```

#### 文件操作

**列出文件：**
```http
GET /file?path=<path>
```
响应：`FileNode[]`

**读取文件：**
```http
GET /file/content?path=<path>
```
响应：`FileContent`

**获取文件状态：**
```http
GET /file/status
```
响应：`File[]`

**搜索文件内容：**
```http
GET /find?pattern=<search-pattern>
```

**搜索文件/目录：**
```http
GET /find/file?query=<name>&type=file&limit=50
```

**搜索符号：**
```http
GET /find/symbol?query=<symbol-name>
```

#### 项目信息

**获取当前项目：**
```http
GET /project/current
```
响应：`Project`

**获取当前路径：**
```http
GET /path
```
响应：`Path`

**获取 VCS 信息：**
```http
GET /vcs
```
响应：`VcsInfo`

#### 配置

**获取配置：**
```http
GET /config
```
响应：`Config`

**更新配置：**
```http
PATCH /config
Content-Type: application/json

{
  "key": "value"
}
```

#### 事件流（SSE）

**全局事件：**
```http
GET /global/event
```
返回 Server-Sent Events 流

**事件流：**
```http
GET /event
```
第一个事件是 `server.connected`，然后是 bus events

### 3. 重要数据类型

```typescript
// Session
interface Session {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  // ...
}

// Message
interface Message {
  id: string;
  sessionID: string;
  role: 'user' | 'assistant' | 'system';
  createdAt: string;
  // ...
}

// Part (消息内容)
interface Part {
  type: 'text' | 'tool_use' | 'tool_result' | 'error';
  text?: string;
  // ...
}

// Todo
interface Todo {
  id: string;
  content: string;
  completed: boolean;
  // ...
}

// File
interface FileNode {
  path: string;
  name: string;
  isDirectory: boolean;
  // ...
}

interface FileContent {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
}
```

### 4. 使用示例

**完整对话流程：**
```typescript
class OpenCodeHTTPClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  
  constructor(config: { baseUrl: string; username?: string; password?: string }) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.username = config.username || 'opencode';
    this.password = config.password || '';
  }
  
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(options.headers);
    
    headers.set('Content-Type', 'application/json');
    
    // HTTP Basic Auth
    if (this.password) {
      const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      headers.set('Authorization', `Basic ${auth}`);
    }
    
    const response = await fetch(url, {
      ...options,
      headers,
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    
    return response.json();
  }
  
  // 健康检查
  async health(): Promise<{ healthy: boolean; version: string }> {
    return this.request('/global/health');
  }
  
  // 创建 Session
  async createSession(title?: string): Promise<Session> {
    return this.request('/session', {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
  }
  
  // 发送消息
  async sendMessage(sessionId: string, text: string): Promise<{ info: Message; parts: Part[] }> {
    return this.request(`/session/${sessionId}/message`, {
      method: 'POST',
      body: JSON.stringify({
        parts: [{ type: 'text', text }],
      }),
    });
  }
  
  // 执行命令
  async executeShell(sessionId: string, command: string): Promise<{ info: Message; parts: Part[] }> {
    return this.request(`/session/${sessionId}/shell`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  }
  
  // 获取 Todo 列表
  async getTodos(sessionId: string): Promise<Todo[]> {
    return this.request(`/session/${sessionId}/todo`);
  }
  
  // 读取文件
  async readFile(path: string): Promise<FileContent> {
    return this.request(`/file/content?path=${encodeURIComponent(path)}`);
  }
  
  // 列出文件
  async listFiles(path: string = ''): Promise<FileNode[]> {
    return this.request(`/file?path=${encodeURIComponent(path)}`);
  }
}
```

### 5. 与 Telegram Plugin 集成

**架构调整：**

```
Telegram User
    │
    ▼
Telegram Bot (Node.js)
    │
    ├───Session 管理 (内存或 Redis)
    │      ├── telegramUserId → opencodeSessionId 映射
    │      └── 认证状态
    │
    ▼
OpenCode HTTP Client
    │
    ├───POST /session (创建 session)
    ├───POST /session/:id/message (发送消息)
    ├───GET  /session/:id/todo (获取任务)
    ├───GET  /file/content (读取文件)
    └───POST /session/:id/shell (执行命令)
    │
    ▼
opencode serve (:4096)
    │
    ▼
OpenCode Core (AI, Tools, Files)
```

**关键映射：**
- 一个 Telegram User ↔ 一个 OpenCode Session
- Telegram 消息 → OpenCode `parts`
- OpenCode `parts` → Telegram 消息格式化

---

## 插件结构

```
opencode-telegram-plugin/
├── src/
│   ├── index.ts                    # Plugin 模式入口
│   ├── standalone.ts               # Standalone 模式入口
│   ├── config.ts                   # 配置管理（支持两种模式）
│   ├── types.ts                    # TypeScript 类型定义
│   │
│   ├── bot/                        # Telegram Bot 核心
│   │   ├── server.ts               # Bot 服务器（webhook/polling）
│   │   ├── session.ts              # Telegram 用户会话管理
│   │   └── webhook.ts              # Webhook 处理器
│   │
│   ├── opencode/                   # OpenCode 交互层
│   │   ├── plugin-client.ts        # Plugin 模式客户端（进程内）
│   │   ├── http-client.ts          # Standalone 模式客户端（HTTP）
│   │   └── types.ts                # OpenCode API 类型
│   │
│   ├── handlers/                   # 消息处理器
│   │   ├── commands.ts             # 命令路由
│   │   ├── code.ts                 # 代码生成与编辑
│   │   ├── files.ts                # 文件管理
│   │   ├── execute.ts              # 命令执行
│   │   └── messages.ts             # 自然语言消息
│   │
│   └── utils/                      # 工具函数
│       ├── logger.ts
│       └── validators.ts
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## 核心设计

### 1. 单用户架构

**原则：一个 OpenCode 实例只服务一个 Telegram 用户**

```
用户 A (Telegram)
    │
    │ 发送消息
    ▼
┌─────────────────────┐
│ Telegram Bot        │
│ (接收用户 A 的消息)  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ OpenCode 实例       │
│ (用户 A 的工作区)    │
└─────────────────────┘
```

**多用户方案：**
每个用户需要独立的部署：
```
用户 A → Bot A → OpenCode Instance A (工作区 A)
用户 B → Bot B → OpenCode Instance B (工作区 B)
用户 C → Bot C → OpenCode Instance C (工作区 C)
```

### 2. 会话管理

**Telegram 会话 vs OpenCode 会话**

```typescript
interface TelegramSession {
  telegramUserId: string;      // Telegram user ID
  telegramChatId: string;      // Telegram chat ID
  openCodeSessionId?: string;  // 关联的 OpenCode session
  createdAt: Date;
  lastActivity: Date;
}
```

**两种模式的会话策略：**

| 模式 | Session 管理 |
|------|--------------|
| Plugin | 复用 OpenCode 当前 session，通过 hooks 访问 |
| Standalone | 通过 HTTP API 创建/管理 OpenCode sessions |

### 3. 配置设计

```typescript
interface TelegramPluginConfig {
  // Bot 配置
  botToken: string;
  mode: 'webhook' | 'polling';
  webhookUrl?: string;
  webhookPort?: number;
  
  // 运行模式
  runtimeMode: 'plugin' | 'standalone';
  
  // Standalone 模式配置
  opencodeServerUrl?: string;      // http://localhost:4096
  opencodeUsername?: string;       // 默认 opencode
  opencodePassword?: string;       // OPENCODE_SERVER_PASSWORD
  
  // Plugin 模式配置
  allowedUserIds?: string[];       // 允许访问的 Telegram 用户
  
  // 通用配置
  workspaceRoot: string;
  sessionTimeout: number;
  maxResponseLength: number;
}
```

---

## 使用方式

### 方式 1：Plugin 模式（推荐本地使用）

**安装：**
```bash
# 安装插件到 OpenCode
mkdir -p ~/.config/opencode/plugins/telegram-plugin
cp -r dist/* ~/.config/opencode/plugins/telegram-plugin/

# 配置环境变量
export TELEGRAM_BOT_TOKEN="your_token"
export TELEGRAM_MODE="polling"
export TELEGRAM_ALLOWED_USER_IDS="123456789"

# 启动 OpenCode
opencode
```

**配置（~/.config/opencode/config.toml）：**
```toml
[plugins]
telegram = { enabled = true, token = "your_token", mode = "polling" }
```

### 方式 2：Standalone 模式（推荐服务器部署）

**启动 OpenCode Server：**
```bash
# 设置密码
export OPENCODE_SERVER_PASSWORD="your-secure-password"

# 启动 server
opencode serve --port 4096 --hostname 0.0.0.0

# 或使用配置文件
opencode serve --config opencode-server.toml
```

**启动 Telegram Plugin：**
```bash
# 配置环境变量
export TELEGRAM_BOT_TOKEN="your_token"
export TELEGRAM_MODE="webhook"
export TELEGRAM_WEBHOOK_URL="https://your-domain.com/webhook"
export OPENCODE_SERVER_URL="http://localhost:4096"
export OPENCODE_PASSWORD="your-secure-password"

# 启动插件
node dist/standalone.js
```

**Host 部署：**
```yaml
version: '3.8'

services:
  opencode:
    image: opencode/opencode:latest
    environment:
      - OPENCODE_SERVER_PASSWORD=${OPENCODE_SERVER_PASSWORD}
    command: ["serve", "--port", "4096", "--hostname", "0.0.0.0"]
    volumes:
      - ./workspace:/workspace
    ports:
      - "4096:4096"
    networks:
      - opencode-net
  
  telegram-plugin:
    build: .
    environment:
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - TELEGRAM_MODE=webhook
      - TELEGRAM_WEBHOOK_URL=${TELEGRAM_WEBHOOK_URL}
      - OPENCODE_SERVER_URL=http://opencode:4096
      - OPENCODE_PASSWORD=${OPENCODE_SERVER_PASSWORD}
    ports:
      - "3000:3000"
    depends_on:
      - opencode
    networks:
      - opencode-net

networks:
  opencode-net:
    driver: bridge
```

---

## 命令体系

### 基础命令

| 命令 | 描述 |
|------|------|
| `/start` | 初始化会话，显示欢迎信息 |
| `/help` | 显示帮助信息 |
| `/status` | 查看 OpenCode 状态 |
| `/workspace` | 显示当前工作目录 |

### 代码操作命令

| 命令 | 描述 | 示例 |
|------|------|------|
| `/code <desc>` | 生成代码 | `/code 创建一个React组件` |
| `/edit <file> <desc>` | 编辑文件 | `/edit src/App.tsx 添加dark mode` |
| `/review <file>` | 代码审查 | `/review src/utils.ts` |

### 文件操作命令

| 命令 | 描述 | 示例 |
|------|------|------|
| `/ls [path]` | 列出目录 | `/ls src/components` |
| `/cat <file>` | 查看文件内容 | `/cat README.md` |
| `/tree [depth]` | 目录树 | `/tree 2` |

### 执行命令

| 命令 | 描述 | 示例 |
|------|------|------|
| `/run <cmd>` | 执行 shell 命令 | `/run npm test` |
| `/git <cmd>` | Git 操作 | `/git status` |

---

## 两种模式的实现对比

### Plugin 模式客户端

```typescript
// opencode/plugin-client.ts
import type { Plugin } from "@opencode-ai/plugin";

export class PluginOpenCodeClient implements OpenCodeClient {
  private plugin: Plugin;
  
  async sendMessage(message: string, context?: any): Promise<string> {
    // 使用 plugin hooks/tools 调用 OpenCode
    // 通过 tool.execute 调用 opencode 功能
  }
  
  async executeCommand(command: string): Promise<CommandResult> {
    // 使用 tool.execute 调用 shell 命令
  }
}
```

### Standalone 模式客户端

```typescript
// opencode/http-client.ts

export class HttpOpenCodeClient implements OpenCodeClient {
  private baseUrl: string;
  private username: string;
  private password: string;
  
  constructor(config: { 
    baseUrl: string; 
    username?: string; 
    password?: string;
  }) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.username = config.username || 'opencode';
    this.password = config.password || '';
  }
  
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');
    
    if (this.password) {
      const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      headers.set('Authorization', `Basic ${auth}`);
    }
    
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  
  async sendMessage(sessionId: string, text: string) {
    return this.request(`/session/${sessionId}/message`, {
      method: 'POST',
      body: JSON.stringify({ parts: [{ type: 'text', text }] }),
    });
  }
  
  async executeShell(sessionId: string, command: string) {
    return this.request(`/session/${sessionId}/shell`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  }
  
  async getTodos(sessionId: string): Promise<Todo[]> {
    return this.request(`/session/${sessionId}/todo`);
  }
  
  async readFile(path: string) {
    return this.request(`/file/content?path=${encodeURIComponent(path)}`);
  }
  
  async listFiles(path: string = '') {
    return this.request(`/file?path=${encodeURIComponent(path)}`);
  }
}
```

---

## 开发计划

### Phase 1：Standalone 模式 MVP
- [ ] OpenCode HTTP Client 实现
- [ ] Telegram Bot 基础框架
- [ ] Session 管理（内存存储）
- [ ] 基础命令 (/start, /help, /status)
- [ ] 消息发送 (`POST /session/:id/message`)

### Phase 2：核心功能
- [ ] 文件操作 (`/ls`, `/cat`, `/tree`)
- [ ] Shell 命令执行 (`/run`, `/git`)
- [ ] Todo 管理 (`/todos`)
- [ ] 代码生成 (`/code`)

### Phase 3：Plugin 模式
- [ ] Plugin 入口实现
- [ ] Plugin Client 适配
- [ ] 双模式配置统一

### Phase 4：安全与优化
- [ ] 命令白名单
- [ ] 输入验证
- [ ] Redis Session 存储（可选）
- [ ] Host 部署体验优化

---

## 注意事项

### 1. Session 生命周期

**Standalone 模式需要手动管理 Session：**
- 用户首次使用 → `POST /session` 创建
- 用户持续对话 → 复用已有 session
- 用户退出/超时 → `DELETE /session/:id` 清理

### 2. 消息格式转换

**Telegram → OpenCode：**
```typescript
// Telegram 消息
const text = ctx.message.text;

// 转换为 OpenCode parts
const parts = [{ type: 'text', text }];
```

**OpenCode → Telegram：**
```typescript
// OpenCode response
const { parts } = await opencode.sendMessage(sessionId, text);

// 转换为 Telegram 消息
for (const part of parts) {
  if (part.type === 'text') {
    await ctx.reply(part.text);
  } else if (part.type === 'tool_use') {
    await ctx.reply(`🔧 使用工具: ${part.name}`);
  }
}
```

### 3. 长消息处理

Telegram 消息限制 4096 字符，需要分割：
```typescript
function splitMessage(text: string, maxLength: number = 4000): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += maxLength) {
    parts.push(text.slice(i, i + maxLength));
  }
  return parts;
}
```

---

## 参考资料

- [OpenCode Server API](https://opencode.ai/docs/server/)
- [OpenCode SDK](https://opencode.ai/docs/sdk/)
- [Telegraf Documentation](https://telegraf.js.org/)
- [Telegram Bot API](https://core.telegram.org/bots/api)

---

*设计方案 v3.0 - 2026-03-13*
*更新：添加完整的 OpenCode Server API 文档*
