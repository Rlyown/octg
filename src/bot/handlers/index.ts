import type { Context, Telegraf } from 'telegraf';
import type { Message, Update } from 'telegraf/types';
import type { OpenCodeClient } from '../../opencode/client.js';
import type { SessionManager } from '../../session/manager.js';
import type { MessageDetail, PluginConfig, TelegramSession } from '../../types.js';
import { WhitelistManager } from '../../auth/whitelist.js';
import { SSEClient } from '../../opencode/oc-event.js';
import { PermissionHandler } from '../../opencode/permission-handler.js';
import { getLogger } from '../../logger.js';
import { formatCodeResponse } from '../formatters.js';
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
    'model', 'agents', 'plan', 'build', 'ls', 'cat', 'task', 'shell', 'todos',
    'history', 'search', 'findfile', 'rename', 'fork', 'abort',
    'share', 'unshare', 'diff', 'summarize', 'projects', 'commands',
    'config', 'providers', 'status_all', 'children',
    'init', 'symbol', 'git_status', 'tools',
  ]);
  private bot: Telegraf;
  private opencode: OpenCodeClient;
  private sessions: SessionManager;
  private whitelist: WhitelistManager;
  private config: PluginConfig;
  private sseClient: SSEClient | null = null;
  private permissionHandler: PermissionHandler;
  private logger = getLogger('chat');

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

    const handlePermissionEvent = (event: { properties: unknown }) => {
      const props = (event.properties && typeof event.properties === 'object')
        ? event.properties as Record<string, unknown>
        : {};
      const tool = (props.tool && typeof props.tool === 'object') ? props.tool as Record<string, unknown> : undefined;
      const patterns = Array.isArray(props.patterns) ? props.patterns : [];
      const sessionID = typeof props.sessionID === 'string'
        ? props.sessionID
        : typeof props.sessionId === 'string'
          ? props.sessionId
          : '';
      const permissionID = typeof props.id === 'string'
        ? props.id
        : typeof props.permissionID === 'string'
          ? props.permissionID
          : typeof props.permissionId === 'string'
            ? props.permissionId
            : '';
      const description = typeof props.permission === 'string'
        ? props.permission
        : typeof props.description === 'string'
          ? props.description
          : undefined;

      if (!sessionID || !permissionID) {
        this.logger.warn('permission event missing identifiers');
        return;
      }

      this.permissionHandler.handlePermissionRequest({
        sessionID,
        permissionID,
        description,
        tool: typeof tool?.callID === 'string' ? tool.callID : undefined,
        action: typeof patterns[0] === 'string' ? patterns[0] : undefined,
      });
    };

    this.sseClient.on('permission.asked', handlePermissionEvent);
    this.sseClient.on('session.permission.requested', handlePermissionEvent);

    this.sseClient.on('session.status', (event) => {
      const props = event.properties as { sessionID?: string; sessionId?: string; status: { type: string } };
      // Support both sessionID and sessionId property names
      const sessionID = props.sessionID || props.sessionId;
      if (!sessionID) {
        this.logger.warn('SSE session.status event missing sessionID/sessionId property');
        return;
      }
      if (props.status?.type === 'idle') {
        this.logger.debug(`SSE session.status idle event received for session=${this.shortId(sessionID)}`);
        void this.taskHandler.resolveTaskJob(sessionID);
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
    this.bot.command('plan', this.withWhitelist((ctx) => this.modelHandler.handleNamedAgent(ctx, 'plan')));
    this.bot.command('build', this.withWhitelist((ctx) => this.modelHandler.handleNamedAgent(ctx, 'build')));
    this.bot.action(/^sessions:(\d+)(?::(.*))?$/, this.sessionHandler.handleSessionsPage.bind(this.sessionHandler));
    this.bot.action(/^models:(page:\d+|set:\d+|set:\d+:\d+|noop|provider:[^:]+|providers:page:\d+|provider:[^:]+:page:\d+|back:providers)$/, this.modelHandler.handleModelAction.bind(this.modelHandler));

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
    this.bot.command('status_all', this.withWhitelist(this.generalHandler.handleStatusAll.bind(this.generalHandler)));
    this.bot.command('children', this.withWhitelist(this.sessionHandler.handleChildren.bind(this.sessionHandler)));
    this.bot.command('init', this.withWhitelist(this.fileHandler.handleInit.bind(this.fileHandler)));
    this.bot.command('symbol', this.withWhitelist(this.fileHandler.handleSymbol.bind(this.fileHandler)));
    this.bot.command('git_status', this.withWhitelist(this.fileHandler.handleGitStatus.bind(this.fileHandler)));
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
    }
    this.sessions.updateActivity();

    const processingMsg = await ctx.reply('🤔 思考中...');

    try {
      const overrideStartedAt = Date.now();
      this.logger.debug(`user=${userId} session=${this.shortId(session.openCodeSessionId)} stage=overrides start`);
      const overrides = await this.modelHandler.getOverrides(session);
      this.logger.debug(
        `user=${userId} session=${this.shortId(session.openCodeSessionId)} stage=overrides ok duration=${Date.now() - overrideStartedAt}ms overrides=${this.summarizeOverrides(overrides)}`
      );

      this.logger.debug(
        `user=${userId} session=${this.shortId(session.openCodeSessionId)} stage=message_request start textLength=${message.text.length}`
      );
      await this.prepareSessionForNewMessage(session.openCodeSessionId, session.directory);

      const response = await this.opencode.sendMessageWithOverrides(
        session.openCodeSessionId,
        message.text,
        overrides,
        { directory: session.directory }
      );

      this.logger.info(
        `user=${userId} session=${this.shortId(session.openCodeSessionId)} stage=message_request completed sync`
      );

      const errorText = this.extractResponseErrorText(response as MessageDetail);

      if (errorText) {
        await this.editOrSendChatMessage(session.telegramChatId, processingMsg.message_id, `❌ 错误:\n${errorText}`);
        return;
      }

      const responseText = this.extractDisplayText(response as MessageDetail);
      if (responseText) {
        const formatted = formatCodeResponse(responseText).trim();
        await this.editOrSendChatMessage(
          session.telegramChatId,
          processingMsg.message_id,
          formatted || responseText,
          responseText,
        );
        return;
      }

      const handledNonText = await this.handleNonTextSyncResponse(
        response as MessageDetail,
        session.telegramChatId,
        processingMsg.message_id,
      );

      if (handledNonText) {
        return;
      }

      await this.editOrSendChatMessage(
        session.telegramChatId,
        processingMsg.message_id,
        '✅ 请求已完成，但当前没有可显示的文本输出。'
      );
    } catch (error) {
      const messageText = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      this.logger.error(
        `user=${userId} session=${this.shortId(session.openCodeSessionId)} stage=message_request failed duration=${Date.now() - requestStartedAt}ms error=${messageText}`
      );

      const isTimeout = error instanceof Error && (
        error.name === 'AbortError' ||
        error.message.includes('aborted') ||
        error.message.includes('timeout')
      );

      const isFetchFailure = error instanceof Error && error.message.includes('fetch failed');

      if (isTimeout || isFetchFailure) {
        const handled = await this.handleBlockedChatRequest(
          session.openCodeSessionId,
          session.directory,
          session.telegramChatId,
          processingMsg.message_id,
        );

        if (handled) {
          return;
        }
      }

      if (isTimeout) {
        this.logger.info(`user=${userId} session=${this.shortId(session.openCodeSessionId)} aborting session after timeout`);
        await this.opencode.abortSession(session.openCodeSessionId, { directory: session.directory }).catch(() => {});
        await ctx.reply(
          `⏱️ 请求超时\n\n` +
          `OpenCode 处理时间过长，已自动中止。\n` +
          `你可以继续发送新消息。`
        );
      } else {
        await ctx.reply(`❌ 错误: ${messageText}`);
      }
    }
  }

  private extractDisplayText(message?: MessageDetail): string {
    if (!message) {
      return '';
    }

    return message.parts
      .filter((part) => part.type === 'text')
      .map((part) => {
        if (typeof part.text === 'string' && part.text.trim().length > 0) {
          return part.text;
        }

        if (typeof part.content === 'string' && part.content.trim().length > 0) {
          return part.content;
        }

        return '';
      })
      .filter((text) => text.length > 0)
      .join('\n')
      .trim();
  }

  private extractResponseErrorText(message?: MessageDetail): string {
    if (!message) {
      return '';
    }

    const partErrors = message.parts
      .filter((part) => part.type === 'error')
      .map((part) => typeof part.text === 'string' ? part.text : (typeof part.content === 'string' ? part.content : ''))
      .filter((text) => text.trim().length > 0);

    const info = message.info as unknown as Record<string, unknown>;
    const rawInfoError = info.error;
    let infoError = '';

    if (typeof rawInfoError === 'string') {
      infoError = rawInfoError;
    } else if (rawInfoError && typeof rawInfoError === 'object') {
      const errorRecord = rawInfoError as Record<string, unknown>;
      const data = errorRecord.data && typeof errorRecord.data === 'object'
        ? errorRecord.data as Record<string, unknown>
        : undefined;
      infoError = [
        typeof errorRecord.name === 'string' ? errorRecord.name : '',
        typeof data?.message === 'string' ? data.message : '',
        typeof errorRecord.message === 'string' ? errorRecord.message : '',
      ].filter((text) => text.trim().length > 0).join(': ');
    }

    return [...partErrors, infoError]
      .filter((text) => text.trim().length > 0)
      .join('\n')
      .trim();
  }

  private messageHasRunningTool(message?: MessageDetail): boolean {
    if (!message) {
      return false;
    }

    return message.parts.some((part) => {
      if (part.type !== 'tool') {
        return false;
      }

      const toolPart = part as { state?: unknown };
      if (!toolPart.state || typeof toolPart.state !== 'object') {
        return false;
      }

      return (toolPart.state as Record<string, unknown>).status === 'running';
    });
  }

  private messageHasToolArtifacts(message?: MessageDetail): boolean {
    if (!message) {
      return false;
    }

    return message.parts.some((part) => (
      part.type === 'tool'
      || part.type === 'tool_use'
      || part.type === 'tool_result'
      || part.type === 'step-start'
      || part.type === 'step-finish'
    ));
  }

  private async handleNonTextSyncResponse(
    response: MessageDetail,
    chatId: string,
    processingMessageId?: number,
  ): Promise<boolean> {
    const pendingPermissions = this.permissionHandler.getPendingCount();
    const hasRunningTool = this.messageHasRunningTool(response);
    const hasToolArtifacts = this.messageHasToolArtifacts(response);

    if (!hasRunningTool && !hasToolArtifacts && pendingPermissions === 0) {
      return false;
    }

    const guidance = pendingPermissions > 0
      ? '🔐 当前请求正在等待权限确认。\n\n请在权限消息中选择允许或拒绝，然后再继续。'
      : hasRunningTool
        ? '⏳ 当前请求已经进入工具执行阶段，但还没有生成最终文本回复。\n\n请稍等片刻，或到 OpenCode 侧查看执行状态。'
        : '🛠️ 当前请求返回了工具状态或结果，但没有生成可显示的文本总结。\n\n请到 OpenCode 侧查看详细结果，或让我继续总结这次执行结果。';

    await this.editOrSendChatMessage(chatId, processingMessageId, guidance, guidance);
    return true;
  }

  private async handleBlockedChatRequest(
    sessionID: string,
    directory: string | undefined,
    chatId: string,
    processingMessageId?: number,
  ): Promise<boolean> {
    try {
      const messages = await this.opencode.listMessages(sessionID, 20, { directory });
      const assistantMessages = messages.filter((message) => message.info.role === 'assistant');
      const latestAssistant = assistantMessages[assistantMessages.length - 1];
      if (!latestAssistant) {
        return false;
      }

      const assistantText = this.extractDisplayText(latestAssistant);
      const hasRunningTool = this.messageHasRunningTool(latestAssistant);
      const pendingPermissions = this.permissionHandler.getPendingCount();

      if (!hasRunningTool && pendingPermissions === 0) {
        return false;
      }

      const summary = assistantText
        ? `${assistantText}\n\n`
        : '';

      const guidance = pendingPermissions > 0
        ? '🔐 当前请求正在等待权限确认。\n\n请在权限消息中选择允许或拒绝，然后再继续。'
        : '⏳ 当前请求已经进入需要权限或工具执行的阶段，但 OpenCode 没有把权限事件回传到 Telegram。\n\n请到 OpenCode 侧继续处理，或使用 /abort 中止后再重试。';

      await this.editOrSendChatMessage(
        chatId,
        processingMessageId,
        `${summary}${guidance}`,
        `${summary}${guidance}`,
      );
      return true;
    } catch (error) {
      this.logger.error(`handleBlockedChatRequest failed session=${this.shortId(sessionID)}:`, error);
      return false;
    }
  }

  private async prepareSessionForNewMessage(
    sessionID: string,
    directory: string | undefined,
  ): Promise<void> {
    try {
      const messages = await this.opencode.listMessages(sessionID, 20, { directory });
      const assistantMessages = messages.filter((message) => message.info.role === 'assistant');
      const latestAssistant = assistantMessages[assistantMessages.length - 1];

      if (!this.messageHasRunningTool(latestAssistant)) {
        return;
      }

      this.logger.warn(`session=${this.shortId(sessionID)} has stale running tool; aborting before new message`);
      await this.opencode.abortSession(sessionID, { directory }).catch(() => {});
    } catch (error) {
      this.logger.warn(`prepareSessionForNewMessage failed session=${this.shortId(sessionID)}: ${error}`);
    }
  }

  private async editOrSendChatMessage(
    chatId: string,
    messageId: number | undefined,
    text: string,
    fallbackText?: string,
  ): Promise<void> {
    const content = text.trim();
    if (!content) {
      return;
    }

    if (messageId) {
      try {
        await this.bot.telegram.editMessageText(chatId, messageId, undefined, content, { parse_mode: 'Markdown' });
        return;
      } catch {
        try {
          await this.bot.telegram.editMessageText(chatId, messageId, undefined, content);
          return;
        } catch {
          // fall through to send a new message
        }
      }
    }

    const plainText = (fallbackText || content).trim();
    await this.bot.telegram.sendMessage(chatId, content, { parse_mode: 'Markdown' }).catch(() => this.bot.telegram.sendMessage(chatId, plainText)).catch(() => {});
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
    this.logger.error('Bot error:', err);
    ctx.reply('发生错误，请稍后重试').catch((error: unknown) => {
      this.logger.error(error);
    });
  }

  private getServeCommandUnavailableMessage(command: string): string {
    return (
      `⚠️ ${command} 当前不可用\n\n` +
      `该命令未实现或 OpenCode serve 端点不稳定。\n` +
      `请使用 /help 查看可用命令列表。`
    );
  }
}
