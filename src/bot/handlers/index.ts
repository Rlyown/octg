import type { Context, Telegraf } from 'telegraf';
import type { Message, Update } from 'telegraf/types';
import type { OpenCodeClient } from '../../opencode/client.js';
import type { SessionManager } from '../../session/manager.js';
import type { PluginConfig, TelegramSession } from '../../types.js';
import { WhitelistManager } from '../../auth/whitelist.js';
import { SSEClient } from '../../opencode/oc-event.js';
import { PermissionHandler } from '../../opencode/permission-handler.js';
import { TaskHandler } from './task.js';
import { FileHandler } from './file.js';
import { GeneralHandler } from './general.js';
import { ModelHandler } from './model.js';
import { SessionHandler } from './session.js';

export interface HandlerContext {
  opencode: OpenCodeClient;
  sessions: SessionManager;
  config: PluginConfig;
  whitelist: WhitelistManager;
  bot: Telegraf;
  ensureSession(ctx: Context<Update.MessageUpdate>): Promise<TelegramSession | null>;
  shortId(value?: string): string;
}

export class BotHandlers {
  private static readonly LOCAL_COMMANDS = new Set([
    'pair', 'start', 'help', 'status', 'new', 'remove', 'sessions', 'cwd',
    'model', 'agents', 'ls', 'cat', 'task', 'shell', 'todos',
    'history', 'search', 'findfile', 'rename', 'fork', 'abort',
    'share', 'unshare', 'diff', 'summarize', 'projects', 'commands',
    'config', 'providers', 'status-all', 'children',
    'init', 'symbol', 'git-status', 'tools',
  ]);

  private bot: Telegraf;
  private opencode: OpenCodeClient;
  private sessions: SessionManager;
  private whitelist: WhitelistManager;
  private config: PluginConfig;
  private sseClient: SSEClient | null = null;
  private permissionHandler: PermissionHandler;

  private modelHandler: ModelHandler;
  private sessionHandler: SessionHandler;
  private fileHandler: FileHandler;
  private taskHandler: TaskHandler;
  private generalHandler: GeneralHandler;

  constructor(
    bot: Telegraf,
    opencode: OpenCodeClient,
    sessions: SessionManager,
    config: PluginConfig,
    whitelist: WhitelistManager
  ) {
    this.bot = bot;
    this.opencode = opencode;
    this.sessions = sessions;
    this.config = config;
    this.whitelist = whitelist;

    this.permissionHandler = new PermissionHandler(bot, opencode, sessions);

    const hctx: HandlerContext = {
      opencode: this.opencode,
      sessions: this.sessions,
      config: this.config,
      whitelist: this.whitelist,
      bot: this.bot,
      ensureSession: this.ensureSession.bind(this),
      shortId: this.shortId.bind(this),
    };

    this.modelHandler = new ModelHandler(hctx);
    this.sessionHandler = new SessionHandler(hctx, this.modelHandler);
    this.fileHandler = new FileHandler(hctx);
    this.taskHandler = new TaskHandler(hctx, this.modelHandler);
    this.generalHandler = new GeneralHandler(hctx);

    if (config.app.enableSSE !== false) {
      this.initSSE();
    }

    this.setupHandlers();
  }

  private shortId(value?: string): string {
    if (!value) {
      return 'unknown';
    }

    return value.slice(0, 8);
  }

  private summarizeOverrides(overrides: { model?: { providerID: string; modelID: string }; agent?: string }): string {
    const parts: string[] = [];

    if (overrides.model) {
      parts.push(`model=${overrides.model.providerID}/${overrides.model.modelID}`);
    }

    if (overrides.agent) {
      parts.push(`agent=${overrides.agent}`);
    }

    return parts.length > 0 ? parts.join(' ') : 'none';
  }

  private initSSE(): void {
    this.sseClient = new SSEClient(
      this.config.opencode.serverUrl,
      this.config.opencode.username,
      this.config.opencode.password
    );

    this.sseClient.on('permission.asked', (event) => {
      const props = event.properties as {
        id: string;
        sessionID: string;
        permission: string;
        patterns: string[];
        metadata: Record<string, unknown>;
        always: string[];
        tool?: { messageID: string; callID: string };
      };
      this.permissionHandler.handlePermissionRequest({
        sessionID: props.sessionID,
        permissionID: props.id,
        description: props.permission,
        tool: props.tool?.callID,
        action: props.patterns?.[0],
      });
    });

    this.sseClient.on('session.status', (event) => {
      const props = event.properties as { sessionID: string; status: { type: string } };
      if (props.status?.type === 'idle') {
        void this.taskHandler.resolveTaskJob(props.sessionID);
      }
    });

    this.sseClient.start();
  }

  private setupHandlers(): void {
    // Pairing command (must be first, before whitelist check)
    this.bot.command('pair', this.handlePair.bind(this));

    // Commands with whitelist check
    this.bot.command('start', this.withWhitelist(this.generalHandler.handleStart.bind(this.generalHandler)));
    this.bot.command('help', this.withWhitelist(this.generalHandler.handleHelp.bind(this.generalHandler)));
    this.bot.command('status', this.withWhitelist(this.sessionHandler.handleStatus.bind(this.sessionHandler)));
    this.bot.command('new', this.withWhitelist(this.sessionHandler.handleNewSession.bind(this.sessionHandler)));
    this.bot.command('remove', this.withWhitelist(this.sessionHandler.handleRemoveSessionCommand.bind(this.sessionHandler)));
    this.bot.command('sessions', this.withWhitelist(this.sessionHandler.handleSessions.bind(this.sessionHandler)));
    this.bot.command('cwd', this.withWhitelist(this.generalHandler.handleCwd.bind(this.generalHandler)));
    this.bot.command('model', this.withWhitelist(this.modelHandler.handleModel.bind(this.modelHandler)));
    this.bot.command('agents', this.withWhitelist(this.modelHandler.handleAgents.bind(this.modelHandler)));
    this.bot.action(/^sessions:(\d+)(?::(.*))?$/, this.sessionHandler.handleSessionsPage.bind(this.sessionHandler));

    // File operations
    this.bot.command('ls', this.withWhitelist(this.fileHandler.handleListFiles.bind(this.fileHandler)));
    this.bot.command('cat', this.withWhitelist(this.fileHandler.handleReadFile.bind(this.fileHandler)));
    this.bot.command('task', this.withWhitelist(this.taskHandler.handleTask.bind(this.taskHandler)));
    this.bot.command('shell', this.withWhitelist(this.taskHandler.handleShell.bind(this.taskHandler)));
    this.bot.command('todos', this.withWhitelist(this.generalHandler.handleTodos.bind(this.generalHandler)));
    this.bot.command('history', this.withWhitelist(this.generalHandler.handleHistory.bind(this.generalHandler)));
    this.bot.command('search', this.withWhitelist(this.fileHandler.handleSearch.bind(this.fileHandler)));
    this.bot.command('findfile', this.withWhitelist(this.fileHandler.handleFindFile.bind(this.fileHandler)));
    this.bot.command('rename', this.withWhitelist(this.sessionHandler.handleRenameSession.bind(this.sessionHandler)));
    this.bot.command('fork', this.withWhitelist(this.sessionHandler.handleForkSession.bind(this.sessionHandler)));
    this.bot.command('abort', this.withWhitelist(this.sessionHandler.handleAbortSession.bind(this.sessionHandler)));
    this.bot.command('share', this.withWhitelist(this.sessionHandler.handleShareSession.bind(this.sessionHandler)));
    this.bot.command('unshare', this.withWhitelist(this.sessionHandler.handleUnshareSession.bind(this.sessionHandler)));
    this.bot.command('diff', this.withWhitelist(this.sessionHandler.handleDiff.bind(this.sessionHandler)));
    this.bot.command('summarize', this.withWhitelist(this.sessionHandler.handleSummarize.bind(this.sessionHandler)));
    this.bot.command('projects', this.withWhitelist(this.generalHandler.handleProjects.bind(this.generalHandler)));
    this.bot.command('commands', this.withWhitelist(this.generalHandler.handleCommands.bind(this.generalHandler)));
    this.bot.command('config', this.withWhitelist(this.generalHandler.handleConfig.bind(this.generalHandler)));
    this.bot.command('providers', this.withWhitelist(this.generalHandler.handleProviders.bind(this.generalHandler)));
    this.bot.command('status-all', this.withWhitelist(this.generalHandler.handleStatusAll.bind(this.generalHandler)));
    this.bot.command('children', this.withWhitelist(this.sessionHandler.handleChildren.bind(this.sessionHandler)));
    this.bot.command('init', this.withWhitelist(this.fileHandler.handleInit.bind(this.fileHandler)));
    this.bot.command('symbol', this.withWhitelist(this.fileHandler.handleSymbol.bind(this.fileHandler)));
    this.bot.command('git-status', this.withWhitelist(this.fileHandler.handleGitStatus.bind(this.fileHandler)));
    this.bot.command('tools', this.withWhitelist(this.fileHandler.handleTools.bind(this.fileHandler)));

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

    const success = this.whitelist.usePairingCode(code, idToCheck, type, {
      username: ctx.from?.username,
      title: isGroup ? (ctx.chat as { title?: string }).title : undefined,
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

    if (!chatId) {
      await ctx.reply('无法获取会话信息');
      return null;
    }

    // Check allowed users
    if (this.config.telegram.allowedUserIds.length > 0) {
      if (!userId || !this.config.telegram.allowedUserIds.includes(userId)) {
        await ctx.reply('你没有权限使用此 Bot');
        return null;
      }
    }

    const session = this.sessions.get();
    if (!session) {
      await ctx.reply('还没有会话，使用 /new <绝对路径> [标题] 创建。');
      return null;
    }

    if (!session.telegramChatId) {
      session.telegramChatId = chatId;
    }

    if (!session.directory) {
      const live = await this.opencode.getSession(session.openCodeSessionId).catch(() => null);
      if (live?.directory) {
        session.directory = live.directory;
        this.sessions.set(session);
      }
    }

    this.sessions.updateActivity();
    return session;
  }

  private async handleMessage(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const message = ctx.message as Message.TextMessage;
    const requestStartedAt = Date.now();

    if (message.text?.startsWith('/')) {
      const [rawCommand] = message.text.slice(1).split(' ');
      const command = rawCommand.trim();

      if (!BotHandlers.LOCAL_COMMANDS.has(command)) {
        await ctx.reply(this.getServeCommandUnavailableMessage(`/${command}`));
      }
      return;
    }

    let session = this.sessions.get();
    if (!session) {
      await ctx.reply('还没有会话，使用 /new <绝对路径> [标题] 创建。');
      return;
    }
    if (!session.telegramChatId) {
      session.telegramChatId = ctx.chat?.id.toString() || '';
      await ctx.reply(`📎 已关联到当前 session\n\n🪪 ${this.shortId(session.openCodeSessionId)}\n🏷️ ${session.openCodeSessionTitle || 'Untitled'}`);
    }
    this.sessions.updateActivity();

    const processingMsg = await ctx.reply('🤔 思考中...');

    try {
      const overrideStartedAt = Date.now();
      console.log(`[octg][chat] user=${userId} session=${this.shortId(session.openCodeSessionId)} stage=overrides start`);
      const overrides = await this.modelHandler.getOverrides(session);
      console.log(
        `[octg][chat] user=${userId} session=${this.shortId(session.openCodeSessionId)} stage=overrides ok duration=${Date.now() - overrideStartedAt}ms overrides=${this.summarizeOverrides(overrides)}`
      );

      console.log(
        `[octg][chat] user=${userId} session=${this.shortId(session.openCodeSessionId)} stage=message_request start textLength=${message.text.length}`
      );
      const response = await this.opencode.sendMessageWithOverrides(
        session.openCodeSessionId,
        message.text,
        overrides,
        { directory: session.directory }
      );

      console.log(
        `[octg][chat] user=${userId} session=${this.shortId(session.openCodeSessionId)} stage=message_request ok duration=${Date.now() - requestStartedAt}ms parts=${response.parts.length}`
      );

      await ctx.deleteMessage(processingMsg.message_id);

      const text = response.parts.map(p => p.text).join('\n');

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
      const messageText = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error(
        `[octg][chat] user=${userId} session=${this.shortId(session.openCodeSessionId)} stage=message_request failed duration=${Date.now() - requestStartedAt}ms error=${messageText}`
      );
      await ctx.reply(`❌ 错误: ${error}`);
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

  private handleError(err: unknown, ctx: Context<Update>): void {
    console.error('Bot error:', err);
    ctx.reply('发生错误，请稍后重试').catch(console.error);
  }

  private getServeCommandUnavailableMessage(command: string): string {
    return (
      `⚠️ ${command} 当前不可用\n\n` +
      `该命令未实现或 OpenCode serve 端点不稳定。\n` +
      `请使用 /help 查看可用命令列表。`
    );
  }
}
