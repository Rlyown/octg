import { EventSource } from 'eventsource';

export interface OpenCodeEvent {
  type: string;
  data: unknown;
  timestamp?: string;
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
      console.log('SSE already running');
      return;
    }

    this.isManualClose = false;
    let url = `${this.baseUrl}/event`;

    if (this.authHeader) {
      url += `?authorization=${encodeURIComponent(this.authHeader)}`;
    }

    this.eventSource = new EventSource(url);

    this.eventSource.onopen = () => {
      console.log('SSE connection opened');
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleEvent(data);
      } catch (error) {
        console.error('Failed to parse SSE message:', error);
      }
    };

    this.eventSource.onerror = (error) => {
      console.error('SSE error:', error);

      if (this.isManualClose) {
        return;
      }

      this.eventSource?.close();
      this.eventSource = null;

      this.reconnectTimer = setTimeout(() => {
        console.log('Reconnecting SSE...');
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
      console.log('SSE connection closed');
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
        console.error('Event handler error:', error);
      }
    }
  }

  isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
  }
}
