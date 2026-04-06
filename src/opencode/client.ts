import type {
  OpenCodeSession,
  MessageResponse,
  RequestOverrides,
  Todo,
  FileNode,
  FileContent,
  ShellResult,
  HealthResponse,
  Agent,
  ConfigProviders,
  SearchResult,
  SessionDiff,
  MessageDetail,
} from '../types.js';
import { getLogger } from '../logger.js';

interface ClientConfig {
  baseUrl: string;
  username: string;
  password?: string;
  timeout: number;
}

interface SessionRequestOptions {
  directory?: string;
}

export class OpenCodeClient {
  private config: ClientConfig;
  private logger = getLogger('opencode');

  constructor(config: ClientConfig) {
    this.config = config;
  }

  private shouldLogRequest(path: string): boolean {
    return path === '/session'
      || path === '/config/providers'
      || /^\/session\/[^/]+\/message$/.test(path)
      || /^\/session\/[^/]+\/permissions\/[^/]+$/.test(path);
  }

  private summarizePath(path: string): string {
    const sessionMessage = path.match(/^\/session\/([^/]+)\/message$/);
    if (sessionMessage) {
      return `/session/${sessionMessage[1].slice(0, 8)}/message`;
    }

    const permission = path.match(/^\/session\/([^/]+)\/permissions\/([^/]+)$/);
    if (permission) {
      return `/session/${permission[1].slice(0, 8)}/permissions/${permission[2].slice(0, 8)}`;
    }

    return path;
  }

  private withDirectory(path: string, directory?: string): string {
    if (!directory) {
      return path;
    }

    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}directory=${encodeURIComponent(directory)}`;
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${path}`;
    const headers = new Headers(options.headers);
    const method = options.method || 'GET';
    const startedAt = Date.now();
    const logRequest = this.shouldLogRequest(path);
    const logPath = this.summarizePath(path);

    headers.set('Content-Type', 'application/json');

    if (this.config.password) {
      const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
      headers.set('Authorization', `Basic ${auth}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    if (logRequest) {
      this.logger.debug(`${method} ${logPath} started`);
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (logRequest) {
        this.logger.debug(
          `${method} ${logPath} responded ${response.status} in ${Date.now() - startedAt}ms`
        );
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const raw = await response.text();
      if (!raw.trim()) {
        return undefined as T;
      }

      return JSON.parse(raw) as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (logRequest) {
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        this.logger.error(
          `${method} ${logPath} failed after ${Date.now() - startedAt}ms - ${message}`
        );
      }

      throw error;
    }
  }

  async health(): Promise<HealthResponse> {
    return this.request('/global/health');
  }

  async isAvailable(): Promise<boolean> {
    try {
      const health = await this.health();
      return health.healthy;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<OpenCodeSession[]> {
    return this.request('/session');
  }

  async createSession(input: { title?: string; directory?: string } = {}): Promise<OpenCodeSession> {
    return this.request(this.withDirectory('/session', input.directory), {
      method: 'POST',
      body: JSON.stringify({ title: input.title }),
    });
  }

  async getSession(id: string): Promise<OpenCodeSession> {
    return this.request(`/session/${id}`);
  }

  async deleteSession(id: string): Promise<void> {
    await this.request(`/session/${id}`, { method: 'DELETE' });
  }

  async sendMessage(sessionId: string, text: string, options: SessionRequestOptions = {}): Promise<MessageResponse> {
    return this.sendMessageWithOverrides(sessionId, text, {}, options);
  }

  async sendMessageWithOverrides(
    sessionId: string,
    text: string,
    overrides: RequestOverrides = {},
    options: SessionRequestOptions = {}
  ): Promise<MessageResponse> {
    return this.request(this.withDirectory(`/session/${sessionId}/message`, options.directory), {
      method: 'POST',
      body: JSON.stringify({
        ...overrides,
        parts: [{ type: 'text', text }],
      }),
    });
  }

  async sendMessageAsyncWithOverrides(
    sessionId: string,
    text: string,
    overrides: RequestOverrides = {},
    options: SessionRequestOptions = {}
  ): Promise<void> {
    await this.request(this.withDirectory(`/session/${sessionId}/prompt_async`, options.directory), {
      method: 'POST',
      body: JSON.stringify({
        ...overrides,
        parts: [{ type: 'text', text }],
      }),
    });
  }

  async executeShell(
    sessionId: string,
    command: string,
    overrides: RequestOverrides = {},
    options: SessionRequestOptions = {}
  ): Promise<ShellResult> {
    return this.request(this.withDirectory(`/session/${sessionId}/shell`, options.directory), {
      method: 'POST',
      body: JSON.stringify({
        ...overrides,
        command,
      }),
    });
  }

  async getTodos(sessionId: string, options: SessionRequestOptions = {}): Promise<Todo[]> {
    return this.request(this.withDirectory(`/session/${sessionId}/todo`, options.directory));
  }

  async listFiles(path: string = '', options: SessionRequestOptions = {}): Promise<FileNode[]> {
    const query = path ? `?path=${encodeURIComponent(path)}` : '';
    return this.request(this.withDirectory(`/file${query}`, options.directory));
  }

  async readFile(path: string, options: SessionRequestOptions = {}): Promise<FileContent> {
    return this.request(this.withDirectory(`/file/content?path=${encodeURIComponent(path)}`, options.directory));
  }

  async getProject(): Promise<unknown> {
    return this.request('/project/current');
  }

  async getPath(options: SessionRequestOptions = {}): Promise<unknown> {
    return this.request(this.withDirectory('/path', options.directory));
  }

  async listAgents(): Promise<Agent[]> {
    return this.request('/agent');
  }

  async getConfigProviders(): Promise<ConfigProviders> {
    return this.request('/config/providers');
  }

  async findText(pattern: string, options: SessionRequestOptions = {}): Promise<SearchResult[]> {
    return this.request(this.withDirectory(`/find?pattern=${encodeURIComponent(pattern)}`, options.directory));
  }

  async findFile(query: string, options: SessionRequestOptions = {}): Promise<string[]> {
    return this.request(this.withDirectory(`/find/file?query=${encodeURIComponent(query)}`, options.directory));
  }

  async getSessionDiff(sessionId: string, messageId?: string, options: SessionRequestOptions = {}): Promise<SessionDiff[]> {
    const query = messageId ? `?messageID=${encodeURIComponent(messageId)}` : '';
    return this.request(this.withDirectory(`/session/${sessionId}/diff${query}`, options.directory));
  }

  async updateSession(sessionId: string, title: string): Promise<OpenCodeSession> {
    return this.request(`/session/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  }

  async forkSession(sessionId: string, messageId?: string, options: SessionRequestOptions = {}): Promise<OpenCodeSession> {
    return this.request(this.withDirectory(`/session/${sessionId}/fork`, options.directory), {
      method: 'POST',
      body: JSON.stringify(messageId ? { messageID: messageId } : {}),
    });
  }

  async abortSession(sessionId: string, options: SessionRequestOptions = {}): Promise<boolean> {
    return this.request(this.withDirectory(`/session/${sessionId}/abort`, options.directory), { method: 'POST' });
  }

  async shareSession(sessionId: string): Promise<OpenCodeSession> {
    return this.request(`/session/${sessionId}/share`, { method: 'POST' });
  }

  async unshareSession(sessionId: string): Promise<OpenCodeSession> {
    return this.request(`/session/${sessionId}/share`, { method: 'DELETE' });
  }

  async summarizeSession(
    sessionId: string,
    providerId?: string,
    modelId?: string,
    options: SessionRequestOptions = {}
  ): Promise<boolean> {
    return this.request(this.withDirectory(`/session/${sessionId}/summarize`, options.directory), {
      method: 'POST',
      body: JSON.stringify({ providerID: providerId, modelID: modelId }),
    });
  }

  async listMessages(sessionId: string, limit?: number, options: SessionRequestOptions = {}): Promise<MessageDetail[]> {
    const query = limit ? `?limit=${limit}` : '';
    return this.request(this.withDirectory(`/session/${sessionId}/message${query}`, options.directory));
  }

  async getMessage(sessionId: string, messageId: string): Promise<MessageDetail> {
    return this.request(`/session/${sessionId}/message/${messageId}`);
  }

  async listProjects(): Promise<unknown[]> {
    return this.request('/project');
  }

  async getSessionStatus(): Promise<Record<string, unknown>> {
    return this.request('/session/status');
  }

  async listCommands(): Promise<unknown[]> {
    return this.request('/command');
  }

  async writeLog(service: string, level: string, message: string, extra?: Record<string, unknown>): Promise<boolean> {
    return this.request('/log', {
      method: 'POST',
      body: JSON.stringify({ service, level, message, extra }),
    });
  }

  async getConfig(): Promise<unknown> {
    return this.request('/config');
  }

  async listProviders(): Promise<unknown[]> {
    return this.request('/provider');
  }

  async getAllSessionStatus(): Promise<Record<string, unknown>> {
    return this.request('/session/status');
  }

  async getSessionChildren(sessionId: string): Promise<OpenCodeSession[]> {
    return this.request(`/session/${sessionId}/children`);
  }

  async initSession(
    sessionId: string,
    providerId?: string,
    modelId?: string,
    options: SessionRequestOptions = {}
  ): Promise<boolean> {
    return this.request(this.withDirectory(`/session/${sessionId}/init`, options.directory), {
      method: 'POST',
      body: JSON.stringify({ providerID: providerId, modelID: modelId }),
    });
  }

  async findSymbol(query: string, options: SessionRequestOptions = {}): Promise<unknown[]> {
    return this.request(this.withDirectory(`/find/symbol?query=${encodeURIComponent(query)}`, options.directory));
  }

  async getFileStatus(options: SessionRequestOptions = {}): Promise<unknown[]> {
    return this.request(this.withDirectory('/file/status', options.directory));
  }

  async listToolIds(): Promise<unknown> {
    return this.request('/experimental/tool/ids');
  }

  async respondToPermission(
    sessionId: string,
    permissionId: string,
    allowed: boolean,
    remember: boolean = false
  ): Promise<void> {
    return this.request(`/session/${sessionId}/permissions/${permissionId}`, {
      method: 'POST',
      body: JSON.stringify({
        response: allowed ? 'allow' : 'deny',
        remember,
      }),
    });
  }
}
