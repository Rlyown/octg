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
 * App configuration
 */
export interface AppConfig {
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maxMessageLength: number;
  codeBlockTimeout: number;
  whitelistFile?: string;
  pairingCodeTtl?: number;
  enableSSE?: boolean;
}

/**
 * Plugin configuration
 */
export interface PluginConfig {
  telegram: TelegramConfig;
  opencode: OpencodeConfig;
  app: AppConfig;
}

/**
 * OpenCode Session
 */
export interface OpenCodeSession {
  id: string;
  title?: string;
  time: { created: number; updated: number };
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

export interface RequestOverrides {
  model?: {
    providerID: string;
    modelID: string;
  };
  agent?: string;
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
 * Current session state (single active session per octg instance)
 */
export interface TelegramSession {
  telegramChatId: string;
  openCodeSessionId: string;
  openCodeSessionTitle?: string;
  preferredModel?: string;
  preferredAgent?: string;
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
 * Agent
 */
export interface Agent {
  name: string;
  description?: string;
  slug?: string;
}

/**
 * Config Providers Response
 */
export interface ConfigProviders {
  providers: Array<{
    provider: string;
    models: string[];
  }>;
  default: Record<string, string>;
}

/**
 * Search Result
 */
export interface SearchResult {
  path: string;
  lines: Array<{
    line_number: number;
    content: string;
  }>;
}

/**
 * Session Diff
 */
export interface SessionDiff {
  path: string;
  change: 'added' | 'removed' | 'modified';
  content?: string;
}

/**
 * Message Info
 */
export interface MessageInfo {
  id: string;
  sessionID: string;
  role: string;
  createdAt: string;
}

/**
 * Message Detail
 */
export interface MessageDetail {
  info: MessageInfo;
  parts: MessagePart[];
}
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
  app: {
    logLevel: { type: 'string', enum: ['debug', 'info', 'warn', 'error'], default: 'info' },
    maxMessageLength: { type: 'number', default: 4000 },
    codeBlockTimeout: { type: 'number', default: 120000 },
  },
};
