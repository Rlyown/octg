import type { Context } from 'telegraf';
import type { Message, Update } from 'telegraf/types';
import { formatCodeResponse } from '../formatters.js';
import type { HandlerContext } from './index.js';
import type { ModelHandler } from './model.js';

export class TaskHandler {
  static readonly TASK_JOB_TIMEOUT_MS = 3 * 60 * 1000;

  readonly pendingTaskJobs = new Map<string, {
    chatId: string;
    startedAt: number;
    messageCountBefore: number;
    timeoutTimer: NodeJS.Timeout;
  }>();

  constructor(
    private hctx: HandlerContext,
    private modelHandler: ModelHandler
  ) {}

  async handleTask(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    const sessionId = session.openCodeSessionId;

    if (this.pendingTaskJobs.has(sessionId)) {
      await ctx.reply('⏳ 当前 session 已有进行中的 /task 任务，请等待完成或使用 /abort 中止。');
      return;
    }

    const message = ctx.message as Message.TextMessage;
    const prompt = message.text.replace('/task', '').trim();

    if (!prompt) {
      await ctx.reply('请提供任务描述，例如: /task 创建一个 React 按钮组件');
      return;
    }

    try {
      const messages = await this.hctx.opencode.listMessages(sessionId, 50, {
        directory: session.directory,
      });
      const messageCountBefore = messages.filter((m) => m.info.role === 'assistant').length;
      const overrides = await this.modelHandler.getOverrides(session);

      await this.hctx.opencode.sendMessageAsyncWithOverrides(sessionId, prompt, overrides, {
        directory: session.directory,
      });

      const timeoutTimer = setTimeout(() => {
        const job = this.pendingTaskJobs.get(sessionId);
        if (!job) return;
        this.pendingTaskJobs.delete(sessionId);
        void this.hctx.bot.telegram.sendMessage(
          job.chatId,
          '⚠️ 代码任务超时，仍在运行或结果未同步。\n\n请稍后用 /history 查看结果，或用 /abort 中止。'
        ).catch(() => {});
      }, TaskHandler.TASK_JOB_TIMEOUT_MS);

      this.pendingTaskJobs.set(sessionId, {
        chatId: session.telegramChatId,
        startedAt: Date.now(),
        messageCountBefore,
        timeoutTimer,
      });

      const summarized = this.modelHandler.parseModelOverride(
        (await this.modelHandler.getResolvedModelInfo(session)).label
      );
      const overrideSummary = summarized
        ? `model=${summarized.providerID}/${summarized.modelID}`
        : 'none';

      await ctx.reply(
        `🚀 代码任务已提交\n\n` +
        `⚙️ ${overrideSummary}\n\n` +
        `完成后自动推送结果，如需中止可用 /abort。`
      );
    } catch (error) {
      await ctx.reply(`❌ 提交代码任务失败: ${error}`);
    }
  }

  async handleShell(ctx: Context<Update.MessageUpdate>): Promise<void> {
    const session = await this.hctx.ensureSession(ctx);
    if (!session) return;

    const message = ctx.message as Message.TextMessage;
    const command = message.text.replace('/shell', '').trim();

    if (!command) {
      await ctx.reply('请提供 shell 命令，例如: /shell ls -la');
      return;
    }

    const processingMsg = await ctx.reply(`🔧 执行 shell: ${command}`);

    try {
      const response = await this.hctx.opencode.executeShell(
        session.openCodeSessionId,
        command,
        await this.modelHandler.getOverrides(session),
        { directory: session.directory }
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

  async resolveTaskJob(sessionID: string): Promise<void> {
    const job = this.pendingTaskJobs.get(sessionID);
    if (!job) return;

    this.pendingTaskJobs.delete(sessionID);
    clearTimeout(job.timeoutTimer);

    try {
      const activeSession = this.hctx.sessions.get();
      const messages = await this.hctx.opencode.listMessages(sessionID, 50, {
        directory: activeSession?.openCodeSessionId === sessionID ? activeSession.directory : undefined,
      });
      const assistantMessages = messages.filter((m) => m.info.role === 'assistant');
      const sid = this.hctx.shortId(sessionID);
      console.log(
        `[octg][task] resolveTaskJob session=${sid}` +
        ` totalMessages=${messages.length} assistantMessages=${assistantMessages.length}` +
        ` messageCountBefore=${job.messageCountBefore}`
      );

      const extractText = (m: typeof assistantMessages[0]) =>
        m.parts
          .filter((p) => p.type === 'text' && typeof p.text === 'string' && p.text.length > 0)
          .map((p) => p.text as string)
          .join('\n')
          .trim();

      const newAssistantMessages = assistantMessages.slice(job.messageCountBefore);
      const textMessages = newAssistantMessages
        .map((m) => ({ id: m.info.id, text: extractText(m) }))
        .filter((m) => m.text.length > 0);

      console.log(
        `[octg][task] resolveTaskJob session=${sid}` +
        ` newAssistant=${newAssistantMessages.length} withText=${textMessages.length}`
      );

      if (textMessages.length === 0) {
        console.warn(`[octg][code] no text messages found session=${sid}`);
        await this.hctx.bot.telegram.sendMessage(job.chatId, '⚠️ 任务已完成，但未找到文字回复。');
        return;
      }

      for (const msg of textMessages) {
        const formatted = formatCodeResponse(msg.text);
        await this.hctx.bot.telegram.sendMessage(job.chatId, formatted, { parse_mode: 'Markdown' })
          .catch(() =>
            this.hctx.bot.telegram.sendMessage(
              job.chatId,
              `✅ 代码任务完成\n\n${msg.text.slice(0, this.hctx.config.app.maxMessageLength)}`
            )
          );
      }
    } catch (error) {
      console.error(`[octg][task] resolveTaskJob failed session=${this.hctx.shortId(sessionID)}:`, error);
      await this.hctx.bot.telegram.sendMessage(job.chatId, `❌ 获取结果失败: ${error}`).catch(() => {});
    }
  }
}
