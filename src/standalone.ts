import { loadConfig, validateConfig } from './config/index.js';
import { OpenCodeClient } from './opencode/client.js';
import { SessionManager } from './session/manager.js';
import { WhitelistManager } from './auth/whitelist.js';
import { createBot, setupPolling } from './bot/index.js';
import { BotHandlers } from './bot/handlers.js';
import { Notifier } from './bot/notifier.js';

async function main() {
  console.log('🚀 Starting OpenCode Telegram Plugin...\n');

  // Load and validate configuration
  const config = loadConfig();
  validateConfig(config);

  console.log('Configuration loaded:');
  console.log(`  Telegram Mode: ${config.telegram.mode}`);
  console.log(`  OpenCode Server: ${config.opencode.serverUrl}`);
  console.log();

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
    console.error(`❌ Cannot connect to OpenCode server at ${config.opencode.serverUrl}`);
    console.error('Please ensure opencode serve is running');
    process.exit(1);
  }

  const health = await opencode.health();
  console.log(`✅ Connected to OpenCode server (v${health.version})\n`);

  // Initialize session manager and auto-select session from OC server
  const sessionManager = new SessionManager();

  const ocSessions = await opencode.listSessions();
  if (ocSessions.length > 0) {
    const first = ocSessions[0];
    sessionManager.set({
      telegramChatId: '',
      openCodeSessionId: first.id,
      openCodeSessionTitle: first.title,
      createdAt: new Date(first.time.created),
      lastActivity: new Date(first.time.updated),
    });
    console.log(`✅ Auto-selected session: ${first.title || first.id.slice(0, 12)}\n`);
  } else {
    const created = await opencode.createSession();
    sessionManager.set({
      telegramChatId: '',
      openCodeSessionId: created.id,
      openCodeSessionTitle: created.title,
      createdAt: new Date(created.time.created),
      lastActivity: new Date(created.time.updated),
    });
    console.log(`✅ No sessions found, created new session: ${created.id.slice(0, 12)}\n`);
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
  console.log(`[octg][startup] whitelist users=${whitelistData.users.length} groups=${whitelistData.groups.length}`);

  if (current) {
    const msg =
      `🚀 octg 已启动\n\n` +
      `📎 当前 session\n` +
      `🪪 ${current.openCodeSessionId.slice(0, 12)}...\n` +
      `🏷️ ${current.openCodeSessionTitle || 'Untitled'}`;
    console.log(`[octg][startup] broadcasting startup message...`);
    notifier.broadcast(msg)
      .then(({ sent, failed }) => console.log(`[octg][startup] broadcast done sent=${sent} failed=${failed}`))
      .catch((err) => console.error(`[octg][startup] broadcast error: ${err}`));
  } else {
    console.warn(`[octg][startup] no current session, skip broadcast`);
  }

  // Start bot
  if (config.telegram.mode === 'webhook') {
    console.log('❌ Webhook mode not yet implemented');
    console.log('Please use polling mode for now');
    process.exit(1);
  } else {
    await setupPolling(bot);
  }

  // Graceful shutdown
  process.once('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    bot.stop('SIGINT');
    process.exit(0);
  });

  process.once('SIGTERM', () => {
    console.log('\n🛑 Shutting down...');
    bot.stop('SIGTERM');
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
