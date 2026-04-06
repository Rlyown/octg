import { EventSource } from 'eventsource';

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
      console.log('[oc_event] already running, skip start');
      return;
    }

    this.isManualClose = false;
    let url = `${this.baseUrl}/event`;

    if (this.authHeader) {
      url += `?authorization=${encodeURIComponent(this.authHeader)}`;
    }

    console.log(`[oc_event] connecting to ${this.baseUrl}/event hasAuth=${Boolean(this.authHeader)}`);
    this.eventSource = new EventSource(url);

    this.eventSource.onopen = () => {
      console.log('[oc_event] connection opened');
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    };

    this.eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as OpenCodeEvent;
        this.handleEvent(parsed);
      } catch (error) {
        console.error('[oc_event] failed to parse message, raw:', event.data, error);
      }
    };

    this.eventSource.onerror = (error) => {
      const state = this.eventSource?.readyState;
      console.error(`[oc_event] error readyState=${state}:`, error);

      if (this.isManualClose) {
        return;
      }

      this.eventSource?.close();
      this.eventSource = null;

      console.log(`[oc_event] will reconnect in ${this.reconnectDelay}ms`);
      this.reconnectTimer = setTimeout(() => {
        console.log('[oc_event] reconnecting...');
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
      console.log('[oc_event] connection closed');
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
    const handlers = this.eventHandlers.get(event.type) || [];
    const wildcards = this.eventHandlers.get('*') || [];

    for (const handler of [...handlers, ...wildcards]) {
      try {
        handler(event);
      } catch (error) {
        console.error('[oc_event] event handler error:', error);
      }
    }
  }

  isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
  }
}
