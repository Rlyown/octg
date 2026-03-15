# OpenCode Telegram Plugin - Universal Deployment

支持 Docker、OrbStack、Docker Compose 的通用部署方案。

## 快速开始

### 1. 环境准备

确保已安装以下任一工具：
- **Docker Desktop** (Windows/Mac/Linux)
- **OrbStack** (Mac - 推荐，更快更轻量)
- **Docker Engine** (Linux)

验证安装：
```bash
docker --version
docker-compose --version
```

### 2. 配置环境

```bash
cd plugins/opencode-telegram-plugin
cp .env.example .env

# 编辑 .env
TELEGRAM_BOT_TOKEN=your_bot_token
OPENCODE_PASSWORD=your_secure_password
WORKSPACE_PATH=/path/to/your/project
```

### 3. 启动服务

```bash
# 使用 Makefile（推荐）
make up

# 或使用 docker-compose 直接启动
docker-compose up -d
```

## 部署方式对比

| 方式 | 命令 | 适用场景 | 特点 |
|------|------|---------|------|
| **Host** | `make run` | 本地开发 | 直接运行，快速调试 |
| **Docker** | `make up` | 生产部署 | 完整容器化，隔离性好 |
| **OrbStack** | `make up` | Mac 用户 | 与 Docker 完全兼容，更快 |

## Makefile 命令

```bash
# 启动服务（Docker/OrbStack）
make up

# 停止服务
make down

# 查看日志
make logs

# 重启服务
make restart

# 查看状态
make status

# 本地运行（不启用 Docker）
make run

# 构建镜像
make build

# 清理数据
make clean
```

## OrbStack 特有优化

OrbStack 用户可以享受更快的启动速度和更低的资源占用：

```bash
# OrbStack 自动检测并优化
make up

# 查看 OrbStack 状态
orb list

# 快速访问容器
orb ssh opencode-telegram
```

## 配置详解

### 环境变量

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `TELEGRAM_BOT_TOKEN` | ✅ | - | Telegram Bot Token |
| `OPENCODE_PASSWORD` | ✅ | - | OpenCode 服务密码 |
| `WORKSPACE_PATH` | ✅ | `./workspace` | 本地项目路径 |
| `CONFIG_PATH` | ❌ | `~/.config/opencode` | OpenCode 配置路径 |
| `TELEGRAM_MODE` | ❌ | `polling` | polling 或 webhook |
| `SESSION_STORAGE` | ❌ | `memory` | session 存储方式 |

### Volume 挂载

```yaml
volumes:
  # 你的项目代码（必需）
  - ${WORKSPACE_PATH}:/workspace
  
  # OpenCode 配置（可选）
  - ${CONFIG_PATH}:/root/.config/opencode:ro
  
  # Session 数据持久化
  - telegram-data:/app/data
```

## 故障排查

### 检查服务状态
```bash
make status
```

### 查看日志
```bash
# 所有服务
make logs

# 仅 Telegram 插件
docker-compose logs -f telegram-plugin

# 仅 OpenCode
docker-compose logs -f opencode
```

### 常见问题

**1. Workspace 路径错误**
```bash
# 确保是绝对路径
WORKSPACE_PATH=/Users/username/projects/my-project
# 不是
WORKSPACE_PATH=./my-project
```

**2. 权限问题**
```bash
# 修复权限
sudo chown -R $USER:$USER ${WORKSPACE_PATH}
```

**3. OrbStack 特定问题**
```bash
# 重启 OrbStack
orb restart

# 重置 Docker 上下文
orb reset docker
```

## 高级配置

### 自定义 Docker Compose

创建 `docker-compose.override.yml`：

```yaml
version: '3.8'
services:
  opencode:
    environment:
      - CUSTOM_VAR=value
    volumes:
      - /extra/path:/extra
  
  telegram-plugin:
    environment:
      - LOG_LEVEL=debug
```

### 多项目部署

为不同项目创建独立配置：

```bash
# 项目 A
PROJECT_A_WORKSPACE=/path/to/project-a
make up

# 项目 B  
PROJECT_B_WORKSPACE=/path/to/project-b
docker-compose -f docker-compose.yml -f docker-compose.project-b.yml up -d
```

## 更新

```bash
# 拉取最新代码
git pull

# 重建镜像
make build

# 重启服务
make restart
```

## 卸载

```bash
# 停止并删除容器
make down

# 删除数据卷
docker volume rm opencode-telegram-plugin_telegram-data

# 删除镜像
docker rmi opencode-telegram-plugin
```

## 贡献

欢迎提交 PR 改进部署配置！
