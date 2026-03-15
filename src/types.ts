// OpenCode Telegram Plugin - Type Definitions

/**
 * Telegram configuration
 */
export interface TelegramConfig {
  botToken: string;
  mode: 'webhook' | 'polling';
  webhookUrl?: string;
  webhookPort: number;
  allowedUserIds: string[];
}

/**
 * OpenCode configuration
 */
export interface OpencodeConfig {
  serverUrl: string;
  username: string;
  password?: string;
  requestTimeout: number;
}

/**
 * Session configuration
 */
export interface SessionConfig {
  storage: 'memory' | 'file';
  filePath?: string;
  ttl: number;
}

/**
 * App configuration
 */
export interface AppConfig {
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maxMessageLength: number;
  codeBlockTimeout: number;
  whitelistFile?: string;
  pairingCodeTtl?: number;
}

/**
 * Plugin configuration
 */
export interface PluginConfig {
  telegram: TelegramConfig;
  opencode: OpencodeConfig;
  session: SessionConfig;
  app: AppConfig;
}

/**
 * OpenCode Session
 */
export interface OpenCodeSession {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * OpenCode Message
 */
export interface OpenCodeMessage {
  id: string;
  sessionID: string;
  role: 'user' | 'assistant' | 'system';
  createdAt: string;
}

/**
 * Message Part
 */
export interface MessagePart {
  type: 'text' | 'tool_use' | 'tool_result' | 'error';
  text?: string;
  name?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

/**
 * OpenCode Message Response
 */
export interface MessageResponse {
  info: OpenCodeMessage;
  parts: MessagePart[];
}

/**
 * Todo Item
 */
export interface Todo {
  id: string;
  content: string;
  completed: boolean;
}

/**
 * File Node
 */
export interface FileNode {
  path: string;
  name: string;
  isDirectory: boolean;
  size?: number;
  modTime?: string;
}

/**
 * File Content
 */
export interface FileContent {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
}

/**
 * Shell Execution Result
 */
export interface ShellResult {
  info: OpenCodeMessage;
  parts: MessagePart[];
}

/**
 * Telegram User Session
 */
export interface TelegramSession {
  telegramUserId: string;
  telegramChatId: string;
  openCodeSessionId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  createdAt: Date;
  lastActivity: Date;
}

/**
 * Command Context
 */
export interface CommandContext {
  userId: string;
  chatId: string;
  username?: string;
  firstName?: string;
  message: string;
  args: string[];
  sessionId: string; // OpenCode session ID
  reply: (text: string, options?: ReplyOptions) => Promise<void>;
}

/**
 * Reply Options
 */
export interface ReplyOptions {
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  disableWebPagePreview?: boolean;
  replyMarkup?: unknown;
}

/**
 * Health Check Response
 */
export interface HealthResponse {
  healthy: boolean;
  version: string;
}

/**
 * Config File Schema (for validation)
 */
export const configSchema = {
  telegram: {
    botToken: { type: 'string', required: true },
    mode: { type: 'string', enum: ['webhook', 'polling'], default: 'polling' },
    webhookUrl: { type: 'string' },
    webhookPort: { type: 'number', default: 3000 },
    allowedUserIds: { type: 'array', items: 'string', default: [] },
  },
  opencode: {
    serverUrl: { type: 'string', default: 'http://localhost:4096' },
    username: { type: 'string', default: 'opencode' },
    password: { type: 'string' },
    requestTimeout: { type: 'number', default: 60000 },
  },
  session: {
    storage: { type: 'string', enum: ['memory', 'file'], default: 'memory' },
    filePath: { type: 'string', default: './data/sessions.json' },
    ttl: { type: 'number', default: 86400 }, // 24 hours
  },
  app: {
    logLevel: { type: 'string', enum: ['debug', 'info', 'warn', 'error'], default: 'info' },
    maxMessageLength: { type: 'number', default: 4000 },
    codeBlockTimeout: { type: 'number', default: 120000 },
  },
};
