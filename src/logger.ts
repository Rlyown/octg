import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { inspect } from 'util';
import winston from 'winston';
import type { AppConfig } from './types.js';

type LogLevel = AppConfig['logLevel'];
type LogMethod = (...args: unknown[]) => void;

interface LogInfo {
  message: unknown;
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(MODULE_DIR, '..');
const DEFAULT_LOG_FILE_PATH = path.join(APP_ROOT, 'logs', 'opencode-telegram.log');

export interface AppLogger {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
}

let rootLogger: winston.Logger | null = null;

function resolveLogFilePath(logPath?: string): string {
  if (!logPath) {
    return DEFAULT_LOG_FILE_PATH;
  }

  if (path.isAbsolute(logPath)) {
    return logPath;
  }

  return path.resolve(APP_ROOT, logPath);
}

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

export function initLogger(level: LogLevel, logPath?: string): AppLogger {
  if (rootLogger) {
    rootLogger.level = level;
    return getLogger();
  }

  const filePath = resolveLogFilePath(logPath);

  mkdirSync(path.dirname(filePath), { recursive: true });

  const transports: winston.transport[] = [
    new winston.transports.File({
      filename: filePath,
      level,
    }),
  ];

  if (process.stdout.isTTY) {
    transports.push(
      new winston.transports.Console({
        stderrLevels: ['error'],
        consoleWarnLevels: ['warn'],
      })
    );
  }

  rootLogger = winston.createLogger({
    level,
    format: winston.format.printf((info: LogInfo) => String(info.message)),
    transports,
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
