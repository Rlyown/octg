import type { Telegraf } from 'telegraf';
import type { WhitelistManager } from '../auth/whitelist.js';
import { getLogger } from '../logger.js';

export class Notifier {
  private logger = getLogger('notifier');

  constructor(
    private bot: Telegraf,
    private whitelist: WhitelistManager
  ) {}

  async send(chatId: string | number, text: string): Promise<boolean> {
    this.logger.info(`send chatId=${chatId}`);
    try {
      await this.bot.telegram.sendMessage(chatId, text);
      this.logger.info(`send ok chatId=${chatId}`);
      return true;
    } catch (error) {
      this.logger.warn(`send failed chatId=${chatId}: ${error}`);
      return false;
    }
  }

  async broadcast(text: string): Promise<{ sent: number; failed: number }> {
    const data = this.whitelist.getWhitelist();
    const recipients = [
      ...data.users.map(u => u.id),
      ...data.groups.map(g => g.id),
    ];

    this.logger.info(`broadcast recipients=${recipients.length} (${recipients.join(',')})`);

    let sent = 0;
    let failed = 0;

    for (const chatId of recipients) {
      const ok = await this.send(chatId, text);
      ok ? sent++ : failed++;
    }

    this.logger.info(`broadcast done sent=${sent} failed=${failed}`);
    return { sent, failed };
  }
}
