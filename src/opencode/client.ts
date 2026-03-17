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

interface ClientConfig {
  baseUrl: string;
  username: string;
  password?: string;
  timeout: number;
}

export class OpenCodeClient {
  private config: ClientConfig;

  constructor(config: ClientConfig) {
    this.config = config;
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${path}`;
    const headers = new Headers(options.headers);

    headers.set('Content-Type', 'application/json');

    if (this.config.password) {
      const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
      headers.set('Authorization', `Basic ${auth}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timeoutId);
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

  async createSession(title?: string): Promise<OpenCodeSession> {
    return this.request('/session', {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
  }

  async getSession(id: string): Promise<OpenCodeSession> {
    return this.request(`/session/${id}`);
  }

  async deleteSession(id: string): Promise<void> {
    await this.request(`/session/${id}`, { method: 'DELETE' });
  }

  async sendMessage(sessionId: string, text: string): Promise<MessageResponse> {
    return this.sendMessageWithOverrides(sessionId, text);
  }

  async sendMessageWithOverrides(
    sessionId: string,
    text: string,
    overrides: RequestOverrides = {}
  ): Promise<MessageResponse> {
    return this.request(`/session/${sessionId}/message`, {
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
    overrides: RequestOverrides = {}
  ): Promise<ShellResult> {
    return this.request(`/session/${sessionId}/shell`, {
      method: 'POST',
      body: JSON.stringify({
        ...overrides,
        command,
      }),
    });
  }

  async getTodos(sessionId: string): Promise<Todo[]> {
    return this.request(`/session/${sessionId}/todo`);
  }

  async listFiles(path: string = ''): Promise<FileNode[]> {
    const query = path ? `?path=${encodeURIComponent(path)}` : '';
    return this.request(`/file${query}`);
  }

  async readFile(path: string): Promise<FileContent> {
    return this.request(`/file/content?path=${encodeURIComponent(path)}`);
  }

  async getProject(): Promise<unknown> {
    return this.request('/project/current');
  }

  async getPath(): Promise<unknown> {
    return this.request('/path');
  }

  async listAgents(): Promise<Agent[]> {
    return this.request('/agent');
  }

  async getConfigProviders(): Promise<ConfigProviders> {
    return this.request('/config/providers');
  }

  async findText(pattern: string): Promise<SearchResult[]> {
    return this.request(`/find?pattern=${encodeURIComponent(pattern)}`);
  }

  async findFile(query: string): Promise<string[]> {
    return this.request(`/find/file?query=${encodeURIComponent(query)}`);
  }

  async getSessionDiff(sessionId: string, messageId?: string): Promise<SessionDiff[]> {
    const query = messageId ? `?messageID=${encodeURIComponent(messageId)}` : '';
    return this.request(`/session/${sessionId}/diff${query}`);
  }

  async updateSession(sessionId: string, title: string): Promise<OpenCodeSession> {
    return this.request(`/session/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  }

  async forkSession(sessionId: string, messageId?: string): Promise<OpenCodeSession> {
    return this.request(`/session/${sessionId}/fork`, {
      method: 'POST',
      body: JSON.stringify(messageId ? { messageID: messageId } : {}),
    });
  }

  async abortSession(sessionId: string): Promise<boolean> {
    return this.request(`/session/${sessionId}/abort`, { method: 'POST' });
  }

  async shareSession(sessionId: string): Promise<OpenCodeSession> {
    return this.request(`/session/${sessionId}/share`, { method: 'POST' });
  }

  async unshareSession(sessionId: string): Promise<OpenCodeSession> {
    return this.request(`/session/${sessionId}/share`, { method: 'DELETE' });
  }

  async summarizeSession(sessionId: string, providerId?: string, modelId?: string): Promise<boolean> {
    return this.request(`/session/${sessionId}/summarize`, {
      method: 'POST',
      body: JSON.stringify({ providerID: providerId, modelID: modelId }),
    });
  }

  async listMessages(sessionId: string, limit?: number): Promise<MessageDetail[]> {
    const query = limit ? `?limit=${limit}` : '';
    return this.request(`/session/${sessionId}/message${query}`);
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

  async tuiOpenSessions(): Promise<boolean> {
    return this.request('/tui/open-sessions', { method: 'POST' });
  }

  async tuiOpenModels(): Promise<boolean> {
    return this.request('/tui/open-models', { method: 'POST' });
  }

  async tuiOpenThemes(): Promise<boolean> {
    return this.request('/tui/open-themes', { method: 'POST' });
  }

  async tuiShowToast(message: string, title?: string, variant?: string): Promise<boolean> {
    return this.request('/tui/show-toast', {
      method: 'POST',
      body: JSON.stringify({ message, title, variant }),
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

  async initSession(sessionId: string, providerId?: string, modelId?: string): Promise<boolean> {
    return this.request(`/session/${sessionId}/init`, {
      method: 'POST',
      body: JSON.stringify({ providerID: providerId, modelID: modelId }),
    });
  }

  async findSymbol(query: string): Promise<unknown[]> {
    return this.request(`/find/symbol?query=${encodeURIComponent(query)}`);
  }

  async getFileStatus(): Promise<unknown[]> {
    return this.request('/file/status');
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
