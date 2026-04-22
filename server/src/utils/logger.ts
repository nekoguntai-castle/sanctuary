/**
 * Logger Utility
 *
 * A configurable logging system with multiple verbosity levels for the Sanctuary backend.
 *
 * ================================================================================
 * ARCHITECTURE DOCUMENTATION (for future development)
 * ================================================================================
 *
 * LOG LEVELS (in order of verbosity):
 *   - DEBUG (0): Detailed debugging information. Use for tracing code execution,
 *                variable values, and troubleshooting. Only shown when LOG_LEVEL=debug.
 *   - INFO  (1): General operational information. Use for successful operations,
 *                startup messages, and routine events. Default level.
 *   - WARN  (2): Warning conditions. Use for deprecated features, recoverable errors,
 *                or situations that might indicate a problem.
 *   - ERROR (3): Error conditions. Use for failures that prevent an operation from
 *                completing. Always shown regardless of LOG_LEVEL.
 *
 * CONFIGURATION:
 *   Set the LOG_LEVEL environment variable to control verbosity:
 *     - LOG_LEVEL=debug  -> Shows all messages (most verbose)
 *     - LOG_LEVEL=info   -> Shows info, warn, error (default)
 *     - LOG_LEVEL=warn   -> Shows warn, error only
 *     - LOG_LEVEL=error  -> Shows errors only (least verbose)
 *
 * USAGE EXAMPLES:
 *
 *   // Import and create a module-specific logger
 *   import { createLogger } from '../utils/logger';
 *   const log = createLogger('WALLET:ROUTE');
 *
 *   // Basic logging
 *   log.debug('Processing wallet request');
 *   log.info('Wallet created successfully');
 *   log.warn('Deprecated API endpoint called');
 *   log.error('Failed to create wallet');
 *
 *   // Logging with context (structured data)
 *   log.info('Wallet synced', { walletId: '123', txCount: 45, duration: '2.3s' });
 *   log.error('Sync failed', { walletId: '123', error: err.message });
 *
 *   // Using the default logger (prefix: 'APP')
 *   import { logger } from '../utils/logger';
 *   logger.info('Application started');
 *
 * OUTPUT FORMAT:
 *   [ISO_TIMESTAMP] LEVEL [PREFIX] [REQ_ID] Message key=value key=value
 *
 *   Example:
 *   [2024-01-15T10:30:45.123Z] INFO  [WALLET:ROUTE] [a1b2c3d4] Wallet synced walletId=123 txCount=45
 *
 * REQUEST CONTEXT:
 *   When running within a request context (set up by requestLogger middleware),
 *   the request ID is automatically included in all log entries for correlation.
 *
 * BEST PRACTICES:
 *   1. Create a module-specific logger with createLogger('DOMAIN:LAYER')
 *   2. Use UPPERCASE DOMAIN:LAYER format (e.g., 'WALLET:ROUTE', 'SYNC:SVC', 'MW:AUTH')
 *   3. Use debug() for detailed tracing during development
 *   4. Use info() for normal operational events
 *   5. Use warn() for issues that don't stop execution but need attention
 *   6. Use error() for failures - always include error details in context
 *   7. Include relevant IDs and metrics in context objects
 *   8. Keep message strings concise; put details in context
 *
 * RUNTIME CONFIGURATION:
 *   The log level can be changed at runtime using setLogLevel():
 *     import { setLogLevel } from '../utils/logger';
 *     setLogLevel('debug'); // Enable debug logging temporarily
 *
 * ================================================================================
 */

import { requestContext } from './requestContext';
import { safeError, redactObject } from './redact';

// Import shared types from consolidated module
import { LogLevel, LOG_LEVEL_MAP } from '../../../shared/types/logger';
import type { Logger } from '../../../shared/types/logger';

// Re-export shared types for backward compatibility
export { LogLevel };
export type { Logger };

// Get log level from environment, default to INFO
const getLogLevel = (): LogLevel => {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  return envLevel && LOG_LEVEL_MAP[envLevel] !== undefined
    ? LOG_LEVEL_MAP[envLevel]
    : LogLevel.INFO;
};

let currentLogLevel = getLogLevel();

const OTHER_LOG_CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

// Color codes for terminal output (ANSI escape codes)
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const sanitizeLogText = (value: unknown): string =>
  String(value)
    .replace(/\n|\r/g, '')
    .replace(/\t/g, '\\t')
    .replace(OTHER_LOG_CONTROL_CHARS, (char) =>
      `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
    );

/**
 * Get ISO timestamp for log entries
 */
const getTimestamp = (): string => {
  return new Date().toISOString();
};

/**
 * Safely stringify objects, handling circular references
 */
const safeStringify = (obj: any): string => {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    // Handle Error objects specially
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        code: (value as Error & { code?: string }).code,
      };
    }
    return value;
  });
};

/**
 * Prepare context object for logging:
 * - Convert Error objects to safe format (no stack in production)
 * - Redact sensitive fields (passwords, tokens, secrets, etc.)
 */
const prepareContext = (context?: Record<string, any>): Record<string, any> | undefined => {
  if (!context || Object.keys(context).length === 0) return undefined;

  // First pass: convert Error objects to safe format
  const withSafeErrors: Record<string, any> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value instanceof Error) {
      withSafeErrors[key] = safeError(value);
    } else {
      withSafeErrors[key] = value;
    }
  }

  // Second pass: redact sensitive fields
  return redactObject(withSafeErrors) as Record<string, any>;
};

/**
 * Format context object as key=value pairs
 * Objects are JSON stringified, primitives are converted to strings
 */
const formatContext = (context?: Record<string, any>): string => {
  const prepared = prepareContext(context);
  if (!prepared || Object.keys(prepared).length === 0) return '';

  const formatted = Object.entries(prepared)
    .map(([key, value]) => {
      const safeKey = sanitizeLogText(key);
      if (value === undefined || value === null) {
        return `${safeKey}=null`;
      }
      if (typeof value === 'object') {
        try {
          return `${safeKey}=${sanitizeLogText(safeStringify(value))}`;
        } catch {
          return `${safeKey}=[Object]`;
        }
      }
      return `${safeKey}=${sanitizeLogText(value)}`;
    })
    .join(' ');

  return ` ${colors.dim}${formatted}${colors.reset}`;
};

/**
 * Core logging function - writes formatted log entry to stdout
 */
const log = (
  level: LogLevel,
  levelName: string,
  color: string,
  prefix: string,
  message: string,
  context?: Record<string, any>
): void => {
  // Skip if below current log level
  if (level < currentLogLevel) return;

  const timestamp = getTimestamp();

  // Get request ID and trace ID from context if available
  const reqCtx = requestContext.get();
  const requestId = reqCtx?.requestId;
  const traceId = reqCtx?.traceId;
  const requestIdStr = requestId ? ` ${colors.dim}[${sanitizeLogText(requestId)}]${colors.reset}` : '';
  const traceIdStr = traceId ? ` ${colors.dim}[trace:${sanitizeLogText(traceId.substring(0, 8))}]${colors.reset}` : '';

  // Merge request context into log context
  const enrichedContext = {
    ...context,
    ...(reqCtx?.userId && !context?.userId ? { userId: reqCtx.userId } : {}),
    ...(traceId && !context?.traceId ? { traceId } : {}),
  };
  const contextStr = formatContext(enrichedContext);

  // Format: [timestamp] LEVEL [PREFIX] [REQ_ID] [TRACE_ID] message context
  const line = `${colors.gray}[${timestamp}]${colors.reset} ${color}${levelName}${colors.reset} ${colors.cyan}[${sanitizeLogText(prefix)}]${colors.reset}${requestIdStr}${traceIdStr} ${sanitizeLogText(message)}${contextStr}`;
  console.log(line);
};

// Logger interface imported from shared types above
// Note: Server implementation uses Record<string, any> internally for flexibility
// but exports the stricter shared interface for type safety

/**
 * Create a logger instance with a specific prefix/module name
 *
 * @param prefix - Module identifier in DOMAIN:LAYER format (e.g., 'WALLET:ROUTE', 'SYNC:SVC', 'MW:AUTH')
 * @returns Logger instance with debug, info, warn, error methods
 *
 * @example
 * const log = createLogger('WALLET:ROUTE');
 * log.info('Wallet created', { walletId: '123' });
 */
export const createLogger = (prefix: string): Logger => {
  return {
    debug: (message: string, context?: Record<string, any>) => {
      log(LogLevel.DEBUG, 'DEBUG', colors.gray, prefix, message, context);
    },

    info: (message: string, context?: Record<string, any>) => {
      log(LogLevel.INFO, 'INFO ', colors.blue, prefix, message, context);
    },

    warn: (message: string, context?: Record<string, any>) => {
      log(LogLevel.WARN, 'WARN ', colors.yellow, prefix, message, context);
    },

    error: (message: string, context?: Record<string, any>) => {
      log(LogLevel.ERROR, 'ERROR', colors.red, prefix, message, context);
    },
  };
};

/**
 * Default logger instance with 'APP' prefix
 * Use for general application-wide logging
 */
export const logger = createLogger('APP');

/**
 * Update log level at runtime
 *
 * @param level - New log level (LogLevel enum or string: 'debug', 'info', 'warn', 'error')
 *
 * @example
 * setLogLevel('debug'); // Enable debug logging
 * setLogLevel(LogLevel.WARN); // Only show warnings and errors
 */
export const setLogLevel = (level: LogLevel | string): void => {
  if (typeof level === 'string') {
    const parsedLevel = LOG_LEVEL_MAP[level.toLowerCase()];
    if (parsedLevel !== undefined) {
      currentLogLevel = parsedLevel;
      logger.info('Log level changed', { level: level.toLowerCase() });
    }
  } else {
    currentLogLevel = level;
  }
};

/**
 * Get current log level as string
 *
 * @returns Current log level name ('debug', 'info', 'warn', or 'error')
 */
export const getConfiguredLogLevel = (): string => {
  const levelNames = Object.entries(LOG_LEVEL_MAP);
  const current = levelNames.find(([_, v]) => v === currentLogLevel);
  return current ? current[0] : 'info';
};

/**
 * Extract error information in a standardized format for logging
 *
 * This provides a consistent way to extract error details across the codebase.
 * Use this when logging errors to ensure consistent format.
 *
 * @param error - Error object or unknown value
 * @returns Object with standardized error properties
 *
 * @example
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   log.error('Operation failed', extractError(error));
 * }
 */
export function extractError(error: unknown): { error: string; errorName?: string } {
  const safe = safeError(error);
  return {
    error: safe.message,
    ...(safe.name && safe.name !== 'Error' ? { errorName: safe.name } : {}),
  };
}

// Re-export safeError for direct use
export { safeError };

/**
 * Timer utility for measuring operation durations
 *
 * @example
 * const timer = createTimer();
 * await longOperation();
 * log.info('Operation completed', { duration: timer.elapsed() });
 *
 * // Or with auto-logging
 * const timer = createTimer('sync-wallet', log);
 * await syncWallet();
 * timer.end({ walletId: '123' }); // Logs: "sync-wallet completed" with duration
 */
export interface Timer {
  /** Get elapsed time in milliseconds */
  elapsed(): number;
  /** Get elapsed time as formatted string (e.g., "1.23s", "456ms") */
  elapsedFormatted(): string;
  /** End timer and log completion (if logger provided) */
  end(context?: Record<string, any>): number;
}

/**
 * Create a timer for measuring operation duration
 *
 * @param operationName - Optional name for the operation (used in auto-logging)
 * @param logger - Optional logger to use for auto-logging on end()
 * @returns Timer object
 */
export function createTimer(operationName?: string, timerLogger?: Logger): Timer {
  const startTime = Date.now();

  const elapsed = (): number => {
    return Date.now() - startTime;
  };

  const elapsedFormatted = (): string => {
    const ms = elapsed();
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(2)}s`;
    }
    return `${ms}ms`;
  };

  const end = (context?: Record<string, any>): number => {
    const duration = elapsed();
    if (operationName && timerLogger) {
      timerLogger.info(`${operationName} completed`, {
        ...context,
        duration: elapsedFormatted(),
        durationMs: duration,
      });
    }
    return duration;
  };

  return { elapsed, elapsedFormatted, end };
}

export default logger;
