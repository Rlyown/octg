import type { Telegraf } from 'telegraf';
import type { WhitelistManager } from '../auth/whitelist.js';

export class Notifier {
  constructor(
    private bot: Telegraf,
    private whitelist: WhitelistManager
  ) {}

  async send(chatId: string | number, text: string): Promise<boolean> {
    console.log(`[octg][notifier] send chatId=${chatId}`);
    try {
      await this.bot.telegram.sendMessage(chatId, text);
      console.log(`[octg][notifier] send ok chatId=${chatId}`);
      return true;
    } catch (error) {
      console.warn(`[octg][notifier] send failed chatId=${chatId}: ${error}`);
      return false;
    }
  }

  async broadcast(text: string): Promise<{ sent: number; failed: number }> {
    const data = this.whitelist.getWhitelist();
    const recipients = [
      ...data.users.map(u => u.id),
      ...data.groups.map(g => g.id),
    ];

    console.log(`[octg][notifier] broadcast recipients=${recipients.length} (${recipients.join(',')})`);

    let sent = 0;
    let failed = 0;

    for (const chatId of recipients) {
      const ok = await this.send(chatId, text);
      ok ? sent++ : failed++;
    }

    console.log(`[octg][notifier] broadcast done sent=${sent} failed=${failed}`);
    return { sent, failed };
  }
}
