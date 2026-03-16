import type { Context, Telegraf } from 'telegraf';
import type { InlineKeyboardMarkup, Message, Update } from 'telegraf/types';
import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';
import type { OpenCodeClient } from '../opencode/client.js';
import type { SessionManager } from '../session/manager.js';
import type { PluginConfig, TelegramSession } from '../types.js';
import { WhitelistManager } from '../auth/whitelist.js';
import {
  formatCodeResponse,
  formatFileList,
  formatSessionOverview,
  formatStatus,
  formatTodos,
} from './formatters.js';

const execFile = promisify(execFileCallback);

export class BotHandlers {
  private static readonly LOCAL_COMMANDS = new Set([
    'pair',
    'start',
    'help',
    'status',
    'new',
    'sessions',
    'cd',
    'model',
    'agents',
    'ls',
    'cat',
    'tree',
    'code',
    'run',
    'shell',
    'todos',
  ]);

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
    this.bot.command('new', this.withWhitelist(this.handleNewSession.bind(this)));
    this.bot.command('sessions', this.withWhitelist(this.handleSessions.bind(this)));
    this.bot.command('cd', this.withWhitelist(this.handleCd.bind(this)));
    this.bot.command('model', this.withWhitelist(this.handleModel.bind(this)));
    this.bot.command('agents', this.withWhitelist(this.handleAgents.bind(this)));
    this.bot.action(/^sessions:(\d+)(?::(.*))?$/, this.handleSessionsPage.bind(this));

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
⚡ 执行命令
✅ 管理任务

 可用命令：
 /sessions - 查看 session 列表并用按钮翻页
 /sessions <序号> - 按列表序号载入 session
 /sessions <id前缀> - 按 id 前缀载入 session
 /sessions <关键词> - 检索 session
 /new [title] - 创建新会话
 /cd - 查看当前工作目录
 /model [id] - 查看或设置当前模型
 /model list [provider] - 本地列出模型
 /agents [name] - 查看或设置当前 agent
 /agents list - 本地列出 agent
 /code <描述> - 生成代码
 /ls [路径] - 列出文件
 /cat <文件> - 查看文件
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
/help - 显示 Telegram Bot 帮助（不会透传）
/status - 查看 OpenCode 状态
/new [title] - 创建新会话
/sessions - 查看 session 列表并用按钮翻页
/sessions <序号> - 按列表序号载入 session
/sessions <id前缀> - 按 id 前缀载入 session
/sessions <关键词> - 检索 session
/cd - 查看当前工作目录
/model - 查看当前模型设置
/model list [provider] - 本地列出可用模型
/model clear - 清除当前模型覆盖
/model <provider/model> - 设置后续消息使用的模型
/agents - 查看当前 agent 设置
/agents list - 本地列出可用 agent
/agents clear - 清除当前 agent 覆盖
/agents <name> - 设置后续消息使用的 agent

文件操作：
/ls [路径] - 列出目录文件
/cat <文件路径> - 查看文件内容
/tree - 显示目录树

代码操作：
/code <描述> - 让 AI 生成代码

命令执行：
/shell <命令> - 执行 shell 命令

任务管理：
/todos - 查看当前任务列表

 透传规则：
  - /sessions 是 Telegram 本地命令，用于检索、切换和按钮翻页
  - 当前 OpenCode 1.2.27 的 serve /command 端点不稳定，未知的 /命令 不再透传
  - 如果 OpenCode 返回内容过长，bot 会自动分段发送

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

  private async handleRun(ctx: Context<Update.MessageUpdate>): Promise<void> {
    await ctx.reply(this.getServeCommandUnavailableMessage('/run'));
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
        `/model list [provider] 本地列出模型`
      );
      return;
    }

    if (args[0] === 'list') {
      const text = await this.runLocalOpencode(['models', ...args.slice(1)]);
      await this.replyLong(ctx, text || '未返回模型列表');
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
        `/agents list 本地列出 agent`
      );
      return;
    }

    if (normalized === 'list') {
      const text = await this.runLocalOpencode(['agent', 'list']);
      await this.replyLong(ctx, text || '未返回 agent 列表');
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

  private async handleCd(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);

    if (args.length === 0) {
      try {
        const path = await this.opencode.getPath();
        const text = typeof path === 'string' ? path : JSON.stringify(path);
        await ctx.reply(`📂 当前目录\n\n${text}`);
      } catch (error) {
        await ctx.reply(`❌ 获取目录失败: ${error}`);
      }
      return;
    }

    await ctx.reply(this.getServeCommandUnavailableMessage('/cd'));
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
      `OpenCode 1.2.27 的 serve /command 端点会对 slash command 返回 500。\n` +
      `目前已本地适配的命令：/sessions、/model、/agents。\n` +
      `你仍然可以直接发送自然语言消息，或使用 /shell 执行本地命令。`
    );
  }

  private async runLocalOpencode(args: string[]): Promise<string> {
    try {
      const result = await execFile('opencode', args, {
        cwd: process.cwd(),
        env: process.env,
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 4,
      });

      const output = `${result.stdout}${result.stderr}`.trim();
      return output || '命令执行完成，但没有输出';
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      return `❌ 本地执行 opencode ${args.join(' ')} 失败: ${details}`;
    }
  }

  private async replyLong(ctx: Context<Update.MessageUpdate>, text: string): Promise<void> {
    const maxLength = Math.max(500, this.config.app.maxMessageLength - 200);

    if (text.length <= maxLength) {
      await ctx.reply(text);
      return;
    }

    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        await ctx.reply(remaining);
        break;
      }

      let splitAt = remaining.lastIndexOf('\n', maxLength);
      if (splitAt < Math.floor(maxLength / 2)) {
        splitAt = maxLength;
      }

      const chunk = remaining.slice(0, splitAt).trimEnd();
      await ctx.reply(chunk);
      remaining = remaining.slice(splitAt).trimStart();
    }
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
}
