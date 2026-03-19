import type { Context } from 'telegraf';
import type { Update } from 'telegraf/types';
import type { Telegraf } from 'telegraf';
import type { OpenCodeClient } from './client.js';
import type { SessionManager } from '../session/manager.js';
import type { TelegramSession } from '../types.js';

export interface PermissionRequest {
  sessionID: string;
  permissionID: string;
  description: string;
  timestamp: string;
}

export interface PendingPermission {
  sessionId: string;
  permissionId: string;
  userId: string;
  chatId: string;
  description: string;
  messageId: number;
  timestamp: number;
}

export class PermissionHandler {
  private bot: Telegraf;
  private opencode: OpenCodeClient;
  private sessions: SessionManager;
  private pendingPermissions: Map<string, PendingPermission> = new Map();
  private permissionTimeout = 60000; // 60秒超时

  constructor(
    bot: Telegraf,
    opencode: OpenCodeClient,
    sessions: SessionManager
  ) {
    this.bot = bot;
    this.opencode = opencode;
    this.sessions = sessions;

    // 启动清理定时器
    setInterval(() => this.cleanupExpiredPermissions(), 30000);
  }

  private shortId(value: string): string {
    return value.slice(0, 8);
  }

  async handlePermissionRequest(event: {
    sessionID: string;
    permissionID: string;
    description?: string;
    tool?: string;
    action?: string;
  }): Promise<void> {
    console.log(
      `[octg][permission] requested session=${this.shortId(event.sessionID)} permission=${this.shortId(event.permissionID)}`
    );

    const session = await this.getSession(event.sessionID);
    if (!session) {
      console.log(`[octg][permission] session ${this.shortId(event.sessionID)} not mapped to telegram user`);
      return;
    }

    // 生成权限描述
    let description = event.description;
    if (!description && event.tool && event.action) {
      description = `执行工具: ${event.tool}.${event.action}`;
    }
    if (!description) {
      description = 'OpenCode 请求执行操作';
    }

    try {
      // 在 Telegram 发送确认消息
      const message = await this.bot.telegram.sendMessage(
        session.telegramChatId,
        `🔐 权限请求\n\n${description}\n\n⏱️ 60秒后自动拒绝\n\n是否允许？`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ 允许', callback_data: `perm:allow:${event.permissionID}` },
                { text: '❌ 拒绝', callback_data: `perm:deny:${event.permissionID}` },
              ],
              [
                { text: '✅ 允许并记住', callback_data: `perm:allow-remember:${event.permissionID}` },
              ],
            ],
          },
        }
      );

      // 保存到待处理权限列表
      this.pendingPermissions.set(event.permissionID, {
        sessionId: event.sessionID,
        permissionId: event.permissionID,
        userId: session.telegramUserId,
        chatId: session.telegramChatId,
        description,
        messageId: message.message_id,
        timestamp: Date.now(),
      });

      console.log(
        `[octg][permission] delivered permission=${this.shortId(event.permissionID)} to user=${session.telegramUserId}`
      );
    } catch (error) {
      console.error('Failed to send permission request:', error);
    }
  }

  async handlePermissionResponse(
    ctx: Context<Update.CallbackQueryUpdate>,
    permissionId: string,
    allowed: boolean,
    remember: boolean = false
  ): Promise<void> {
    const pending = this.pendingPermissions.get(permissionId);
    if (!pending) {
      await ctx.answerCbQuery('权限请求已过期');
      return;
    }

    console.log(
      `[octg][permission] response session=${this.shortId(pending.sessionId)} permission=${this.shortId(permissionId)} action=${allowed ? 'allow' : 'deny'} remember=${remember}`
    );

    try {
      // 调用 OpenCode API 响应权限请求
      await this.respondToPermission(
        pending.sessionId,
        permissionId,
        allowed,
        remember
      );

      // 更新 Telegram 消息状态
      await this.bot.telegram.editMessageText(
        pending.chatId,
        pending.messageId,
        undefined,
        `${allowed ? '✅ 已允许' : '❌ 已拒绝'}\n\n${pending.description}${remember ? '\n\n💾 已记住此选择' : ''}`
      );

      // 从待处理列表移除
      this.pendingPermissions.delete(permissionId);

      await ctx.answerCbQuery(allowed ? '已允许' : '已拒绝');
    } catch (error) {
      console.error('Failed to handle permission response:', error);
      await ctx.answerCbQuery('处理失败');
    }
  }

  private async respondToPermission(
    sessionId: string,
    permissionId: string,
    allowed: boolean,
    remember: boolean
  ): Promise<void> {
    const response: Record<string, unknown> = {
      response: allowed ? 'allow' : 'deny',
    };

    if (remember) {
      response.remember = true;
    }

    await this.opencode.request(`/session/${sessionId}/permissions/${permissionId}`, {
      method: 'POST',
      body: JSON.stringify(response),
    });
  }

  private async getSession(sessionId: string): Promise<TelegramSession | null> {
    const allSessions = await this.sessions.getAll();
    return allSessions.find((s: TelegramSession) => s.openCodeSessionId === sessionId) || null;
  }

  private cleanupExpiredPermissions(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [id, pending] of this.pendingPermissions) {
      if (now - pending.timestamp > this.permissionTimeout) {
        expired.push(id);
      }
    }

    for (const id of expired) {
      const pending = this.pendingPermissions.get(id);
      if (pending) {
        // 自动拒绝过期权限
        this.autoDenyPermission(pending);
        this.pendingPermissions.delete(id);
      }
    }
  }

  private async autoDenyPermission(pending: PendingPermission): Promise<void> {
    try {
      console.log(
        `[octg][permission] auto-deny session=${this.shortId(pending.sessionId)} permission=${this.shortId(pending.permissionId)} after ${this.permissionTimeout}ms`
      );

      await this.respondToPermission(
        pending.sessionId,
        pending.permissionId,
        false,
        false
      );

      await this.bot.telegram.editMessageText(
        pending.chatId,
        pending.messageId,
        undefined,
        `⏱️ 已超时自动拒绝\n\n${pending.description}`
      );
    } catch (error) {
      console.error('Failed to auto-deny permission:', error);
    }
  }

  getPendingCount(): number {
    return this.pendingPermissions.size;
  }
}
