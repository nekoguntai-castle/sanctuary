/**
 * Logger Utility Tests
 *
 * Tests the gateway logger utility including log level filtering
 * and message formatting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store original console methods
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

describe('Logger', () => {
  let consoleLogSpy: ReturnType<typeof vi.fn>;
  let consoleWarnSpy: ReturnType<typeof vi.fn>;
  let consoleErrorSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Spy on console methods
    consoleLogSpy = vi.fn();
    consoleWarnSpy = vi.fn();
    consoleErrorSpy = vi.fn();

    console.log = consoleLogSpy;
    console.warn = consoleWarnSpy;
    console.error = consoleErrorSpy;

    // Clear module cache to reset log level
    vi.resetModules();
  });

  afterEach(() => {
    // Restore console methods
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    vi.restoreAllMocks();
  });

  describe('createLogger', () => {
    it('should create a logger with all methods', async () => {
      vi.doMock('../../../src/config', () => ({
        config: { logLevel: 'debug' },
      }));

      const { createLogger } = await import('../../../src/utils/logger');
      const logger = createLogger('TEST');

      expect(logger).toBeDefined();
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('should include module name in log prefix', async () => {
      vi.doMock('../../../src/config', () => ({
        config: { logLevel: 'debug' },
      }));

      const { createLogger } = await import('../../../src/utils/logger');
      const logger = createLogger('MY-MODULE');

      logger.info('test message');

      expect(consoleLogSpy).toHaveBeenCalled();
      const logCall = consoleLogSpy.mock.calls[0][0];
      expect(logCall).toContain('[MY-MODULE]');
    });
  });

  describe('log level filtering', () => {
    it('should log all levels when level is debug', async () => {
      vi.doMock('../../../src/config', () => ({
        config: { logLevel: 'debug' },
      }));

      const { createLogger } = await import('../../../src/utils/logger');
      const logger = createLogger('TEST');

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(2); // debug + info
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should skip debug when level is info', async () => {
      vi.doMock('../../../src/config', () => ({
        config: { logLevel: 'info' },
      }));

      const { createLogger } = await import('../../../src/utils/logger');
      const logger = createLogger('TEST');

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1); // only info
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should skip debug and info when level is warn', async () => {
      vi.doMock('../../../src/config', () => ({
        config: { logLevel: 'warn' },
      }));

      const { createLogger } = await import('../../../src/utils/logger');
      const logger = createLogger('TEST');

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should only log errors when level is error', async () => {
      vi.doMock('../../../src/config', () => ({
        config: { logLevel: 'error' },
      }));

      const { createLogger } = await import('../../../src/utils/logger');
      const logger = createLogger('TEST');

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should default to info level for invalid log level', async () => {
      vi.doMock('../../../src/config', () => ({
        config: { logLevel: 'invalid' },
      }));

      const { createLogger } = await import('../../../src/utils/logger');
      const logger = createLogger('TEST');

      logger.debug('debug message');
      logger.info('info message');

      // Debug should be skipped (info is default), info should be logged
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('message formatting', () => {
    it('should include timestamp in ISO format', async () => {
      vi.doMock('../../../src/config', () => ({
        config: { logLevel: 'debug' },
      }));

      const { createLogger } = await import('../../../src/utils/logger');
      const logger = createLogger('TEST');

      logger.info('test message');

      const logCall = consoleLogSpy.mock.calls[0][0];
      // ISO timestamp format: YYYY-MM-DDTHH:MM:SS.sssZ
      expect(logCall).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });

    it('should include log level in output', async () => {
      vi.doMock('../../../src/config', () => ({
        config: { logLevel: 'debug' },
      }));

      const { createLogger } = await import('../../../src/utils/logger');
      const logger = createLogger('TEST');

      logger.debug('debug msg');
      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');

      expect(consoleLogSpy.mock.calls[0][0]).toContain('DEBUG');
      expect(consoleLogSpy.mock.calls[1][0]).toContain('INFO');
      expect(consoleWarnSpy.mock.calls[0][0]).toContain('WARN');
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('ERROR');
    });

    it('should include the message in output', async () => {
      vi.doMock('../../../src/config', () => ({
        config: { logLevel: 'debug' },
      }));

      const { createLogger } = await import('../../../src/utils/logger');
      const logger = createLogger('TEST');

      logger.info('This is a test message');

      expect(consoleLogSpy.mock.calls[0][0]).toContain('This is a test message');
    });

    it('should serialize metadata as JSON', async () => {
      vi.doMock('../../../src/config', () => ({
        config: { logLevel: 'debug' },
      }));

      const { createLogger } = await import('../../../src/utils/logger');
      const logger = createLogger('TEST');

      logger.info('test message', { foo: 'bar', count: 42 });

      const metaArg = consoleLogSpy.mock.calls[0][1];
      expect(metaArg).toContain('"foo":"bar"');
      expect(metaArg).toContain('"count":42');
    });

    it('should handle missing metadata gracefully', async () => {
      vi.doMock('../../../src/config', () => ({
        config: { logLevel: 'debug' },
      }));

      const { createLogger } = await import('../../../src/utils/logger');
      const logger = createLogger('TEST');

      logger.info('test message');

      // Should not throw and metadata should be empty string
      const metaArg = consoleLogSpy.mock.calls[0][1];
      expect(metaArg).toBe('');
    });

    it('should handle complex metadata objects', async () => {
      vi.doMock('../../../src/config', () => ({
        config: { logLevel: 'debug' },
      }));

      const { createLogger } = await import('../../../src/utils/logger');
      const logger = createLogger('TEST');

      logger.info('test', {
        nested: { deep: { value: true } },
        array: [1, 2, 3],
        nullValue: null,
      });

      const metaArg = consoleLogSpy.mock.calls[0][1];
      expect(metaArg).toContain('"nested"');
      expect(metaArg).toContain('"array"');
    });

    it('should serialize metadata for debug, warn, and error logs', async () => {
      vi.doMock('../../../src/config', () => ({
        config: { logLevel: 'debug' },
      }));

      const { createLogger } = await import('../../../src/utils/logger');
      const logger = createLogger('TEST');

      logger.debug('debug with meta', { level: 'debug-meta' });
      logger.warn('warn with meta', { level: 'warn-meta' });
      logger.error('error with meta', { level: 'error-meta' });

      expect(consoleLogSpy.mock.calls[0][1]).toContain('"level":"debug-meta"');
      expect(consoleWarnSpy.mock.calls[0][1]).toContain('"level":"warn-meta"');
      expect(consoleErrorSpy.mock.calls[0][1]).toContain('"level":"error-meta"');
    });
  });

  describe('exports', () => {
    it('should export LogLevel enum', async () => {
      vi.doMock('../../../src/config', () => ({
        config: { logLevel: 'info' },
      }));

      const { LogLevel } = await import('../../../src/utils/logger');

      expect(LogLevel).toBeDefined();
      expect(LogLevel.DEBUG).toBeDefined();
      expect(LogLevel.INFO).toBeDefined();
      expect(LogLevel.WARN).toBeDefined();
      expect(LogLevel.ERROR).toBeDefined();
    });

    it('should export Logger type', async () => {
      vi.doMock('../../../src/config', () => ({
        config: { logLevel: 'info' },
      }));

      // This tests that the type is exported (compile-time check)
      const { Logger, createLogger } = await import('../../../src/utils/logger');

      const logger = createLogger('TEST');
      // TypeScript would error if Logger type wasn't properly exported
      const typedLogger: typeof logger = logger;
      expect(typedLogger).toBeDefined();
    });
  });
});
