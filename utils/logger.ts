/**
 * Logger Utility (Frontend)
 *
 * A configurable logging system with multiple verbosity levels for the Sanctuary frontend.
 * Mirrors the server-side logger API for consistency across the codebase.
 *
 * ================================================================================
 * CONFIGURATION
 * ================================================================================
 *
 * LOG LEVELS (in order of verbosity):
 *   - DEBUG (0): Detailed debugging information. Tracing, variable values, troubleshooting.
 *   - INFO  (1): General operational information. Successful operations, routine events.
 *   - WARN  (2): Warning conditions. Recoverable errors, potential problems.
 *   - ERROR (3): Error conditions. Failures that prevent operations from completing.
 *
 * ENVIRONMENT CONFIGURATION:
 *   Set VITE_LOG_LEVEL in your .env file:
 *     - VITE_LOG_LEVEL=debug  -> Shows all messages (most verbose)
 *     - VITE_LOG_LEVEL=info   -> Shows info, warn, error (default in development)
 *     - VITE_LOG_LEVEL=warn   -> Shows warn, error only (default in production)
 *     - VITE_LOG_LEVEL=error  -> Shows errors only (least verbose)
 *
 * RUNTIME CONFIGURATION:
 *   You can change the log level at runtime in the browser console:
 *     window.__setLogLevel('debug')  // Enable debug logging
 *     window.__getLogLevel()         // Check current level
 *
 * ================================================================================
 * USAGE
 * ================================================================================
 *
 *   // Import and create a module-specific logger
 *   import { createLogger } from '../utils/logger';
 *   const log = createLogger('WalletDetail');
 *
 *   // Basic logging
 *   log.debug('Processing wallet request');
 *   log.info('Wallet loaded successfully');
 *   log.warn('Deprecated feature used');
 *   log.error('Failed to load wallet');
 *
 *   // Logging with context (structured data)
 *   log.info('Transaction created', { txid: '...', amount: 50000 });
 *   log.error('API call failed', { endpoint: '/wallets', status: 500 });
 *
 * OUTPUT FORMAT (in browser console):
 *   [HH:MM:SS.mmm] LEVEL [PREFIX] Message {context}
 *
 * ================================================================================
 */

// Import shared types from consolidated module
import { LogLevel, LOG_LEVEL_MAP, LOG_LEVEL_NAMES } from '@shared/types/logger';
import type { Logger } from '@shared/types/logger';

// Re-export for backward compatibility
export { LogLevel };
export type { Logger };

/**
 * Detect if we're in development mode
 */
type LoggerEnv = {
  DEV?: boolean;
  VITE_LOG_LEVEL?: string;
};

const getRuntimeEnv = (): LoggerEnv | undefined => {
  const override = (globalThis as any).__SANCTUARY_LOGGER_ENV__;
  if (override && typeof override === 'object') {
    return override as LoggerEnv;
  }
  return (import.meta as any).env as LoggerEnv | undefined;
};

const isDevelopment = (): boolean => {
  return getRuntimeEnv()?.DEV === true;
};

/**
 * Get log level from environment or default based on mode
 */
const getLogLevelFromEnv = (): LogLevel => {
  const envLevel = getRuntimeEnv()?.VITE_LOG_LEVEL?.toLowerCase();
  if (envLevel && LOG_LEVEL_MAP[envLevel] !== undefined) {
    return LOG_LEVEL_MAP[envLevel];
  }
  // Default: debug in development, warn in production
  return isDevelopment() ? LogLevel.DEBUG : LogLevel.WARN;
};

let currentLogLevel = getLogLevelFromEnv();

/**
 * CSS styles for console output (browser-specific)
 */
const styles = {
  timestamp: 'color: #888; font-weight: normal;',
  debug: 'color: #888; font-weight: bold;',
  info: 'color: #3b82f6; font-weight: bold;',
  warn: 'color: #f59e0b; font-weight: bold;',
  error: 'color: #ef4444; font-weight: bold;',
  prefix: 'color: #06b6d4; font-weight: bold;',
  message: 'color: inherit; font-weight: normal;',
};

/**
 * Get formatted timestamp
 */
const getTimestamp = (): string => {
  const now = new Date();
  return now.toTimeString().split(' ')[0] + '.' + now.getMilliseconds().toString().padStart(3, '0');
};

/**
 * Core logging function
 */
const logMessage = (
  level: LogLevel,
  style: string,
  prefix: string,
  message: string,
  context?: Record<string, unknown>
): void => {
  // Skip if below current log level
  if (level < currentLogLevel) return;

  const levelName = LOG_LEVEL_NAMES[level];
  const timestamp = getTimestamp();

  // Build the console arguments
  const formatString = `%c[${timestamp}]%c ${levelName} %c[${prefix}]%c ${message}`;
  const args: unknown[] = [
    formatString,
    styles.timestamp,
    style,
    styles.prefix,
    styles.message,
  ];

  // Add context if provided
  if (context && Object.keys(context).length > 0) {
    args.push(context);
  }

  // Use appropriate console method
  switch (level) {
    case LogLevel.DEBUG:
      console.debug(...args);
      break;
    case LogLevel.INFO:
      console.info(...args);
      break;
    case LogLevel.WARN:
      console.warn(...args);
      break;
    case LogLevel.ERROR:
      console.error(...args);
      break;
  }
};

// Logger interface imported from shared types above

/**
 * Create a logger instance with a specific prefix/module name
 *
 * @param prefix - Module identifier shown in log output (e.g., 'WalletDetail', 'SendTx')
 * @returns Logger instance with debug, info, warn, error methods
 *
 * @example
 * const log = createLogger('WalletDetail');
 * log.info('Wallet loaded', { walletId: '123' });
 */
export const createLogger = (prefix: string): Logger => ({
  debug: (message: string, context?: Record<string, unknown>) => {
    logMessage(LogLevel.DEBUG, styles.debug, prefix, message, context);
  },
  info: (message: string, context?: Record<string, unknown>) => {
    logMessage(LogLevel.INFO, styles.info, prefix, message, context);
  },
  warn: (message: string, context?: Record<string, unknown>) => {
    logMessage(LogLevel.WARN, styles.warn, prefix, message, context);
  },
  error: (message: string, context?: Record<string, unknown>) => {
    logMessage(LogLevel.ERROR, styles.error, prefix, message, context);
  },
});

/**
 * Default logger instance with 'App' prefix
 */
export const logger = createLogger('App');

/**
 * Set log level at runtime
 *
 * @example
 * setLogLevel('debug'); // Enable debug logging
 * setLogLevel(LogLevel.ERROR); // Only show errors
 */
export const setLogLevel = (level: LogLevel | string): void => {
  if (typeof level === 'string') {
    const parsedLevel = LOG_LEVEL_MAP[level.toLowerCase()];
    if (parsedLevel !== undefined) {
      currentLogLevel = parsedLevel;
      logger.info('Log level changed', { level: level.toLowerCase() });
    } else {
      logger.warn('Invalid log level', { provided: level, valid: Object.keys(LOG_LEVEL_MAP) });
    }
  } else {
    currentLogLevel = level;
    logger.info('Log level changed', { level: LOG_LEVEL_NAMES[level] });
  }
};

/**
 * Get current log level as string
 */
export const getLogLevel = (): string => {
  const entry = Object.entries(LOG_LEVEL_MAP).find(([_, v]) => v === currentLogLevel);
  return entry ? entry[0] : 'info';
};

/**
 * Check if a specific log level is enabled
 */
export const isLevelEnabled = (level: LogLevel): boolean => {
  return level >= currentLogLevel;
};

// Expose to window for runtime debugging in browser console
if (typeof window !== 'undefined') {
  (window as any).__setLogLevel = setLogLevel;
  (window as any).__getLogLevel = getLogLevel;
  (window as any).__LogLevel = LogLevel;
}

export default logger;
