import { loadConfig, validateConfig } from './config/index.js';
import { OpenCodeClient } from './opencode/client.js';
import { SessionManager } from './session/manager.js';
import { createBot, setupPolling } from './bot/index.js';
import { BotHandlers } from './bot/handlers.js';
import { getLogger, initLogger } from './logger.js';

const bootstrapLogger = getLogger('standalone');

async function main() {
  // Load and validate configuration
  const config = loadConfig();
  initLogger(config.app.logLevel);
  const logger = bootstrapLogger;

  logger.info('🚀 Starting OpenCode Telegram Plugin...\n');
  validateConfig(config);

  logger.info('Configuration loaded:');
  logger.info(`  Telegram Mode: ${config.telegram.mode}`);
  logger.info(`  OpenCode Server: ${config.opencode.serverUrl}`);
  logger.info(`  Session Storage: ${config.session.storage}`);
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

  // Initialize session manager
  const sessionManager = new SessionManager(config.session);
  logger.info(`✅ Session manager initialized (${config.session.storage} mode)\n`);

  // Create Telegram bot
  const bot = createBot(config.telegram);

  // Setup handlers
  new BotHandlers(bot, opencode, sessionManager, config);

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
