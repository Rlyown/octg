import type { Context, Telegraf } from 'telegraf';
import type { Message, Update } from 'telegraf/types';
import { resolve } from 'path';
import type { OpenCodeClient } from '../opencode/client.js';
import type { SessionManager } from '../session/manager.js';
import type { PluginConfig, TelegramSession } from '../types.js';
import { WhitelistManager } from '../auth/whitelist.js';
import { formatCodeResponse, formatFileList, formatTodos } from './formatters.js';

export class BotHandlers {
  private bot: Telegraf;
  private opencode: OpenCodeClient;
  private sessions: SessionManager;
  private whitelist: WhitelistManager;
  private config: PluginConfig;

  constructor(
    bot: Telegraf,
    opencode: OpenCodeClient,
    sessions: SessionManager,
    config: PluginConfig
  ) {
    this.bot = bot;
    this.opencode = opencode;
    this.sessions = sessions;
    this.config = config;
    
    const whitelistFile = config.app.whitelistFile || './data/whitelist.json';
    const absoluteWhitelistFile = resolve(process.cwd(), whitelistFile);
    
    this.whitelist = new WhitelistManager(
      absoluteWhitelistFile,
      config.app.pairingCodeTtl || 2
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Pairing command (must be first, before whitelist check)
    this.bot.command('pair', this.handlePair.bind(this));

    // Commands with whitelist check
    this.bot.command('start', this.withWhitelist(this.handleStart.bind(this)));
    this.bot.command('help', this.withWhitelist(this.handleHelp.bind(this)));
    this.bot.command('status', this.withWhitelist(this.handleStatus.bind(this)));
    this.bot.command('newsession', this.withWhitelist(this.handleNewSession.bind(this)));
    this.bot.command('attach', this.withWhitelist(this.handleAttach.bind(this)));
    this.bot.command('sessions', this.withWhitelist(this.handleListSessions.bind(this)));

    // File operations
    this.bot.command('ls', this.withWhitelist(this.handleListFiles.bind(this)));
    this.bot.command('cat', this.withWhitelist(this.handleReadFile.bind(this)));
    this.bot.command('tree', this.withWhitelist(this.handleTree.bind(this)));

    // Code operations
    this.bot.command('code', this.withWhitelist(this.handleCode.bind(this)));

    // Execution
    this.bot.command('run', this.withWhitelist(this.handleRun.bind(this)));
    this.bot.command('shell', this.withWhitelist(this.handleShell.bind(this)));

    // Todos
    this.bot.command('todos', this.withWhitelist(this.handleTodos.bind(this)));

    // Natural language messages
    this.bot.on('text', this.withWhitelist(this.handleMessage.bind(this)));

    // Error handling
    this.bot.catch(this.handleError.bind(this));
  }

  private withWhitelist(handler: (ctx: Context<Update.MessageUpdate>) => Promise<void>) {
    return async (ctx: Context<Update.MessageUpdate>) => {
      const userId = ctx.from?.id.toString();
      const chatId = ctx.chat?.id.toString();
      const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
      
      if (!userId) return;

      // Check whitelist
      const idToCheck = isGroup ? chatId! : userId;
      const type = isGroup ? 'group' : 'user';

      if (!this.whitelist.isWhitelisted(idToCheck, type)) {
        // Not whitelisted, show pairing instructions
        await ctx.reply(
          `🔒 This bot is private.\n\n` +
          `To use this bot, you need a pairing code.\n\n` +
          `Ask the server administrator to run:\n` +
          `./control.sh pair\n\n` +
          `Then use the command:\n` +
          `/pair <code>`
        );
        return;
      }

      await handler(ctx);
    };
  }

  private async handlePair(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);
    
    if (args.length === 0) {
      await ctx.reply(
        `🔑 Pairing Command\n\n` +
        `Usage: /pair <code>\n\n` +
        `Get the pairing code from the server administrator.`
      );
      return;
    }

    const code = args[0];
    const userId = ctx.from?.id.toString();
    const chatId = ctx.chat?.id.toString();
    
    if (!userId || !chatId) return;

    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
    const idToCheck = isGroup ? chatId : userId;
    const type = isGroup ? 'group' : 'user';

    // Check if already whitelisted
    if (this.whitelist.isWhitelisted(idToCheck, type)) {
      await ctx.reply('✅ Already authorized!');
      return;
    }

    // Try to use pairing code
    const success = this.whitelist.usePairingCode(code, idToCheck, type, {
      username: ctx.from?.username,
      title: isGroup ? (ctx.chat as any).title : undefined,
    });

    if (success) {
      await ctx.reply(
        `✅ Pairing successful!\n\n` +
        `You can now use all bot commands.\n` +
        `Type /help to see available commands.`
      );
    } else {
      await ctx.reply(
        `❌ Invalid or expired pairing code.\n\n` +
        `Please check the code and try again, or ask the administrator for a new code.`
      );
    }
  }

  private async ensureSession(ctx: Context<Update.MessageUpdate>): Promise<TelegramSession | null> {
    const userId = ctx.from?.id.toString();
    const chatId = ctx.chat?.id.toString();

    if (!userId || !chatId) {
      await ctx.reply('无法获取用户信息');
      return null;
    }

    // Check allowed users
    if (this.config.telegram.allowedUserIds.length > 0) {
      if (!this.config.telegram.allowedUserIds.includes(userId)) {
        await ctx.reply('你没有权限使用此 Bot');
        return null;
      }
    }

    let session = this.sessions.get(userId);

    if (!session) {
      try {
        const openCodeSession = await this.opencode.createSession(
          `Telegram User ${userId}`
        );

        session = {
          telegramUserId: userId,
          telegramChatId: chatId,
          openCodeSessionId: openCodeSession.id,
          username: ctx.from?.username,
          firstName: ctx.from?.first_name,
          lastName: ctx.from?.last_name,
          createdAt: new Date(),
          lastActivity: new Date(),
        };

        this.sessions.set(session);
      } catch (error) {
        await ctx.reply(`创建会话失败: ${error}`);
        return null;
      }
    } else {
      this.sessions.updateActivity(userId);
    }

    return session;
  }

  private async handleStart(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    await ctx.reply(
      `👋 你好 ${ctx.from?.first_name || '用户'}!

我是 OpenCode Telegram Bot，可以帮助你：
💻 生成和编辑代码
📁 查看文件
⚡ 执行命令
✅ 管理任务

可用命令：
/code <描述> - 生成代码
/ls [路径] - 列出文件
/cat <文件> - 查看文件
/run <命令> - 执行命令
/todos - 查看任务列表
/help - 显示帮助

也可以直接发送消息与我对话！`
    );
  }

  private async handleHelp(ctx: Context<Update.MessageUpdate>): Promise<void> {
    await ctx.reply(
      `📖 命令帮助

基础命令：
/start - 开始使用
/help - 显示帮助
/status - 查看 OpenCode 状态
/newsession - 创建新会话

文件操作：
/ls [路径] - 列出目录文件
/cat <文件路径> - 查看文件内容
/tree - 显示目录树

代码操作：
/code <描述> - 让 AI 生成代码

命令执行：
/run <命令> [参数...] - 执行 slash command
/shell <命令> - 执行 shell 命令

任务管理：
/todos - 查看当前任务列表

提示：直接发送消息可以与 AI 对话`
    );
  }

  private async handleStatus(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    try {
      const health = await this.opencode.health();
      const project = await this.opencode.getProject();
      const path = await this.opencode.getPath();
      const todos = await this.opencode.getTodos(session.openCodeSessionId);

      await ctx.reply(
        `📊 OpenCode 状态

✅ 服务器: 运行中 (v${health.version})
📁 项目: ${JSON.stringify(project)}
📂 路径: ${JSON.stringify(path)}
📋 任务: ${todos.length} 个
🔑 会话: ${session.openCodeSessionId.slice(0, 8)}...`
      );
    } catch (error) {
      await ctx.reply(`❌ 获取状态失败: ${error}`);
    }
  }

  private async handleNewSession(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    // Delete old session
    const oldSession = this.sessions.get(userId);
    if (oldSession) {
      try {
        await this.opencode.deleteSession(oldSession.openCodeSessionId);
      } catch {
        // Ignore error
      }
      this.sessions.delete(userId);
    }

    // Create new session
    const session = await this.ensureSession(ctx);
    if (session) {
      await ctx.reply(`✅ 已创建新会话: ${session.openCodeSessionId.slice(0, 8)}...`);
    }
  }

  private async handleListFiles(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);
    const path = args[0] || '';

    try {
      const files = await this.opencode.listFiles(path);
      await ctx.reply(formatFileList(files, path));
    } catch (error) {
      await ctx.reply(`❌ 无法列出文件: ${error}`);
    }
  }

  private async handleReadFile(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);
    const path = args[0];

    if (!path) {
      await ctx.reply('请提供文件路径，例如: /cat README.md');
      return;
    }

    try {
      const file = await this.opencode.readFile(path);

      // Truncate if too long
      let content = file.content;
      if (content.length > this.config.app.maxMessageLength - 100) {
        content = content.slice(0, this.config.app.maxMessageLength - 100) + '\n\n... (已截断)';
      }

      await ctx.reply(`📄 ${path}\n\n\`\`\`\n${content}\n\`\`\``);
    } catch (error) {
      await ctx.reply(`❌ 无法读取文件: ${error}`);
    }
  }

  private async handleTree(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    await ctx.reply('🌲 目录树功能开发中...');
  }

  private async handleCode(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const prompt = message.text.replace('/code', '').trim();

    if (!prompt) {
      await ctx.reply('请提供代码描述，例如: /code 创建一个 React 按钮组件');
      return;
    }

    const processingMsg = await ctx.reply('🤔 正在生成代码...');

    try {
      const response = await this.opencode.sendMessage(session.openCodeSessionId, prompt);
      const text = response.parts.map(p => p.text).join('\n');

      // Delete processing message
      await ctx.deleteMessage(processingMsg.message_id);

      // Send response
      await ctx.reply(formatCodeResponse(text), { parse_mode: 'Markdown' });
    } catch (error) {
      await ctx.reply(`❌ 生成代码失败: ${error}`);
    }
  }

  private async handleRun(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.reply('请提供命令，例如: /run git status');
      return;
    }

    const command = args[0];
    const commandArgs = args.slice(1);

    const processingMsg = await ctx.reply(`⚡ 执行: ${command} ${commandArgs.join(' ')}`);

    try {
      const response = await this.opencode.executeCommand(
        session.openCodeSessionId,
        command,
        commandArgs
      );

      await ctx.deleteMessage(processingMsg.message_id);

      const text = response.parts.map(p => p.text).join('\n');
      if (text) {
        await ctx.reply(`\`\`\`\n${text}\n\`\`\``);
      } else {
        await ctx.reply('✅ 命令执行完成');
      }
    } catch (error) {
      await ctx.reply(`❌ 执行失败: ${error}`);
    }
  }

  private async handleShell(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const command = message.text.replace('/shell', '').trim();

    if (!command) {
      await ctx.reply('请提供 shell 命令，例如: /shell ls -la');
      return;
    }

    const processingMsg = await ctx.reply(`🔧 执行 shell: ${command}`);

    try {
      const response = await this.opencode.executeShell(session.openCodeSessionId, command);

      await ctx.deleteMessage(processingMsg.message_id);

      const text = response.parts.map(p => p.text).join('\n');
      if (text) {
        await ctx.reply(`\`\`\`\n${text}\n\`\`\``);
      } else {
        await ctx.reply('✅ 命令执行完成');
      }
    } catch (error) {
      await ctx.reply(`❌ 执行失败: ${error}`);
    }
  }

  private async handleTodos(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    try {
      const todos = await this.opencode.getTodos(session.openCodeSessionId);
      await ctx.reply(formatTodos(todos));
    } catch (error) {
      await ctx.reply(`❌ 获取任务失败: ${error}`);
    }
  }

  private async handleMessage(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;

    // Skip commands
    if (message.text?.startsWith('/')) return;

    const processingMsg = await ctx.reply('🤔 思考中...');

    try {
      const response = await this.opencode.sendMessage(
        session.openCodeSessionId,
        message.text
      );

      await ctx.deleteMessage(processingMsg.message_id);

      const text = response.parts.map(p => p.text).join('\n');

      // Split long messages
      const maxLength = this.config.app.maxMessageLength;
      if (text.length > maxLength) {
        for (let i = 0; i < text.length; i += maxLength) {
          const chunk = text.slice(i, i + maxLength);
          await ctx.reply(chunk);
        }
      } else {
        await ctx.reply(text);
      }
    } catch (error) {
      await ctx.reply(`❌ 错误: ${error}`);
    }
  }

  private async handleAttach(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const userId = ctx.from?.id.toString();
    const chatId = ctx.chat?.id.toString();

    if (!userId || !chatId) {
      await ctx.reply('无法获取用户信息');
      return;
    }

    // Check allowed users
    if (this.config.telegram.allowedUserIds.length > 0) {
      if (!this.config.telegram.allowedUserIds.includes(userId)) {
        await ctx.reply('你没有权限使用此 Bot');
        return;
      }
    }

    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);

    if (args.length === 0) {
      // List available sessions
      try {
        const sessions = await this.opencode.listSessions();
        if (sessions.length === 0) {
          await ctx.reply('📭 没有可用的 Sessions\n\n使用 /newsession 创建新 session');
          return;
        }

        const lines = sessions.map((s, i) => {
          const shortId = s.id.slice(0, 8);
          const title = s.title || 'Untitled';
          const date = s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : 'Unknown';
          return `${i + 1}. \`${shortId}...\` - ${title} (${date})`;
        });

        await ctx.reply(
          `📋 可用 Sessions (${sessions.length} 个):\n\n${lines.join('\n')}\n\n` +
          `使用 /attach <session-id> 连接到指定 session`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        await ctx.reply(`❌ 获取 session 列表失败: ${error}`);
      }
      return;
    }

    // Attach to specific session
    const sessionId = args[0];

    try {
      // Verify session exists
      const openCodeSession = await this.opencode.getSession(sessionId);

      // Delete old session mapping if exists
      const oldSession = this.sessions.get(userId);
      if (oldSession) {
        this.sessions.delete(userId);
      }

      // Create new mapping
      const session: TelegramSession = {
        telegramUserId: userId,
        telegramChatId: chatId,
        openCodeSessionId: openCodeSession.id,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      this.sessions.set(session);

      await ctx.reply(
        `✅ 已 attach 到 session\n\n` +
        `🆔 ID: \`${openCodeSession.id.slice(0, 12)}...\`\n` +
        `📌 标题: ${openCodeSession.title || 'Untitled'}\n` +
        `⏰ 创建时间: ${openCodeSession.createdAt ? new Date(openCodeSession.createdAt).toLocaleString() : 'Unknown'}`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      await ctx.reply(`❌ Attach 失败: ${error}\n\n请确认 session ID 正确`);
    }
  }

  private async handleListSessions(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const userId = ctx.from?.id.toString();
    if (!userId) {
      await ctx.reply('无法获取用户信息');
      return;
    }

    // Check allowed users
    if (this.config.telegram.allowedUserIds.length > 0) {
      if (!this.config.telegram.allowedUserIds.includes(userId)) {
        await ctx.reply('你没有权限使用此 Bot');
        return;
      }
    }

    try {
      const sessions = await this.opencode.listSessions();
      const currentSession = this.sessions.get(userId);

      if (sessions.length === 0) {
        await ctx.reply('📭 没有可用的 Sessions');
        return;
      }

      const lines = sessions.map((s, i) => {
        const shortId = s.id.slice(0, 8);
        const title = s.title || 'Untitled';
        const date = s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : 'Unknown';
        const isCurrent = currentSession?.openCodeSessionId === s.id ? ' 👈 当前' : '';
        return `${i + 1}. \`${shortId}...\` - ${title} (${date})${isCurrent}`;
      });

      await ctx.reply(
        `📋 OpenCode Sessions (${sessions.length} 个):\n\n${lines.join('\n')}\n\n` +
        `使用 /attach <session-id> 切换 session\n` +
        `使用 /newsession 创建新 session`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      await ctx.reply(`❌ 获取 session 列表失败: ${error}`);
    }
  }

  private handleError(err: unknown, ctx: Context<Update>): void {
    console.error('Bot error:', err);
    ctx.reply('发生错误，请稍后重试').catch(console.error);
  }
}
