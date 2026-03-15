import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type {
  PluginConfig,
  TelegramConfig,
  OpencodeConfig,
  SessionConfig,
  AppConfig,
} from '../types.js';

export function loadConfig(): PluginConfig {
  const defaults = getDefaultConfig();
  const fromFile = loadConfigFile();
  const fromEnv = loadEnvConfig();

  return mergeConfig(defaults, fromFile, fromEnv);
}

function getDefaultConfig(): PluginConfig {
  return {
    telegram: {
      botToken: '',
      mode: 'polling',
      webhookPort: 3000,
      allowedUserIds: [],
    },
    opencode: {
      serverUrl: 'http://localhost:4096',
      username: 'opencode',
      requestTimeout: 60000,
    },
    session: {
      storage: 'memory',
      filePath: './data/sessions.json',
      ttl: 86400,
    },
    app: {
      logLevel: 'info',
      maxMessageLength: 4000,
      codeBlockTimeout: 120000,
    },
  };
}

function loadConfigFile(): Partial<PluginConfig> {
  const configPaths = [
    process.env.TELEGRAM_PLUGIN_CONFIG,
    './config.json',
    './config/config.json',
    '/etc/opencode-telegram/config.json',
  ].filter(Boolean) as string[];

  for (const path of configPaths) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8');
        return JSON.parse(content) as Partial<PluginConfig>;
      } catch {
        console.warn(`Failed to load config from ${path}`);
      }
    }
  }

  return {};
}

function loadEnvConfig(): Partial<PluginConfig> {
  const config: Partial<PluginConfig> = {};
  const telegram: Partial<TelegramConfig> = {};
  const opencode: Partial<OpencodeConfig> = {};
  const session: Partial<SessionConfig> = {};
  const app: Partial<AppConfig> = {};

  // Telegram
  if (process.env.TELEGRAM_BOT_TOKEN) telegram.botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (process.env.TELEGRAM_MODE) telegram.mode = process.env.TELEGRAM_MODE as 'webhook' | 'polling';
  if (process.env.TELEGRAM_WEBHOOK_URL) telegram.webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
  if (process.env.TELEGRAM_WEBHOOK_PORT) telegram.webhookPort = parseInt(process.env.TELEGRAM_WEBHOOK_PORT, 10);
  if (process.env.TELEGRAM_ALLOWED_USER_IDS) {
    telegram.allowedUserIds = process.env.TELEGRAM_ALLOWED_USER_IDS
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
  }

  // OpenCode
  if (process.env.OPENCODE_SERVER_URL) opencode.serverUrl = process.env.OPENCODE_SERVER_URL;
  if (process.env.OPENCODE_USERNAME) opencode.username = process.env.OPENCODE_USERNAME;
  if (process.env.OPENCODE_PASSWORD) opencode.password = process.env.OPENCODE_PASSWORD;
  if (process.env.OPENCODE_REQUEST_TIMEOUT) opencode.requestTimeout = parseInt(process.env.OPENCODE_REQUEST_TIMEOUT, 10);

  // Session
  if (process.env.SESSION_STORAGE) session.storage = process.env.SESSION_STORAGE as 'memory' | 'file';
  if (process.env.SESSION_FILE_PATH) session.filePath = process.env.SESSION_FILE_PATH;
  if (process.env.SESSION_TTL) session.ttl = parseInt(process.env.SESSION_TTL, 10);

  // App
  if (process.env.LOG_LEVEL) app.logLevel = process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error';
  if (process.env.MAX_MESSAGE_LENGTH) app.maxMessageLength = parseInt(process.env.MAX_MESSAGE_LENGTH, 10);
  if (process.env.CODE_BLOCK_TIMEOUT) app.codeBlockTimeout = parseInt(process.env.CODE_BLOCK_TIMEOUT, 10);

  // Only add to config if we have any values
  if (Object.keys(telegram).length > 0) config.telegram = telegram as TelegramConfig;
  if (Object.keys(opencode).length > 0) config.opencode = opencode as OpencodeConfig;
  if (Object.keys(session).length > 0) config.session = session as SessionConfig;
  if (Object.keys(app).length > 0) config.app = app as AppConfig;

  return config;
}

function mergeConfig(
  defaults: PluginConfig,
  fromFile: Partial<PluginConfig>,
  fromEnv: Partial<PluginConfig>
): PluginConfig {
  return {
    telegram: {
      ...defaults.telegram,
      ...fromFile.telegram,
      ...fromEnv.telegram,
    },
    opencode: {
      ...defaults.opencode,
      ...fromFile.opencode,
      ...fromEnv.opencode,
    },
    session: {
      ...defaults.session,
      ...fromFile.session,
      ...fromEnv.session,
    },
    app: {
      ...defaults.app,
      ...fromFile.app,
      ...fromEnv.app,
    },
  };
}

export function validateConfig(config: PluginConfig): void {
  const errors: string[] = [];

  if (!config.telegram.botToken) {
    errors.push('TELEGRAM_BOT_TOKEN is required');
  }

  if (config.telegram.mode === 'webhook' && !config.telegram.webhookUrl) {
    errors.push('TELEGRAM_WEBHOOK_URL is required when using webhook mode');
  }

  if (!config.opencode.serverUrl) {
    errors.push('OPENCODE_SERVER_URL is required');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

export function saveSessionData(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function loadSessionData<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}
