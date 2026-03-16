import type { Context, Telegraf } from 'telegraf';
import type { InlineKeyboardMarkup, Message, Update } from 'telegraf/types';
import { resolve } from 'path';
import type { OpenCodeClient } from '../opencode/client.js';
import type { SessionManager } from '../session/manager.js';
import type { PluginConfig, TelegramSession } from '../types.js';
import { WhitelistManager } from '../auth/whitelist.js';
import { SSEClient } from '../opencode/sse-client.js';
import { PermissionHandler } from '../opencode/permission-handler.js';
import {
  formatCodeResponse,
  formatFileList,
  formatSessionOverview,
  formatStatus,
  formatTodos,
} from './formatters.js';

export class BotHandlers {
  private static readonly LOCAL_COMMANDS = new Set([
    'pair', 'start', 'help', 'status', 'new', 'sessions', 'cwd',
    'model', 'agents', 'ls', 'cat', 'code', 'shell', 'todos',
    'history', 'search', 'findfile', 'rename', 'fork', 'abort',
    'share', 'unshare', 'diff', 'summarize', 'projects', 'commands',
    'config', 'providers', 'status-all', 'children',
    'init', 'symbol', 'git-status', 'tools',
    'tui-toast', 'tui-sessions', 'tui-models', 'tui-themes',
  ]);

  private bot: Telegraf;
  private opencode: OpenCodeClient;
  private sessions: SessionManager;
  private whitelist: WhitelistManager;
  private config: PluginConfig;
  private sseClient: SSEClient | null = null;
  private permissionHandler: PermissionHandler;

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

    this.permissionHandler = new PermissionHandler(bot, opencode, sessions);

    if (config.app.enableSSE !== false) {
      this.initSSE();
    }

    this.setupHandlers();
  }

  private initSSE(): void {
    this.sseClient = new SSEClient(
      this.config.opencode.serverUrl,
      this.config.opencode.username,
      this.config.opencode.password
    );

    this.sseClient.on('session.permission.requested', (event) => {
      this.permissionHandler.handlePermissionRequest(event.data as {
        sessionID: string;
        permissionID: string;
        description?: string;
        tool?: string;
        action?: string;
      });
    });

    this.sseClient.on('message.created', (event) => {
      this.handleSSEMessage(event.data as {
        sessionID?: string;
        message?: { role?: string; parts?: Array<{ type: string; text?: string }> };
      });
    });

    this.sseClient.start();
  }

  private async handleSSEMessage(data: {
    sessionID?: string;
    message?: { role?: string; parts?: Array<{ type: string; text?: string }> };
  }): Promise<void> {
    if (!data.sessionID || data.message?.role !== 'assistant') return;

    const sessions = await this.sessions.getAll();
    const session = sessions.find((s: TelegramSession) => s.openCodeSessionId === data.sessionID);
    if (!session) return;

    const text = data.message?.parts?.find(p => p.type === 'text')?.text;
    if (!text || text.length < 10) return;

    try {
      await this.bot.telegram.sendMessage(
        session.telegramChatId,
        `🤖 AI 回复:\n\n${text.slice(0, 500)}${text.length > 500 ? '...' : ''}`
      );
    } catch (error) {
      console.error('Failed to send SSE message to Telegram:', error);
    }
  }

  private setupHandlers(): void {
    // Pairing command (must be first, before whitelist check)
    this.bot.command('pair', this.handlePair.bind(this));

    // Commands with whitelist check
    this.bot.command('start', this.withWhitelist(this.handleStart.bind(this)));
    this.bot.command('help', this.withWhitelist(this.handleHelp.bind(this)));
    this.bot.command('status', this.withWhitelist(this.handleStatus.bind(this)));
    this.bot.command('new', this.withWhitelist(this.handleNewSession.bind(this)));
    this.bot.command('sessions', this.withWhitelist(this.handleSessions.bind(this)));
    this.bot.command('cwd', this.withWhitelist(this.handleCwd.bind(this)));
    this.bot.command('model', this.withWhitelist(this.handleModel.bind(this)));
    this.bot.command('agents', this.withWhitelist(this.handleAgents.bind(this)));
    this.bot.action(/^sessions:(\d+)(?::(.*))?$/, this.handleSessionsPage.bind(this));

    // File operations
    this.bot.command('ls', this.withWhitelist(this.handleListFiles.bind(this)));
    this.bot.command('cat', this.withWhitelist(this.handleReadFile.bind(this)));
    this.bot.command('code', this.withWhitelist(this.handleCode.bind(this)));
    this.bot.command('shell', this.withWhitelist(this.handleShell.bind(this)));
    this.bot.command('todos', this.withWhitelist(this.handleTodos.bind(this)));
    this.bot.command('history', this.withWhitelist(this.handleHistory.bind(this)));
    this.bot.command('search', this.withWhitelist(this.handleSearch.bind(this)));
    this.bot.command('findfile', this.withWhitelist(this.handleFindFile.bind(this)));
    this.bot.command('rename', this.withWhitelist(this.handleRenameSession.bind(this)));
    this.bot.command('fork', this.withWhitelist(this.handleForkSession.bind(this)));
    this.bot.command('abort', this.withWhitelist(this.handleAbortSession.bind(this)));
    this.bot.command('share', this.withWhitelist(this.handleShareSession.bind(this)));
    this.bot.command('unshare', this.withWhitelist(this.handleUnshareSession.bind(this)));
    this.bot.command('diff', this.withWhitelist(this.handleDiff.bind(this)));
    this.bot.command('summarize', this.withWhitelist(this.handleSummarize.bind(this)));
    this.bot.command('projects', this.withWhitelist(this.handleProjects.bind(this)));
    this.bot.command('commands', this.withWhitelist(this.handleCommands.bind(this)));
    this.bot.command('config', this.withWhitelist(this.handleConfig.bind(this)));
    this.bot.command('providers', this.withWhitelist(this.handleProviders.bind(this)));
    this.bot.command('status-all', this.withWhitelist(this.handleStatusAll.bind(this)));
    this.bot.command('children', this.withWhitelist(this.handleChildren.bind(this)));
    this.bot.command('init', this.withWhitelist(this.handleInit.bind(this)));
    this.bot.command('symbol', this.withWhitelist(this.handleSymbol.bind(this)));
    this.bot.command('git-status', this.withWhitelist(this.handleGitStatus.bind(this)));
    this.bot.command('tools', this.withWhitelist(this.handleTools.bind(this)));
    this.bot.command('tui-toast', this.withWhitelist(this.handleToast.bind(this)));
    this.bot.command('tui-sessions', this.withWhitelist(this.handleOpenSessions.bind(this)));
    this.bot.command('tui-models', this.withWhitelist(this.handleOpenModels.bind(this)));
    this.bot.command('tui-themes', this.withWhitelist(this.handleOpenThemes.bind(this)));

    this.bot.action(/^perm:(allow|allow-remember|deny):(.+)$/, this.handlePermissionAction.bind(this));

    this.bot.on('text', this.withWhitelist(this.handleMessage.bind(this)));

    // Error handling
    this.bot.catch(this.handleError.bind(this));
  }

  private withWhitelist(handler: (ctx: Context<Update.MessageUpdate>) => Promise<void>) {
    return async (ctx: Context<Update.MessageUpdate>) => {
      if (!(await this.checkWhitelist(ctx))) {
        return;
      }

      await handler(ctx);
    };
  }

  private async checkWhitelist<T extends Update>(ctx: Context<T>): Promise<boolean> {
    const userId = ctx.from?.id.toString();
    const chatId = ctx.chat?.id.toString();
    const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';

    if (!userId) return false;

    const idToCheck = isGroup ? chatId! : userId;
    const type = isGroup ? 'group' : 'user';

    if (this.whitelist.isWhitelisted(idToCheck, type)) {
      return true;
    }

    await ctx.reply(
      `🔒 This bot is private.\n\n` +
      `To use this bot, you need a pairing code.\n\n` +
      `Ask the server administrator to run:\n` +
      `./control.sh pair\n\n` +
      `Then use the command:\n` +
      `/pair <code>`
    );
    return false;
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
          openCodeSessionTitle: openCodeSession.title,
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
🔍 搜索代码
⚡ 执行命令
✅ 管理任务
🎮 控制 TUI

可用命令：
/sessions - 查看/切换会话
/new [title] - 创建新会话
/rename <名称> - 重命名会话
/cwd - 查看当前目录
/projects - 列出项目
/model - 查看/设置模型
/agents - 查看/设置 agent
/code <描述> - 生成代码
/ls [路径] - 列出文件
/cat <文件> - 查看文件
/search <关键词> - 搜索代码
/findfile <文件名> - 查找文件
/diff - 查看变更
/history [数量] - 查看历史
/todos - 查看任务
/tui-toast <消息> - 发送到 TUI
/help - 显示完整帮助

也可以直接发送消息与我对话！`
    );
  }

  private async handleHelp(ctx: Context<Update.MessageUpdate>): Promise<void> {
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
/new [title] - 创建新会话
/sessions - 查看/切换会话
/rename <名称> - 重命名会话
/fork [id] - 分叉会话
/abort - 中止会话
/share - 分享会话
/unshare - 取消分享
/diff [id] - 查看变更
/summarize - 总结会话
/status-all - 查看所有会话状态
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
/git-status - 查看 Git 状态

代码与执行：
/code <描述> - 生成代码
/shell <命令> - 执行 shell

任务与历史：
/todos - 查看任务
/history [数量] - 查看历史

工具：
/tools - 列出可用工具

TUI 控制：
/tui-toast <消息> - 发送通知到 TUI
/tui-sessions - 打开会话选择器
/tui-models - 打开模型选择器
/tui-themes - 打开主题选择器

提示：直接发送消息可以与 AI 对话`,
      { parse_mode: 'Markdown' }
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
      const liveSession = await this.opencode.getSession(session.openCodeSessionId).catch(() => null);

      if (liveSession?.title && liveSession.title !== session.openCodeSessionTitle) {
        session.openCodeSessionTitle = liveSession.title;
        this.sessions.set(session);
      }

      await ctx.reply(
        formatStatus({
          version: health.version,
          project,
          path,
          todosCount: todos.length,
          sessionId: session.openCodeSessionId,
          sessionTitle: liveSession?.title || session.openCodeSessionTitle,
          overrides: this.getOverrides(session),
        })
      );
    } catch (error) {
      await ctx.reply(`❌ 获取状态失败: ${error}`);
    }
  }

  private async handleNewSession(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);
    const title = args.join(' ').trim() || undefined;

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
    try {
      const openCodeSession = await this.opencode.createSession(title);
      const session: TelegramSession = {
        telegramUserId: userId,
        telegramChatId: ctx.chat?.id.toString() || '',
        openCodeSessionId: openCodeSession.id,
        openCodeSessionTitle: openCodeSession.title,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
        preferredModel: oldSession?.preferredModel,
        preferredAgent: oldSession?.preferredAgent,
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      this.sessions.set(session);
      await ctx.reply(
        `✅ 已创建新会话\n\n` +
        `🪪 ${session.openCodeSessionId.slice(0, 12)}...\n` +
        `🏷️ ${openCodeSession.title || title || 'Untitled'}`
      );
    } catch (error) {
      await ctx.reply(`❌ 创建新会话失败: ${error}`);
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

      let content = file.content;
      if (content.length > this.config.app.maxMessageLength - 100) {
        content = content.slice(0, this.config.app.maxMessageLength - 100) + '\n\n... (已截断)';
      }

      await ctx.reply(`📄 ${path}\n\n\`\`\`\n${content}\n\`\`\``);
    } catch (error) {
      await ctx.reply(`❌ 无法读取文件: ${error}`);
    }
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
      const response = await this.opencode.sendMessageWithOverrides(
        session.openCodeSessionId,
        prompt,
        this.getOverrides(session)
      );
      const text = response.parts.map(p => p.text).join('\n');

      // Delete processing message
      await ctx.deleteMessage(processingMsg.message_id);

      // Send response
      await ctx.reply(formatCodeResponse(text), { parse_mode: 'Markdown' });
    } catch (error) {
      await ctx.reply(`❌ 生成代码失败: ${error}`);
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
      const response = await this.opencode.executeShell(
        session.openCodeSessionId,
        command,
        this.getOverrides(session)
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

    if (message.text?.startsWith('/')) {
      const [rawCommand] = message.text.slice(1).split(' ');
      const command = rawCommand.trim();

      if (!BotHandlers.LOCAL_COMMANDS.has(command)) {
        await ctx.reply(this.getServeCommandUnavailableMessage(`/${command}`));
      }
      return;
    }

    const processingMsg = await ctx.reply('🤔 思考中...');

    try {
      const response = await this.opencode.sendMessageWithOverrides(
        session.openCodeSessionId,
        message.text,
        this.getOverrides(session)
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

  private async handleListSessions<T extends Update.MessageUpdate | Update.CallbackQueryUpdate>(
    ctx: Context<T>,
    options: { query?: string; page?: number } = {}
  ): Promise<void> {
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
      const filteredSessions = this.filterSessions(sessions, options.query);
      const currentPage = Math.max(1, options.page ?? 1);
      const totalPages = Math.max(1, Math.ceil(filteredSessions.length / this.getSessionsPageSize()));
      const safePage = Math.min(currentPage, totalPages);
      const replyMarkup = this.buildSessionsPagination(filteredSessions.length, safePage, options.query);
      const text = formatSessionOverview({
        sessions: filteredSessions,
        currentSessionId: currentSession?.openCodeSessionId,
        currentSessionTitle: currentSession?.openCodeSessionTitle,
        query: options.query,
        page: safePage,
        pageSize: this.getSessionsPageSize(),
      });

      if ('callback_query' in ctx.update && 'editMessageText' in ctx) {
        await ctx.editMessageText(text, replyMarkup ? { reply_markup: replyMarkup } : undefined);
        await ctx.answerCbQuery();
        return;
      }

      await ctx.reply(text, replyMarkup ? { reply_markup: replyMarkup } : undefined);
    } catch (error) {
      if ('callback_query' in ctx.update && 'answerCbQuery' in ctx) {
        await ctx.answerCbQuery('加载失败');
      }
      await ctx.reply(`❌ 获取 session 列表失败: ${error}`);
    }
  }

  private async handleSessions(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);

    if (args.length === 0) {
      await this.handleListSessions(ctx);
      return;
    }

    const parsed = this.parseSessionsArgs(args);

    if (parsed.index !== undefined) {
      await this.attachToSessionByIndex(ctx, parsed.index);
      return;
    }

    if (parsed.lookup) {
      await this.attachToSession(ctx, parsed.lookup);
      return;
    }

    await this.handleListSessions(ctx, {
      query: parsed.query,
      page: 1,
    });
  }

  private async handleModel(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);
    const normalized = args.join(' ').trim();

    if (!normalized) {
      await ctx.reply(
        `🧠 当前模型\n\n` +
        `${session.preferredModel || 'default'}\n\n` +
        `用法：\n` +
        `/model <provider/model> 设置模型\n` +
        `/model clear 清除模型覆盖\n` +
        `/model list 列出可用模型`
      );
      return;
    }

    if (args[0] === 'list') {
      try {
        const config = await this.opencode.getConfigProviders();
        const lines = config.providers.map(p => {
          const models = p.models.slice(0, 5).join(', ');
          const more = p.models.length > 5 ? `... (+${p.models.length - 5})` : '';
          return `• ${p.provider}: ${models}${more}`;
        });
        await ctx.reply(`🧠 可用模型 (${config.providers.length} providers)\n\n${lines.join('\n')}`);
      } catch (error) {
        await ctx.reply(`❌ 获取模型列表失败: ${error}`);
      }
      return;
    }

    if (normalized === 'clear') {
      delete session.preferredModel;
      this.sessions.set(session);
      await ctx.reply('✅ 已清除模型覆盖，后续消息将使用默认模型');
      return;
    }

    session.preferredModel = normalized;
    this.sessions.set(session);
    await ctx.reply(`✅ 已设置模型\n\n${normalized}`);
  }

  private async handleAgents(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);
    const normalized = args.join(' ').trim();

    if (!normalized) {
      await ctx.reply(
        `🤖 当前 agent\n\n` +
        `${session.preferredAgent || 'default'}\n\n` +
        `用法：\n` +
        `/agents <name> 设置 agent\n` +
        `/agents clear 清除 agent 覆盖\n` +
        `/agents list 列出可用 agent`
      );
      return;
    }

    if (normalized === 'list') {
      try {
        const agents = await this.opencode.listAgents();
        const lines = agents.map(a => `• ${a.name}${a.description ? ` - ${a.description}` : ''}`);
        await ctx.reply(`🤖 可用 Agents (${agents.length})\n\n${lines.join('\n')}`);
      } catch (error) {
        await ctx.reply(`❌ 获取 agent 列表失败: ${error}`);
      }
      return;
    }

    if (normalized === 'clear') {
      delete session.preferredAgent;
      this.sessions.set(session);
      await ctx.reply('✅ 已清除 agent 覆盖，后续消息将使用默认 agent');
      return;
    }

    session.preferredAgent = normalized;
    this.sessions.set(session);
    await ctx.reply(`✅ 已设置 agent\n\n${normalized}`);
  }

  private async handleCwd(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    try {
      const path = await this.opencode.getPath();
      const text = typeof path === 'string' ? path : JSON.stringify(path);
      await ctx.reply(`📂 当前工作目录\n\n${text}`);
    } catch (error) {
      await ctx.reply(`❌ 获取目录失败: ${error}`);
    }
  }

  private getOverrides(session: TelegramSession) {
    return {
      model: session.preferredModel,
      agent: session.preferredAgent,
    };
  }

  private async handleSessionsPage(ctx: Context<Update.CallbackQueryUpdate>): Promise<void> {
    if (!(await this.checkWhitelist(ctx))) {
      if ('answerCbQuery' in ctx) {
        await ctx.answerCbQuery('未授权');
      }
      return;
    }

    const callbackData = this.getCallbackData(ctx);
    if (!callbackData) {
      await ctx.answerCbQuery();
      return;
    }

    const payload = callbackData.match(/^sessions:(\d+)(?::(.*))?$/);
    if (!payload) {
      await ctx.answerCbQuery();
      return;
    }

    const page = Number.parseInt(payload[1], 10);
    const query = payload[2] ? this.decodeSessionsQuery(payload[2]) : undefined;
    await this.handleListSessions(ctx, { page, query });
  }

  private async attachToSession(ctx: Context<Update.MessageUpdate>, requestedId: string): Promise<void> {
    const userId = ctx.from?.id.toString();
    const chatId = ctx.chat?.id.toString();

    if (!userId || !chatId) {
      await ctx.reply('无法获取用户信息');
      return;
    }

    try {
      const sessions = await this.opencode.listSessions();
      const normalized = requestedId.trim();
      const exact = sessions.find(session => session.id === normalized);
      const prefixMatches = exact ? [exact] : sessions.filter(session => session.id.startsWith(normalized));

      if (prefixMatches.length === 0) {
        await ctx.reply(`❌ 找不到 session: ${normalized}\n\n用 /sessions 查看可用列表`);
        return;
      }

      if (prefixMatches.length > 1) {
        const options = prefixMatches.slice(0, 5).map(session => `${session.id.slice(0, 12)}...  ${session.title || 'Untitled'}`);
        await ctx.reply(`⚠️ 前缀匹配到多个 session，请提供更长的 id:\n\n${options.join('\n')}`);
        return;
      }

      const openCodeSession = await this.opencode.getSession(prefixMatches[0].id);
      const oldSession = this.sessions.get(userId);
      if (oldSession) {
        this.sessions.delete(userId);
      }

      const session: TelegramSession = {
        telegramUserId: userId,
        telegramChatId: chatId,
        openCodeSessionId: openCodeSession.id,
        openCodeSessionTitle: openCodeSession.title,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
        preferredModel: oldSession?.preferredModel,
        preferredAgent: oldSession?.preferredAgent,
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      this.sessions.set(session);

      await ctx.reply(
        `✅ 已切换到 session\n\n` +
        `🪪 ${openCodeSession.id.slice(0, 12)}...\n` +
        `🏷️ ${openCodeSession.title || 'Untitled'}\n\n` +
        `说明：切换后可以继续在该 session 里发送消息；还不支持实时观察本地 TUI 正在生成的进度。`
      );
    } catch (error) {
      await ctx.reply(`❌ 载入 session 失败: ${error}`);
    }
  }

  private async attachToSessionByIndex(ctx: Context<Update.MessageUpdate>, requestedIndex: number): Promise<void> {
    try {
      const sessions = await this.opencode.listSessions();
      const session = sessions[requestedIndex - 1];

      if (!session) {
        await ctx.reply(`❌ 找不到序号 ${requestedIndex} 对应的 session\n\n用 /sessions 查看可用列表`);
        return;
      }

      await this.attachToSession(ctx, session.id);
    } catch (error) {
      await ctx.reply(`❌ 载入 session 失败: ${error}`);
    }
  }

  private getServeCommandUnavailableMessage(command: string): string {
    return (
      `⚠️ ${command} 当前不可用\n\n` +
      `该命令未实现或 OpenCode serve 端点不稳定。\n` +
      `请使用 /help 查看可用命令列表。`
    );
  }

  private filterSessions(sessions: TelegramSession[] | any[], query?: string) {
    if (!query) return sessions;

    const normalized = query.toLowerCase();
    return sessions.filter((session: any) => {
      const id = String(session.id || '').toLowerCase();
      const title = String(session.title || '').toLowerCase();
      return id.includes(normalized) || title.includes(normalized);
    });
  }

  private parseSessionsArgs(args: string[]): { index?: number; query?: string; lookup?: string } {
    if (args.length === 0) {
      return {};
    }

    if (args.length === 1 && /^\d+$/.test(args[0])) {
      return { index: Number.parseInt(args[0], 10) };
    }

    if (args.length === 1 && /[A-Za-z_-]/.test(args[0]) && /^[A-Za-z0-9_-]{4,}$/.test(args[0])) {
      return { lookup: args[0] };
    }

    return {
      query: args.join(' ').trim() || undefined,
    };
  }

  private getSessionsPageSize(): number {
    return 8;
  }

  private buildSessionsPagination(
    totalCount: number,
    currentPage: number,
    query?: string
  ): InlineKeyboardMarkup | undefined {
    const totalPages = Math.max(1, Math.ceil(totalCount / this.getSessionsPageSize()));
    if (totalPages <= 1) {
      return undefined;
    }

    const encodedQuery = this.encodeSessionsQuery(query);
    const buttons: Array<{ text: string; callback_data: string }> = [];

    if (currentPage > 1) {
      buttons.push({
        text: '⬅️ Prev',
        callback_data: `sessions:${currentPage - 1}${encodedQuery}`,
      });
    }

    buttons.push({
      text: `${currentPage}/${totalPages}`,
      callback_data: `sessions:${currentPage}${encodedQuery}`,
    });

    if (currentPage < totalPages) {
      buttons.push({
        text: 'Next ➡️',
        callback_data: `sessions:${currentPage + 1}${encodedQuery}`,
      });
    }

    return { inline_keyboard: [buttons] };
  }

  private encodeSessionsQuery(query?: string): string {
    if (!query) {
      return '';
    }

    const encoded = encodeURIComponent(query);
    return encoded.length <= 40 ? `:${encoded}` : '';
  }

  private decodeSessionsQuery(encoded: string): string | undefined {
    if (!encoded) {
      return undefined;
    }

    try {
      return decodeURIComponent(encoded);
    } catch {
      return undefined;
    }
  }

  private getCallbackData(ctx: Context<Update.CallbackQueryUpdate>): string | undefined {
    const callbackQuery = ctx.update.callback_query;
    if (!callbackQuery || typeof callbackQuery !== 'object') {
      return undefined;
    }

    if (!('data' in callbackQuery) || typeof callbackQuery.data !== 'string') {
      return undefined;
    }

    return callbackQuery.data;
  }

  private handleError(err: unknown, ctx: Context<Update>): void {
    console.error('Bot error:', err);
    ctx.reply('发生错误，请稍后重试').catch(console.error);
  }

  private async handleHistory(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);
    const limit = args[0] ? parseInt(args[0], 10) : 20;

    try {
      const messages = await this.opencode.listMessages(session.openCodeSessionId, limit);
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

  private async handleSearch(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const pattern = message.text.replace('/search', '').trim();

    if (!pattern) {
      await ctx.reply('请提供搜索关键词，例如: /search function');
      return;
    }

    const processingMsg = await ctx.reply(`🔍 搜索: ${pattern}...`);

    try {
      const results = await this.opencode.findText(pattern);
      await ctx.deleteMessage(processingMsg.message_id);

      if (results.length === 0) {
        await ctx.reply('未找到匹配结果');
        return;
      }

      const lines = results.slice(0, 10).map((result, index) => {
        const lines = result.lines.slice(0, 3).map(l => `   ${l.line_number}: ${l.content.slice(0, 60)}`).join('\n');
        return `${index + 1}. ${result.path}\n${lines}`;
      });

      const more = results.length > 10 ? `\n\n... 还有 ${results.length - 10} 个结果` : '';
      await ctx.reply(`🔍 搜索结果 (${results.length} 个文件)${more}\n\n${lines.join('\n\n')}`);
    } catch (error) {
      await ctx.deleteMessage(processingMsg.message_id);
      await ctx.reply(`❌ 搜索失败: ${error}`);
    }
  }

  private async handleFindFile(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const query = message.text.replace('/findfile', '').trim();

    if (!query) {
      await ctx.reply('请提供文件名，例如: /findfile README');
      return;
    }

    try {
      const results = await this.opencode.findFile(query);
      if (results.length === 0) {
        await ctx.reply('未找到匹配文件');
        return;
      }

      const lines = results.slice(0, 20).map((path, index) => `${index + 1}. ${path}`);
      const more = results.length > 20 ? `\n\n... 还有 ${results.length - 20} 个结果` : '';
      await ctx.reply(`📁 找到 ${results.length} 个文件${more}\n\n${lines.join('\n')}`);
    } catch (error) {
      await ctx.reply(`❌ 查找失败: ${error}`);
    }
  }

  private async handleRenameSession(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const newTitle = message.text.replace('/rename', '').trim();

    if (!newTitle) {
      await ctx.reply('请提供新名称，例如: /rename 修复登录 bug');
      return;
    }

    try {
      const updated = await this.opencode.updateSession(session.openCodeSessionId, newTitle);
      session.openCodeSessionTitle = updated.title;
      this.sessions.set(session);
      await ctx.reply(`✅ 已重命名为: ${updated.title || newTitle}`);
    } catch (error) {
      await ctx.reply(`❌ 重命名失败: ${error}`);
    }
  }

  private async handleForkSession(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);
    const messageId = args[0] || undefined;

    try {
      const forked = await this.opencode.forkSession(session.openCodeSessionId, messageId);
      await ctx.reply(
        `✅ 已分叉会话\n\n` +
        `🪪 ${forked.id.slice(0, 12)}...\n` +
        `🏷️ ${forked.title || 'Untitled'}\n\n` +
        `使用 /sessions 切换到新会话`
      );
    } catch (error) {
      await ctx.reply(`❌ 分叉失败: ${error}`);
    }
  }

  private async handleAbortSession(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    try {
      const success = await this.opencode.abortSession(session.openCodeSessionId);
      if (success) {
        await ctx.reply('✅ 已中止会话');
      } else {
        await ctx.reply('⚠️ 会话未在运行或中止失败');
      }
    } catch (error) {
      await ctx.reply(`❌ 中止失败: ${error}`);
    }
  }

  private async handleShareSession(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    try {
      const shared = await this.opencode.shareSession(session.openCodeSessionId);
      await ctx.reply(`✅ 会话已分享\n\n🏷️ ${shared.title || 'Untitled'}`);
    } catch (error) {
      await ctx.reply(`❌ 分享失败: ${error}`);
    }
  }

  private async handleUnshareSession(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    try {
      await this.opencode.unshareSession(session.openCodeSessionId);
      await ctx.reply('✅ 已取消分享');
    } catch (error) {
      await ctx.reply(`❌ 取消分享失败: ${error}`);
    }
  }

  private async handleDiff(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);
    const messageId = args[0] || undefined;

    try {
      const diffs = await this.opencode.getSessionDiff(session.openCodeSessionId, messageId);
      if (diffs.length === 0) {
        await ctx.reply('暂无变更');
        return;
      }

      const lines = diffs.slice(0, 20).map((diff, index) => {
        const icon = diff.change === 'added' ? '✅' : diff.change === 'removed' ? '❌' : '📝';
        return `${index + 1}. ${icon} ${diff.path}`;
      });

      const more = diffs.length > 20 ? `\n\n... 还有 ${diffs.length - 20} 个文件` : '';
      await ctx.reply(`📊 变更文件 (${diffs.length} 个)${more}\n\n${lines.join('\n')}`);
    } catch (error) {
      await ctx.reply(`❌ 获取变更失败: ${error}`);
    }
  }

  private async handleSummarize(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    const processingMsg = await ctx.reply('📝 正在总结会话...');

    try {
      const success = await this.opencode.summarizeSession(
        session.openCodeSessionId,
        session.preferredModel?.split('/')[0],
        session.preferredModel?.split('/')[1]
      );
      await ctx.deleteMessage(processingMsg.message_id);

      if (success) {
        await ctx.reply('✅ 会话总结完成');
      } else {
        await ctx.reply('⚠️ 总结失败');
      }
    } catch (error) {
      await ctx.deleteMessage(processingMsg.message_id);
      await ctx.reply(`❌ 总结失败: ${error}`);
    }
  }

  private async handleProjects(ctx: Context<Update.MessageUpdate>): Promise<void> {
    try {
      const projects = await this.opencode.listProjects();
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

  private async handleCommands(ctx: Context<Update.MessageUpdate>): Promise<void> {
    try {
      const commands = await this.opencode.listCommands();
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

  private async handleToast(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const message = ctx.message as Message.TextMessage;
    const text = message.text.replace('/tui-toast', '').trim();

    if (!text) {
      await ctx.reply('请提供消息内容，例如: /tui-toast 你好，TUI！');
      return;
    }

    try {
      const success = await this.opencode.tuiShowToast(text, 'Telegram Bot', 'info');
      if (success) {
        await ctx.reply('✅ 通知已发送到 TUI');
      } else {
        await ctx.reply('⚠️ 发送失败');
      }
    } catch (error) {
      await ctx.reply(`❌ 发送通知失败: ${error}`);
    }
  }

  private async handleOpenSessions(ctx: Context<Update.MessageUpdate>): Promise<void> {
    try {
      const success = await this.opencode.tuiOpenSessions();
      if (success) {
        await ctx.reply('✅ 已在 TUI 打开会话选择器');
      } else {
        await ctx.reply('⚠️ 打开失败');
      }
    } catch (error) {
      await ctx.reply(`❌ 打开失败: ${error}`);
    }
  }

  private async handleOpenModels(ctx: Context<Update.MessageUpdate>): Promise<void> {
    try {
      const success = await this.opencode.tuiOpenModels();
      if (success) {
        await ctx.reply('✅ 已在 TUI 打开模型选择器');
      } else {
        await ctx.reply('⚠️ 打开失败');
      }
    } catch (error) {
      await ctx.reply(`❌ 打开失败: ${error}`);
    }
  }

  private async handleOpenThemes(ctx: Context<Update.MessageUpdate>): Promise<void> {
    try {
      const success = await this.opencode.tuiOpenThemes();
      if (success) {
        await ctx.reply('✅ 已在 TUI 打开主题选择器');
      } else {
        await ctx.reply('⚠️ 打开失败');
      }
    } catch (error) {
      await ctx.reply(`❌ 打开失败: ${error}`);
    }
  }

  private async handleConfig(ctx: Context<Update.MessageUpdate>): Promise<void> {
    try {
      const config = await this.opencode.getConfig();
      const lines = Object.entries(config as Record<string, unknown>).map(([key, value]) => {
        const displayValue = typeof value === 'object' ? JSON.stringify(value).slice(0, 50) + '...' : String(value).slice(0, 50);
        return `• ${key}: ${displayValue}`;
      });
      await ctx.reply(`⚙️ 当前配置\n\n${lines.slice(0, 20).join('\n')}`);
    } catch (error) {
      await ctx.reply(`❌ 获取配置失败: ${error}`);
    }
  }

  private async handleProviders(ctx: Context<Update.MessageUpdate>): Promise<void> {
    try {
      const providers = await this.opencode.listProviders();
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

  private async handleStatusAll(ctx: Context<Update.MessageUpdate>): Promise<void> {
    try {
      const status = await this.opencode.getAllSessionStatus();
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

  private async handleChildren(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    try {
      const children = await this.opencode.getSessionChildren(session.openCodeSessionId);
      if (!Array.isArray(children) || children.length === 0) {
        await ctx.reply('当前会话没有子会话');
        return;
      }

      const lines = children.map((child, index) => {
        const title = child.title || 'Untitled';
        const id = child.id.slice(0, 12);
        return `${index + 1}. ${id}... - ${title}`;
      });

      await ctx.reply(`👶 子会话 (${children.length})\n\n${lines.join('\n')}`);
    } catch (error) {
      await ctx.reply(`❌ 获取子会话失败: ${error}`);
    }
  }

  private async handleInit(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    const processingMsg = await ctx.reply('📝 正在分析项目并创建 AGENTS.md...');

    try {
      const success = await this.opencode.initSession(
        session.openCodeSessionId,
        session.preferredModel?.split('/')[0],
        session.preferredModel?.split('/')[1]
      );
      await ctx.deleteMessage(processingMsg.message_id);

      if (success) {
        await ctx.reply('✅ 项目分析完成，已创建 AGENTS.md');
      } else {
        await ctx.reply('⚠️ 分析失败');
      }
    } catch (error) {
      await ctx.deleteMessage(processingMsg.message_id);
      await ctx.reply(`❌ 分析失败: ${error}`);
    }
  }

  private async handleSymbol(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const message = ctx.message as Message.TextMessage;
    const query = message.text.replace('/symbol', '').trim();

    if (!query) {
      await ctx.reply('请提供符号名称，例如: /symbol handleMessage');
      return;
    }

    try {
      const symbols = await this.opencode.findSymbol(query);
      if (!Array.isArray(symbols) || symbols.length === 0) {
        await ctx.reply('未找到匹配符号');
        return;
      }

      const lines = symbols.slice(0, 15).map((s: any, index: number) => {
        const name = s.name || 'Unknown';
        const path = s.path || '';
        const line = s.line || 0;
        return `${index + 1}. ${name}\n   ${path}:${line}`;
      });

      const more = symbols.length > 15 ? `\n\n... 还有 ${symbols.length - 15} 个结果` : '';
      await ctx.reply(`🔍 符号搜索结果 (${symbols.length})${more}\n\n${lines.join('\n\n')}`);
    } catch (error) {
      await ctx.reply(`❌ 搜索失败: ${error}`);
    }
  }

  private async handleGitStatus(ctx: Context<Update.MessageUpdate>): Promise<void> {
    try {
      const files = await this.opencode.getFileStatus();
      if (!Array.isArray(files) || files.length === 0) {
        await ctx.reply('工作区干净，没有变更');
        return;
      }

      const staged = files.filter((f: any) => f.staged);
      const unstaged = files.filter((f: any) => !f.staged);

      let result = `📊 Git 文件状态 (${files.length})\n\n`;

      if (staged.length > 0) {
        result += `✅ 已暂存 (${staged.length}):\n${staged.slice(0, 10).map((f: any) => `  • ${f.path}`).join('\n')}\n\n`;
      }

      if (unstaged.length > 0) {
        result += `📝 未暂存 (${unstaged.length}):\n${unstaged.slice(0, 10).map((f: any) => `  • ${f.path}`).join('\n')}`;
      }

      await ctx.reply(result);
    } catch (error) {
      await ctx.reply(`❌ 获取 Git 状态失败: ${error}`);
    }
  }

  private async handleTools(ctx: Context<Update.MessageUpdate>): Promise<void> {
    try {
      const tools = await this.opencode.listToolIds();
      if (!tools || typeof tools !== 'object') {
        await ctx.reply('暂无工具信息');
        return;
      }

      const entries = Object.entries(tools as Record<string, string[]>);
      if (entries.length === 0) {
        await ctx.reply('暂无可用工具');
        return;
      }

      const lines = entries.slice(0, 10).map(([category, ids]) => {
        const count = Array.isArray(ids) ? ids.length : 0;
        return `• ${category}: ${count} 个工具`;
      });

      const more = entries.length > 10 ? `\n\n... 还有 ${entries.length - 10} 个分类` : '';
      await ctx.reply(`🛠️ 可用工具 (${entries.length} 分类)${more}\n\n${lines.join('\n')}`);
    } catch (error) {
      await ctx.reply(`❌ 获取工具列表失败: ${error}`);
    }
  }

  private async handlePermissionAction(ctx: Context<Update.CallbackQueryUpdate>): Promise<void> {
    const callbackQuery = ctx.callbackQuery as { data?: string } | undefined;
    const callbackData = callbackQuery?.data || '';
    const match = callbackData.match(/^perm:(allow|allow-remember|deny):(.+)$/);

    if (!match) {
      await ctx.answerCbQuery('无效的请求');
      return;
    }

    const action = match[1];
    const permissionId = match[2];

    const allowed = action === 'allow' || action === 'allow-remember';
    const remember = action === 'allow-remember';

    await this.permissionHandler.handlePermissionResponse(ctx, permissionId, allowed, remember);
  }
}
