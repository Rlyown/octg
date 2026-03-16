import type {
  OpenCodeSession,
  MessageResponse,
  RequestOverrides,
  Todo,
  FileNode,
  FileContent,
  ShellResult,
  HealthResponse,
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

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
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

  async sendMessageAsync(sessionId: string, text: string): Promise<void> {
    await this.request(`/session/${sessionId}/prompt_async`, {
      method: 'POST',
      body: JSON.stringify({
        parts: [{ type: 'text', text }],
      }),
    });
  }

  async executeCommand(
    sessionId: string,
    command: string,
    args: string[] = [],
    overrides: RequestOverrides = {}
  ): Promise<MessageResponse> {
    const argumentsText = args.join(' ').trim();

    return this.request(`/session/${sessionId}/command`, {
      method: 'POST',
      body: JSON.stringify({
        ...overrides,
        command,
        arguments: argumentsText,
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

  async getVcs(): Promise<unknown> {
    return this.request('/vcs');
  }
}
