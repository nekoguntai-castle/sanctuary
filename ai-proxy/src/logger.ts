/**
 * AI Proxy Logger
 *
 * Simple structured logger for the isolated AI container.
 * Mirrors the server-side createLogger API for consistency.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: number = LOG_LEVELS[(process.env.LOG_LEVEL?.toLowerCase() as LogLevel) || 'info'] ?? LOG_LEVELS.info;

const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function formatContext(context?: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) return '';
  const parts = Object.entries(context)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ');
  return ` ${colors.dim}${parts}${colors.reset}`;
}

function log(level: number, levelName: string, color: string, prefix: string, message: string, context?: Record<string, unknown>): void {
  if (level < currentLevel) return;
  const ts = new Date().toISOString();
  console.log(
    `${colors.gray}[${ts}]${colors.reset} ${color}${levelName}${colors.reset} ${colors.cyan}[${prefix}]${colors.reset} ${message}${formatContext(context)}`
  );
}

export function createLogger(prefix: string): Logger {
  return {
    debug: (message, context?) => log(LOG_LEVELS.debug, 'DEBUG', colors.gray, prefix, message, context),
    info: (message, context?) => log(LOG_LEVELS.info, 'INFO ', colors.blue, prefix, message, context),
    warn: (message, context?) => log(LOG_LEVELS.warn, 'WARN ', colors.yellow, prefix, message, context),
    error: (message, context?) => log(LOG_LEVELS.error, 'ERROR', colors.red, prefix, message, context),
  };
}
