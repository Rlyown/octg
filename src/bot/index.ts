import { Telegraf } from 'telegraf';
import type { PluginConfig } from '../types.js';
import { getLogger } from '../logger.js';

const logger = getLogger('bot');

const BOT_COMMANDS = [
  { command: 'pair', description: '使用配对码授权访问' },
  { command: 'start', description: '开始使用机器人' },
  { command: 'help', description: '显示帮助信息' },
  { command: 'status', description: '检查 OpenCode 服务器状态' },
  { command: 'new', description: '创建新会话 /new <abs_path> [title]' },
  { command: 'remove', description: '删除会话 /remove <序号或id>' },
  { command: 'sessions', description: '查看、切换、删除或翻页浏览会话' },
  { command: 'model', description: '查看、列出或设置当前模型' },
  { command: 'agents', description: '查看、列出或设置当前 agent' },
  { command: 'ls', description: '列出目录内容 /ls [path]' },
  { command: 'cat', description: '读取文件内容 /cat <file>' },
  { command: 'task', description: '提交异步任务 /task <描述>' },
  { command: 'shell', description: '执行 shell 命令 /shell <cmd>' },
  { command: 'todos', description: '查看待办事项' },
  { command: 'history', description: '查看会话历史消息 /history [数量]' },
  { command: 'search', description: '在文件中搜索文本 /search <关键词>' },
  { command: 'findfile', description: '查找文件 /findfile <文件名>' },
  { command: 'rename', description: '重命名当前会话 /rename <新名称>' },
  { command: 'fork', description: '分叉当前会话 /fork [message_id]' },
  { command: 'abort', description: '中止正在运行的会话' },
  { command: 'share', description: '分享当前会话' },
  { command: 'unshare', description: '取消分享当前会话' },
  { command: 'diff', description: '查看会话变更 /diff [message_id]' },
  { command: 'summarize', description: '总结当前会话' },
  { command: 'cwd', description: '查看当前工作目录' },
  { command: 'projects', description: '列出所有项目' },
  { command: 'commands', description: '列出 OpenCode 内置命令' },
  { command: 'config', description: '查看当前配置' },
  { command: 'providers', description: '列出所有模型提供商' },
  { command: 'status_all', description: '查看所有会话状态' },
  { command: 'children', description: '查看当前会话的子会话' },
  { command: 'init', description: '分析项目并创建 AGENTS.md' },
  { command: 'symbol', description: '查找符号 /symbol <查询>' },
  { command: 'git_status', description: '查看 Git 文件状态' },
  { command: 'tools', description: '列出可用工具' },
];

export function createBot(config: PluginConfig['telegram']): Telegraf {
  const bot = new Telegraf(config.botToken, {
    handlerTimeout: config.handlerTimeout,
  });

  bot.telegram.getMe().then((botInfo: { username?: string }) => {
    logger.info(`Bot started: @${botInfo.username}`);
  });

  bot.telegram.setMyCommands(BOT_COMMANDS).then(() => {
    logger.info('Bot commands menu configured');
  }).catch((err: { message?: string }) => {
    logger.warn('Failed to set bot commands:', err.message);
  });

  return bot;
}

export async function setupPolling(bot: Telegraf): Promise<void> {
  logger.info('Starting bot in polling mode...');
  await bot.launch();
}
