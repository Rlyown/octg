import type { Context } from 'telegraf';
import type { Update } from 'telegraf/types';
import type { HandlerContext } from './index.js';

export class GeneralHandler {
  constructor(private hctx: HandlerContext) {}

  async handleStart(ctx: Context<Update.MessageUpdate>): Promise<void> {
    await ctx.reply(
      `👋 你好 ${ctx.from?.first_name || '用户'}!

我是 OpenCode Telegram Bot，可以帮助你：
💻 生成和编辑代码
📁 查看文件
🔍 搜索代码
⚡ 执行命令
✅ 管理任务
🎮 控制 TUI

使用 /new <绝对路径> [标题] 创建并绑定会话目录。

可用命令：
/sessions - 查看/切换/删除会话
/new <abs_path> [title] - 创建新会话并绑定目录
/remove <序号或id> - 删除会话
/rename <名称> - 重命名会话
/cwd - 查看当前目录
/projects - 列出项目
/model - 查看/设置模型
/agents - 查看/设置 agent
/task <描述> - 提交异步任务
/ls [路径] - 列出文件
/cat <文件> - 查看文件
/search <关键词> - 搜索代码
/findfile <文件名> - 查找文件
/diff - 查看变更
/history [数量] - 查看历史
/todos - 查看任务
/help - 显示完整帮助

也可以直接发送消息与我对话！`
    );
  }

  async handleHelp(ctx: Context<Update.MessageUpdate>): Promise<void> {
    await ctx.reply(
      `📖 命令帮助

基础命令：
/start - 开始使用
/help - 显示帮助
/status - 查看状态
/cwd - 查看当前目录
/projects - 列出所有项目
/commands - 列出 OpenCode 内置命令
/config - 查看当前配置
/providers - 列出模型提供商

会话管理：
/new <abs_path> [title] - 创建新会话并绑定目录
/remove <序号或id> - 删除会话
/sessions - 查看/切换/删除会话
/rename <名称> - 重命名会话
/fork [id] - 分叉会话
/abort - 中止会话
/share - 分享会话
/unshare - 取消分享
/diff [id] - 查看变更
/summarize - 总结会话
/status_all - 查看所有会话状态
/children - 查看子会话
/init - 分析项目创建 AGENTS.md

AI 设置：
/model - 查看/设置模型
/model list - 列出模型
/agents - 查看/设置 agent
/agents list - 列出 agent

文件操作：
/ls [path] - 列出文件
/cat <file> - 查看文件
/search <关键词> - 搜索文本
/findfile <文件名> - 查找文件
/symbol <查询> - 查找代码符号
/git_status - 查看 Git 状态

代码与执行：
/task <描述> - 提交异步任务
/shell <命令> - 执行 shell

任务与历史：
/todos - 查看任务
/history [数量] - 查看历史

工具：
/tools - 列出可用工具

提示：直接发送消息可以与 AI 对话`
    );
  }

  async handleCwd(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    try {
      const path = await this.hctx.opencode.getPath({ directory: session.directory });
      const text = typeof path === 'string' ? path : JSON.stringify(path);
      await ctx.reply(`📂 当前工作目录\n\n${text}`);
    } catch (error) {
      await ctx.reply(`❌ 获取目录失败: ${error}`);
    }
  }

  async handleTodos(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    try {
      const todos = await this.hctx.opencode.getTodos(session.openCodeSessionId, {
        directory: session.directory,
      });
      const { formatTodos } = await import('../formatters.js');
      await ctx.reply(formatTodos(todos));
    } catch (error) {
      await ctx.reply(`❌ 获取任务失败: ${error}`);
    }
  }

  async handleHistory(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    const { message } = ctx;
    const args = (message as any).text?.split(' ').slice(1) || [];
    const limit = args[0] ? parseInt(args[0], 10) : 20;

    try {
      const messages = await this.hctx.opencode.listMessages(session.openCodeSessionId, limit, {
        directory: session.directory,
      });
      if (messages.length === 0) {
        await ctx.reply('暂无历史消息');
        return;
      }

      const lines = messages.map((msg, index) => {
        const role = msg.info.role === 'user' ? '👤' : '🤖';
        const text = msg.parts.find(p => p.type === 'text')?.text || '';
        const preview = text.slice(0, 50).replace(/\n/g, ' ');
        return `${index + 1}. ${role} ${preview}${text.length > 50 ? '...' : ''}`;
      });

      await ctx.reply(`📜 历史消息 (最近 ${messages.length} 条)\n\n${lines.join('\n')}`);
    } catch (error) {
      await ctx.reply(`❌ 获取历史消息失败: ${error}`);
    }
  }

  async handleProjects(ctx: Context<Update.MessageUpdate>): Promise<void> {
    try {
      const projects = await this.hctx.opencode.listProjects();
      if (!Array.isArray(projects) || projects.length === 0) {
        await ctx.reply('暂无项目');
        return;
      }

      const lines = projects.slice(0, 20).map((p: any, index: number) => {
        const name = p.name || p.path || 'Unknown';
        const path = p.path || '';
        return `${index + 1}. ${name}\n   ${path}`;
      });

      const more = projects.length > 20 ? `\n\n... 还有 ${projects.length - 20} 个项目` : '';
      await ctx.reply(`📁 项目列表 (${projects.length})${more}\n\n${lines.join('\n\n')}`);
    } catch (error) {
      await ctx.reply(`❌ 获取项目列表失败: ${error}`);
    }
  }

  async handleCommands(ctx: Context<Update.MessageUpdate>): Promise<void> {
    try {
      const commands = await this.hctx.opencode.listCommands();
      if (!Array.isArray(commands) || commands.length === 0) {
        await ctx.reply('暂无命令');
        return;
      }

      const lines = commands.slice(0, 30).map((c: any, index: number) => {
        const name = c.name || c.command || 'Unknown';
        const desc = c.description || '';
        return `${index + 1}. /${name}${desc ? ` - ${desc}` : ''}`;
      });

      const more = commands.length > 30 ? `\n\n... 还有 ${commands.length - 30} 个命令` : '';
      await ctx.reply(`⚡ OpenCode 内置命令 (${commands.length})${more}\n\n${lines.join('\n')}`);
    } catch (error) {
      await ctx.reply(`❌ 获取命令列表失败: ${error}`);
    }
  }

  async handleConfig(ctx: Context<Update.MessageUpdate>): Promise<void> {
    try {
      const config = await this.hctx.opencode.getConfig();
      const lines = Object.entries(config as Record<string, unknown>).map(([key, value]) => {
        const displayValue = typeof value === 'object' ? JSON.stringify(value).slice(0, 50) + '...' : String(value).slice(0, 50);
        return `• ${key}: ${displayValue}`;
      });
      await ctx.reply(`⚙️ 当前配置\n\n${lines.slice(0, 20).join('\n')}`);
    } catch (error) {
      await ctx.reply(`❌ 获取配置失败: ${error}`);
    }
  }

  async handleProviders(ctx: Context<Update.MessageUpdate>): Promise<void> {
    try {
      const providers = await this.hctx.opencode.listProviders();
      if (!Array.isArray(providers) || providers.length === 0) {
        await ctx.reply('暂无提供商');
        return;
      }

      const lines = providers.slice(0, 20).map((p: any, index: number) => {
        const name = p.name || p.id || 'Unknown';
        const connected = p.connected ? '✅' : '❌';
        return `${index + 1}. ${connected} ${name}`;
      });

      const more = providers.length > 20 ? `\n\n... 还有 ${providers.length - 20} 个提供商` : '';
      await ctx.reply(`🔌 模型提供商 (${providers.length})${more}\n\n${lines.join('\n')}`);
    } catch (error) {
      await ctx.reply(`❌ 获取提供商列表失败: ${error}`);
    }
  }

  async handleStatusAll(ctx: Context<Update.MessageUpdate>): Promise<void> {
    try {
      const status = await this.hctx.opencode.getAllSessionStatus();
      const entries = Object.entries(status);
      if (entries.length === 0) {
        await ctx.reply('暂无会话状态');
        return;
      }

      const lines = entries.slice(0, 15).map(([id, s]: [string, any]) => {
        const state = s.state || 'unknown';
        const emoji = state === 'running' ? '🟢' : state === 'idle' ? '⚪' : '🔴';
        return `${emoji} ${id.slice(0, 8)}...: ${state}`;
      });

      const more = entries.length > 15 ? `\n\n... 还有 ${entries.length - 15} 个会话` : '';
      await ctx.reply(`📊 所有会话状态 (${entries.length})${more}\n\n${lines.join('\n')}`);
    } catch (error) {
      await ctx.reply(`❌ 获取会话状态失败: ${error}`);
    }
  }
}
