import { EventSource } from 'eventsource';
import { getLogger } from '../logger.js';

/** Raw event shape from opencode /event SSE stream */
export interface OpenCodeEvent {
  type: string;
  properties: unknown;
}

export type EventHandler = (event: OpenCodeEvent) => void;

export class SSEClient {
  private eventSource: EventSource | null = null;
  private baseUrl: string;
  private authHeader: string | null;
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private reconnectDelay = 5000;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isManualClose = false;
  private logger = getLogger('sse');

  constructor(baseUrl: string, username?: string, password?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');

    if (password) {
      const auth = Buffer.from(`${username || 'opencode'}:${password}`).toString('base64');
      this.authHeader = `Basic ${auth}`;
    } else {
      this.authHeader = null;
    }
  }

  start(): void {
    if (this.eventSource) {
      this.logger.info('already running, skip start');
      return;
    }

    this.isManualClose = false;
    let url = `${this.baseUrl}/event`;

    if (this.authHeader) {
      url += `?authorization=${encodeURIComponent(this.authHeader)}`;
    }

    this.logger.info(`connecting to ${this.baseUrl}/event hasAuth=${Boolean(this.authHeader)}`);
    this.eventSource = new EventSource(url);

    this.eventSource.onopen = () => {
      this.logger.info('connection opened');
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    };

    this.eventSource.onmessage = (event: { data: string }) => {
      try {
        const parsed = JSON.parse(event.data) as OpenCodeEvent;
        this.handleEvent(parsed);
      } catch (error) {
        this.logger.error('failed to parse message, raw:', event.data, error);
      }
    };

    this.eventSource.onerror = (error: unknown) => {
      const state = this.eventSource?.readyState;
      this.logger.error(`error readyState=${state}:`, error);

      if (this.isManualClose) {
        return;
      }

      this.eventSource?.close();
      this.eventSource = null;

      this.logger.info(`will reconnect in ${this.reconnectDelay}ms`);
      this.reconnectTimer = setTimeout(() => {
        this.logger.info('reconnecting...');
        this.start();
      }, this.reconnectDelay);
    };
  }

  stop(): void {
    this.isManualClose = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.logger.info('connection closed');
    }
  }

  on(eventType: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);
  }

  off(eventType: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  private handleEvent(event: OpenCodeEvent): void {
    if (event.type === 'permission.asked' || event.type === 'session.status') {
      this.logger.debug(`event ${event.type}`);
    }
    const handlers = this.eventHandlers.get(event.type) || [];
    const wildcards = this.eventHandlers.get('*') || [];

    for (const handler of [...handlers, ...wildcards]) {
      try {
        handler(event);
      } catch (error) {
        this.logger.error('event handler error:', error);
      }
    }
  }

  isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
  }
}
