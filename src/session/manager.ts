import type { TelegramSession } from '../types.js';

export class SessionManager {
  private currentSession: TelegramSession | null = null;

  get(): TelegramSession | null {
    return this.currentSession;
  }

  set(session: TelegramSession): void {
    this.currentSession = session;
  }

  clear(): void {
    this.currentSession = null;
  }

  updateActivity(): void {
    if (this.currentSession) {
      this.currentSession.lastActivity = new Date();
    }
  }
}
