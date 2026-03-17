import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { PluginConfig } from '../types.js';

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
      whitelistFile: './data/whitelist.json',
      pairingCodeTtl: 2,
      enableSSE: true,
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

  const envMappings: Array<{ env: string; path: string; parser?: (v: string) => unknown }> = [
    // Telegram
    { env: 'TELEGRAM_BOT_TOKEN', path: 'telegram.botToken' },
    { env: 'TELEGRAM_MODE', path: 'telegram.mode' },
    { env: 'TELEGRAM_WEBHOOK_URL', path: 'telegram.webhookUrl' },
    { env: 'TELEGRAM_WEBHOOK_PORT', path: 'telegram.webhookPort', parser: (v) => parseInt(v, 10) },
    { env: 'TELEGRAM_ALLOWED_USER_IDS', path: 'telegram.allowedUserIds', parser: (v) => v.split(',').map(id => id.trim()).filter(Boolean) },
    // OpenCode
    { env: 'OPENCODE_SERVER_URL', path: 'opencode.serverUrl' },
    { env: 'OPENCODE_USERNAME', path: 'opencode.username' },
    { env: 'OPENCODE_PASSWORD', path: 'opencode.password' },
    { env: 'OPENCODE_REQUEST_TIMEOUT', path: 'opencode.requestTimeout', parser: (v) => parseInt(v, 10) },
    // Session
    { env: 'SESSION_STORAGE', path: 'session.storage' },
    { env: 'SESSION_FILE_PATH', path: 'session.filePath' },
    { env: 'SESSION_TTL', path: 'session.ttl', parser: (v) => parseInt(v, 10) },
    // App
    { env: 'LOG_LEVEL', path: 'app.logLevel' },
    { env: 'MAX_MESSAGE_LENGTH', path: 'app.maxMessageLength', parser: (v) => parseInt(v, 10) },
    { env: 'CODE_BLOCK_TIMEOUT', path: 'app.codeBlockTimeout', parser: (v) => parseInt(v, 10) },
    { env: 'WHITELIST_FILE', path: 'app.whitelistFile' },
    { env: 'PAIRING_CODE_TTL', path: 'app.pairingCodeTtl', parser: (v) => parseInt(v, 10) },
    { env: 'ENABLE_SSE', path: 'app.enableSSE', parser: (v) => v === 'true' },
  ];

  for (const { env, path, parser } of envMappings) {
    const value = process.env[env];
    if (value) {
      const parsedValue = parser ? parser(value) : value;
      setDeepValue(config, path, parsedValue);
    }
  }

  return config;
}

function setDeepValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current: Record<string, unknown> = obj;
  
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key]) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  
  current[keys[keys.length - 1]] = value;
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
