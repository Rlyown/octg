import { Telegraf } from 'telegraf';
import type { PluginConfig } from '../types.js';

export function createBot(config: PluginConfig['telegram']): Telegraf {
  const bot = new Telegraf(config.botToken);

  // Bot info
  bot.telegram.getMe().then((botInfo) => {
    console.log(`Bot started: @${botInfo.username}`);
  });

  return bot;
}

export async function setupWebhook(bot: Telegraf, url: string, _port: number): Promise<void> {
  // Set webhook
  await bot.telegram.setWebhook(url);
  console.log(`Webhook set to: ${url}`);

  // Start webhook server
  // Note: In production, you might want to use express or fastify
  // This is a simplified version
}

export async function setupPolling(bot: Telegraf): Promise<void> {
  console.log('Starting bot in polling mode...');
  await bot.launch();
}
