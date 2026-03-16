import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { TelegramSession, PluginConfig } from '../types.js';
import { saveSessionData, loadSessionData } from '../config/index.js';

export class SessionManager {
  private sessions: Map<string, TelegramSession> = new Map();
  private config: PluginConfig['session'];
  private filePath: string;

  constructor(config: PluginConfig['session']) {
    this.config = config;
    this.filePath = config.filePath || './data/sessions.json';

    if (config.storage === 'file') {
      this.loadFromFile();
    }
  }

  private loadFromFile(): void {
    const data = loadSessionData<Record<string, TelegramSession>>(this.filePath);
    if (data) {
      Object.entries(data).forEach(([key, session]) => {
        if (!this.isExpired(session)) {
          this.sessions.set(key, session);
        }
      });
    }
  }

  private saveToFile(): void {
    if (this.config.storage !== 'file') return;

    const data: Record<string, TelegramSession> = {};
    this.sessions.forEach((session, key) => {
      data[key] = session;
    });

    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    saveSessionData(this.filePath, data);
  }

  private isExpired(session: TelegramSession): boolean {
    if (this.config.ttl === 0) return false;

    const now = new Date();
    const lastActivity = new Date(session.lastActivity);
    const diffMs = now.getTime() - lastActivity.getTime();
    const diffSeconds = diffMs / 1000;

    return diffSeconds > this.config.ttl;
  }

  get(telegramUserId: string): TelegramSession | undefined {
    const session = this.sessions.get(telegramUserId);

    if (session && this.isExpired(session)) {
      this.sessions.delete(telegramUserId);
      this.saveToFile();
      return undefined;
    }

    return session;
  }

  set(session: TelegramSession): void {
    this.sessions.set(session.telegramUserId, session);
    this.saveToFile();
  }

  updateActivity(telegramUserId: string): void {
    const session = this.sessions.get(telegramUserId);
    if (session) {
      session.lastActivity = new Date();
      this.saveToFile();
    }
  }

  delete(telegramUserId: string): void {
    this.sessions.delete(telegramUserId);
    this.saveToFile();
  }

  getOpenCodeSessionId(telegramUserId: string): string | undefined {
    return this.get(telegramUserId)?.openCodeSessionId;
  }

  list(): TelegramSession[] {
    return Array.from(this.sessions.values()).filter(s => !this.isExpired(s));
  }

  getAll(): TelegramSession[] {
    return this.list();
  }

  cleanup(): number {
    let count = 0;
    this.sessions.forEach((session, key) => {
      if (this.isExpired(session)) {
        this.sessions.delete(key);
        count++;
      }
    });
    if (count > 0) {
      this.saveToFile();
    }
    return count;
  }
}
