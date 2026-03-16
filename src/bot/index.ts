import { Telegraf } from 'telegraf';
import type { PluginConfig } from '../types.js';

const BOT_COMMANDS = [
  { command: 'pair', description: '使用配对码授权访问' },
  { command: 'start', description: '开始使用机器人' },
  { command: 'help', description: '显示帮助信息' },
  { command: 'status', description: '检查 OpenCode 服务器状态' },
  { command: 'new', description: '创建新的 OpenCode 会话' },
  { command: 'sessions', description: '查看、检索或按钮翻页切换会话' },
  { command: 'model', description: '查看、列出或设置当前模型' },
  { command: 'agents', description: '查看、列出或设置当前 agent' },
  { command: 'ls', description: '列出目录内容 /ls [path]' },
  { command: 'cat', description: '读取文件内容 /cat <file>' },
  { command: 'tree', description: '显示目录树 /tree [path]' },
  { command: 'code', description: '生成代码 /code <描述>' },
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
