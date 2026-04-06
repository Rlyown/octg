import { loadConfig, validateConfig } from './config/index.js';
import { OpenCodeClient } from './opencode/client.js';
import { SessionManager } from './session/manager.js';
import { WhitelistManager } from './auth/whitelist.js';
import { createBot, setupPolling } from './bot/index.js';
import { BotHandlers } from './bot/handlers/index.js';
import { Notifier } from './bot/notifier.js';
import { getLogger, initLogger } from './logger.js';

const bootstrapLogger = getLogger('standalone');
const startupLogger = getLogger('startup');

async function main() {
  // Load and validate configuration
  const config = loadConfig();
  initLogger(config.app.logLevel, config.app.logPath);
  const logger = bootstrapLogger;

  logger.info('🚀 Starting OpenCode Telegram Plugin...\n');
  validateConfig(config);

  logger.info('Configuration loaded:');
  logger.info(`  Telegram Mode: ${config.telegram.mode}`);
  logger.info(`  OpenCode Server: ${config.opencode.serverUrl}`);
  logger.info('');

  // Initialize OpenCode client
  const opencode = new OpenCodeClient({
    baseUrl: config.opencode.serverUrl,
    username: config.opencode.username,
    password: config.opencode.password,
    timeout: config.opencode.requestTimeout,
  });

  // Check OpenCode server availability
  const isAvailable = await opencode.isAvailable();
  if (!isAvailable) {
    logger.error(`❌ Cannot connect to OpenCode server at ${config.opencode.serverUrl}`);
    logger.error('Please ensure opencode serve is running');
    process.exit(1);
  }

  const health = await opencode.health();
  logger.info(`✅ Connected to OpenCode server (v${health.version})\n`);

  // Initialize session manager and auto-select session from OC server
  const sessionManager = new SessionManager();

  const ocSessions = await opencode.listSessions();
  if (ocSessions.length > 0) {
    const first = ocSessions[0];
    const firstDetail = await opencode.getSession(first.id).catch(() => first);
    sessionManager.set({
      telegramChatId: '',
      openCodeSessionId: firstDetail.id,
      openCodeSessionTitle: firstDetail.title,
      directory: firstDetail.directory,
      createdAt: new Date(firstDetail.time.created),
      lastActivity: new Date(firstDetail.time.updated),
    });
    startupLogger.info(
      `✅ Auto-selected session: ${firstDetail.title || firstDetail.id.slice(0, 12)}${firstDetail.directory ? ` (${firstDetail.directory})` : ''}\n`
    );
  } else {
    const created = await opencode.createSession();
    const createdDetail = await opencode.getSession(created.id).catch(() => created);
    sessionManager.set({
      telegramChatId: '',
      openCodeSessionId: createdDetail.id,
      openCodeSessionTitle: createdDetail.title,
      directory: createdDetail.directory,
      createdAt: new Date(createdDetail.time.created),
      lastActivity: new Date(createdDetail.time.updated),
    });
    startupLogger.info(
      `✅ No sessions found, created new session: ${createdDetail.id.slice(0, 12)}${createdDetail.directory ? ` (${createdDetail.directory})` : ''}\n`
    );
  }

  // Create Telegram bot
  const bot = createBot(config.telegram);

  // Initialize whitelist and notifier
  const whitelistFile = config.app.whitelistFile || './data/whitelist.json';
  const whitelist = new WhitelistManager(whitelistFile, config.app.pairingCodeTtl || 2);
  const notifier = new Notifier(bot, whitelist);

  // Setup handlers
  new BotHandlers(bot, opencode, sessionManager, config, whitelist);

  // Broadcast startup session info (before polling so it's not blocked by the loop)
  const current = sessionManager.get();
  const whitelistData = whitelist.getWhitelist();
  startupLogger.info(`whitelist users=${whitelistData.users.length} groups=${whitelistData.groups.length}`);

  if (current) {
    const msg =
      `🚀 octg 已启动\n\n` +
      `📎 当前 session\n` +
      `🪪 ${current.openCodeSessionId.slice(0, 12)}...\n` +
      `🏷️ ${current.openCodeSessionTitle || 'Untitled'}`;
    startupLogger.info('broadcasting startup message...');
    notifier.broadcast(msg)
      .then(({ sent, failed }) => startupLogger.info(`broadcast done sent=${sent} failed=${failed}`))
      .catch((err) => startupLogger.error(`broadcast error: ${err}`));
  } else {
    startupLogger.warn('no current session, skip broadcast');
  }

  // Start bot
  if (config.telegram.mode === 'webhook') {
    logger.info('❌ Webhook mode not yet implemented');
    logger.info('Please use polling mode for now');
    process.exit(1);
  } else {
    await setupPolling(bot);
  }

  // Graceful shutdown
  process.once('SIGINT', () => {
    logger.info('\n🛑 Shutting down...');
    bot.stop('SIGINT');
    process.exit(0);
  });

  process.once('SIGTERM', () => {
    logger.info('\n🛑 Shutting down...');
    bot.stop('SIGTERM');
    process.exit(0);
  });
}

main().catch((error) => {
  bootstrapLogger.error('Fatal error:', error);
  process.exit(1);
});
