import type { Context } from 'telegraf';
import type { InlineKeyboardMarkup, Message, Update } from 'telegraf/types';
import type { TelegramSession } from '../../types.js';
import { formatSessionOverview, formatStatus } from '../formatters.js';
import type { HandlerContext } from './index.js';
import type { ModelHandler } from './model.js';

export class SessionHandler {
  constructor(
    private hctx: HandlerContext,
    private modelHandler: ModelHandler
  ) {}

  async handleNewSession(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);
    const title = args.join(' ').trim() || undefined;
    const oldSession = this.hctx.sessions.get();

    try {
      const openCodeSession = await this.hctx.opencode.createSession(title);
      const session: TelegramSession = {
        telegramChatId: ctx.chat?.id.toString() || '',
        openCodeSessionId: openCodeSession.id,
        openCodeSessionTitle: openCodeSession.title,
        preferredModel: oldSession?.preferredModel,
        preferredAgent: oldSession?.preferredAgent,
        createdAt: new Date(openCodeSession.time.created),
        lastActivity: new Date(openCodeSession.time.updated),
      };

      this.hctx.sessions.set(session);
      await ctx.reply(
        `✅ 已创建新会话\n\n` +
        `🪪 ${session.openCodeSessionId.slice(0, 12)}...\n` +
        `🏷️ ${openCodeSession.title || title || 'Untitled'}`
      );
    } catch (error) {
      await ctx.reply(`❌ 创建新会话失败: ${error}`);
    }
  }

  async handleSessions(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);

    if (args.length === 0) {
      await this.handleListSessions(ctx);
      return;
    }

    const parsed = this.parseSessionsArgs(args);

    if (parsed.removeTarget) {
      await this.removeSession(ctx, parsed.removeTarget);
      return;
    }

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

  async handleListSessions<T extends Update.MessageUpdate | Update.CallbackQueryUpdate>(
    ctx: Context<T>,
    options: { query?: string; page?: number } = {}
  ): Promise<void> {
    const userId = ctx.from?.id.toString();
    if (!userId) {
      await ctx.reply('无法获取用户信息');
      return;
    }

    if (this.hctx.config.telegram.allowedUserIds.length > 0) {
      if (!this.hctx.config.telegram.allowedUserIds.includes(userId)) {
        await ctx.reply('你没有权限使用此 Bot');
        return;
      }
    }

    try {
      const sessions = await this.hctx.opencode.listSessions();
      const currentSession = this.hctx.sessions.get();
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
        const callbackCtx = ctx as unknown as Context<Update.CallbackQueryUpdate>;
        await callbackCtx.editMessageText(
          text,
          replyMarkup ? { reply_markup: replyMarkup } : undefined
        );
        await callbackCtx.answerCbQuery();
        return;
      }

      await ctx.reply(text, replyMarkup ? { reply_markup: replyMarkup } : undefined);
    } catch (error) {
      if ('callback_query' in ctx.update && 'answerCbQuery' in ctx) {
        const callbackCtx = ctx as unknown as Context<Update.CallbackQueryUpdate>;
        await callbackCtx.answerCbQuery('加载失败');
      }
      await ctx.reply(`❌ 获取 session 列表失败: ${error}`);
    }
  }

  async handleSessionsPage(ctx: Context<Update.CallbackQueryUpdate>): Promise<void> {
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

  async handleRenameSession(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const newTitle = message.text.replace('/rename', '').trim();

    if (!newTitle) {
      await ctx.reply('请提供新名称，例如: /rename 修复登录 bug');
      return;
    }

    try {
      const updated = await this.hctx.opencode.updateSession(session.openCodeSessionId, newTitle);
      session.openCodeSessionTitle = updated.title;
      this.hctx.sessions.set(session);
      await ctx.reply(`✅ 已重命名为: ${updated.title || newTitle}`);
    } catch (error) {
      await ctx.reply(`❌ 重命名失败: ${error}`);
    }
  }

  async handleForkSession(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);
    const messageId = args[0] || undefined;

    try {
      const forked = await this.hctx.opencode.forkSession(session.openCodeSessionId, messageId);
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

  async handleAbortSession(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    try {
      const success = await this.hctx.opencode.abortSession(session.openCodeSessionId);
      if (success) {
        await ctx.reply('✅ 已中止会话');
      } else {
        await ctx.reply('⚠️ 会话未在运行或中止失败');
      }
    } catch (error) {
      await ctx.reply(`❌ 中止失败: ${error}`);
    }
  }

  async handleShareSession(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    try {
      const shared = await this.hctx.opencode.shareSession(session.openCodeSessionId);
      await ctx.reply(`✅ 会话已分享\n\n🏷️ ${shared.title || 'Untitled'}`);
    } catch (error) {
      await ctx.reply(`❌ 分享失败: ${error}`);
    }
  }

  async handleUnshareSession(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    try {
      await this.hctx.opencode.unshareSession(session.openCodeSessionId);
      await ctx.reply('✅ 已取消分享');
    } catch (error) {
      await ctx.reply(`❌ 取消分享失败: ${error}`);
    }
  }

  async handleDiff(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const args = message.text.split(' ').slice(1);
    const messageId = args[0] || undefined;

    try {
      const diffs = await this.hctx.opencode.getSessionDiff(session.openCodeSessionId, messageId);
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

  async handleSummarize(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    const processingMsg = await ctx.reply('📝 正在总结会话...');

    try {
      const success = await this.hctx.opencode.summarizeSession(
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

  async handleChildren(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    try {
      const children = await this.hctx.opencode.getSessionChildren(session.openCodeSessionId);
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

  async handleStatus(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    try {
      const health = await this.hctx.opencode.health();
      const project = await this.hctx.opencode.getProject();
      const path = await this.hctx.opencode.getPath();
      const todos = await this.hctx.opencode.getTodos(session.openCodeSessionId);
      const liveSession = await this.hctx.opencode.getSession(session.openCodeSessionId).catch(() => null);
      const resolvedModel = await this.modelHandler.getResolvedModelInfo(session);

      if (liveSession?.title && liveSession.title !== session.openCodeSessionTitle) {
        session.openCodeSessionTitle = liveSession.title;
      }

      await ctx.reply(
        formatStatus({
          version: health.version,
          project,
          path,
          todosCount: todos.length,
          sessionId: session.openCodeSessionId,
          sessionTitle: liveSession?.title || session.openCodeSessionTitle,
          overrides: await this.modelHandler.getOverrides(session),
          modelLabel: resolvedModel.label,
          agentLabel: session.preferredAgent || 'OpenCode default',
        })
      );
    } catch (error) {
      await ctx.reply(`❌ 获取状态失败: ${error}`);
    }
  }

  private async attachToSession(ctx: Context<Update.MessageUpdate>, requestedId: string): Promise<void> {
    const userId = ctx.from?.id.toString();
    const chatId = ctx.chat?.id.toString();

    if (!userId || !chatId) {
      await ctx.reply('无法获取用户信息');
      return;
    }

    try {
      const sessions = await this.hctx.opencode.listSessions();
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

      const openCodeSession = await this.hctx.opencode.getSession(prefixMatches[0].id);
      const oldSession = this.hctx.sessions.get();

      const session: TelegramSession = {
        telegramChatId: chatId,
        openCodeSessionId: openCodeSession.id,
        openCodeSessionTitle: openCodeSession.title,
        preferredModel: oldSession?.preferredModel,
        preferredAgent: oldSession?.preferredAgent,
        createdAt: new Date(openCodeSession.time.created),
        lastActivity: new Date(openCodeSession.time.updated),
      };

      this.hctx.sessions.set(session);

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
      const sessions = await this.hctx.opencode.listSessions();
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

  private async removeSession(ctx: Context<Update.MessageUpdate>, target: string): Promise<void> {
    const userId = ctx.from?.id.toString();
    if (!userId) {
      await ctx.reply('无法获取用户信息');
      return;
    }

    try {
      const sessions = await this.hctx.opencode.listSessions();
      const resolved = this.resolveSessionTarget(sessions, target);

      if (resolved.error) {
        await ctx.reply(resolved.error);
        return;
      }

      const sessionToRemove = resolved.session!;
      await this.hctx.opencode.deleteSession(sessionToRemove.id);

      const currentSession = this.hctx.sessions.get();
      const isCurrent = currentSession?.openCodeSessionId === sessionToRemove.id;
      if (isCurrent) {
        this.hctx.sessions.clear();
      }

      await ctx.reply(
        `✅ 已删除 session\n\n` +
        `🪪 ${sessionToRemove.id.slice(0, 12)}...\n` +
        `🏷️ ${sessionToRemove.title || 'Untitled'}${isCurrent ? '\n\n当前绑定也已清除，发送任意消息或用 /new 可创建新会话。' : ''}`
      );
    } catch (error) {
      await ctx.reply(`❌ 删除 session 失败: ${error}`);
    }
  }

  private resolveSessionTarget(
    sessions: Array<{ id: string; title?: string }>,
    target: string
  ): { session?: { id: string; title?: string }; error?: string } {
    const normalized = target.trim();
    if (!normalized) {
      return {
        error: '❌ 请提供要删除的 session 序号或 id\n\n例如：/sessions remove 3',
      };
    }

    if (/^\d+$/.test(normalized)) {
      const index = Number.parseInt(normalized, 10);
      const session = sessions[index - 1];
      if (!session) {
        return {
          error: `❌ 找不到序号 ${index} 对应的 session\n\n用 /sessions 查看可用列表`,
        };
      }

      return { session };
    }

    const exact = sessions.find(session => session.id === normalized);
    const matches = exact ? [exact] : sessions.filter(session => session.id.startsWith(normalized));

    if (matches.length === 0) {
      return {
        error: `❌ 找不到 session: ${normalized}\n\n用 /sessions 查看可用列表`,
      };
    }

    if (matches.length > 1) {
      const options = matches.slice(0, 5).map(session => `${session.id.slice(0, 12)}...  ${session.title || 'Untitled'}`);
      return {
        error: `⚠️ 前缀匹配到多个 session，请提供更长的 id:\n\n${options.join('\n')}`,
      };
    }

    return { session: matches[0] };
  }

  private filterSessions(sessions: Array<any>, query?: string) {
    if (!query) return sessions;

    const normalized = query.toLowerCase();
    return sessions.filter((session: any) => {
      const id = String(session.id || '').toLowerCase();
      const title = String(session.title || '').toLowerCase();
      return id.includes(normalized) || title.includes(normalized);
    });
  }

  private parseSessionsArgs(args: string[]): {
    index?: number;
    query?: string;
    lookup?: string;
    removeTarget?: string;
  } {
    if (args.length === 0) {
      return {};
    }

    const [command, ...rest] = args;
    if ((command === 'remove' || command === 'rm' || command === 'delete' || command === 'del') && rest.length > 0) {
      return {
        removeTarget: rest.join(' ').trim(),
      };
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
}
