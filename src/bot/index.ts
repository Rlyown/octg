import { Telegraf } from 'telegraf';
import type { PluginConfig } from '../types.js';

const BOT_COMMANDS = [
  { command: 'pair', description: '使用配对码授权访问' },
  { command: 'start', description: '开始使用机器人' },
  { command: 'help', description: '显示帮助信息' },
  { command: 'status', description: '检查 OpenCode 服务器状态' },
  { command: 'newsession', description: '创建新的 OpenCode 会话' },
  { command: 'attach', description: '附加到现有会话 /attach <id>' },
  { command: 'sessions', description: '列出所有 OpenCode 会话' },
  { command: 'ls', description: '列出目录内容 /ls [path]' },
  { command: 'cat', description: '读取文件内容 /cat <file>' },
  { command: 'tree', description: '显示目录树 /tree [path]' },
  { command: 'code', description: '生成代码 /code <描述>' },
  { command: 'run', description: '执行命令 /run <cmd>' },
  { command: 'shell', description: '执行 shell 命令 /shell <cmd>' },
  { command: 'todos', description: '查看待办事项' },
];

export function createBot(config: PluginConfig['telegram']): Telegraf {
  const bot = new Telegraf(config.botToken);

  bot.telegram.getMe().then((botInfo) => {
    console.log(`Bot started: @${botInfo.username}`);
  });

  bot.telegram.setMyCommands(BOT_COMMANDS).then(() => {
    console.log('Bot commands menu configured');
  }).catch((err) => {
    console.warn('Failed to set bot commands:', err.message);
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
