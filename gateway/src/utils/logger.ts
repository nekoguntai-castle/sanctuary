/**
 * Simple structured logger for the gateway
 */

import { config } from '../config';

// Import shared types from consolidated module
import { LogLevel, LOG_LEVEL_MAP } from '../../../shared/types/logger';
import type { Logger } from '../../../shared/types/logger';

// Re-export for backward compatibility
export { LogLevel };
export type { Logger };

// Get current log level from config
const currentLevel = LOG_LEVEL_MAP[config.logLevel] ?? LogLevel.INFO;

function formatTimestamp(): string {
  return new Date().toISOString();
}

function shouldLog(level: LogLevel): boolean {
  return level >= currentLevel;
}

export function createLogger(module: string): Logger {
  const prefix = `[${module}]`;

  return {
    debug: (message: string, meta?: Record<string, unknown>) => {
      if (shouldLog(LogLevel.DEBUG)) {
        console.log(`[${formatTimestamp()}] DEBUG ${prefix} ${message}`, meta ? JSON.stringify(meta) : '');
      }
    },
    info: (message: string, meta?: Record<string, unknown>) => {
      if (shouldLog(LogLevel.INFO)) {
        console.log(`[${formatTimestamp()}] INFO  ${prefix} ${message}`, meta ? JSON.stringify(meta) : '');
      }
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      if (shouldLog(LogLevel.WARN)) {
        console.warn(`[${formatTimestamp()}] WARN  ${prefix} ${message}`, meta ? JSON.stringify(meta) : '');
      }
    },
    error: (message: string, meta?: Record<string, unknown>) => {
      // Errors are always emitted regardless of configured log level.
      console.error(`[${formatTimestamp()}] ERROR ${prefix} ${message}`, meta ? JSON.stringify(meta) : '');
    },
  };
}
