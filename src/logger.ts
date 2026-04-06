import { inspect } from 'util';
import winston from 'winston';
import type { AppConfig } from './types.js';

type LogLevel = AppConfig['logLevel'];
type LogMethod = (...args: unknown[]) => void;

interface LogInfo {
  message: unknown;
}

export interface AppLogger {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
}

let rootLogger: winston.Logger | null = null;

function formatLogArgs(args: unknown[]): string {
  return args.map(formatLogArg).join(' ');
}

function formatLogArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack || `${arg.name}: ${arg.message}`;
  }

  if (typeof arg === 'string') {
    return arg;
  }

  return inspect(arg, {
    depth: null,
    colors: false,
    compact: true,
    breakLength: Infinity,
  });
}

function createLogMethod(level: LogLevel, component?: string): LogMethod {
  return (...args: unknown[]) => {
    const message = formatMessage(component, formatLogArgs(args));

    if (rootLogger) {
      rootLogger.log({
        level,
        message,
      });
      return;
    }

    const consoleMethod = getConsoleMethod(level);
    consoleMethod(message);
  };
}

function getConsoleMethod(level: LogLevel): (message?: unknown, ...optionalParams: unknown[]) => void {
  switch (level) {
    case 'debug':
      return console.log;
    case 'warn':
      return console.warn;
    case 'error':
      return console.error;
    default:
      return console.log;
  }
}

function formatMessage(component: string | undefined, message: string): string {
  if (!component) {
    return message;
  }

  return `[octg][${component}] ${message}`;
}

export function initLogger(level: LogLevel): AppLogger {
  if (rootLogger) {
    rootLogger.level = level;
    return getLogger();
  }

  rootLogger = winston.createLogger({
    level,
    format: winston.format.printf((info: LogInfo) => String(info.message)),
    transports: [
      new winston.transports.Console({
        stderrLevels: ['error'],
        consoleWarnLevels: ['warn'],
      }),
    ],
  });

  return getLogger();
}

export function getLogger(component?: string): AppLogger {
  return {
    debug: createLogMethod('debug', component),
    info: createLogMethod('info', component),
    warn: createLogMethod('warn', component),
    error: createLogMethod('error', component),
  };
}
