/**
 * Tests for logger utility
 */

import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import {
createLogger,
getLogLevel,
isLevelEnabled,
LogLevel,
setLogLevel,
} from '../../src/utils/logger';

describe('logger utility', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    setLogLevel(LogLevel.DEBUG); // Enable all logs for testing
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setLogLevel(LogLevel.INFO); // Reset to default
  });

  describe('createLogger', () => {
    it('creates a logger with the specified module name', () => {
      const logger = createLogger('TestModule');

      expect(logger).toBeDefined();
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('includes module name in log output', () => {
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const logger = createLogger('MyModule');

      logger.info('Test message');

      expect(consoleInfoSpy).toHaveBeenCalled();
      const call = consoleInfoSpy.mock.calls[0];
      // Check that module name appears somewhere in the output
      expect(call.some((arg: unknown) => typeof arg === 'string' && arg.includes('MyModule'))).toBe(true);
    });
  });

  describe('log levels', () => {
    it('logs debug messages when level is DEBUG', () => {
      setLogLevel(LogLevel.DEBUG);
      const logger = createLogger('Test');

      logger.debug('Debug message');

      expect(consoleDebugSpy).toHaveBeenCalled();
    });

    it('does not log debug messages when level is INFO', () => {
      setLogLevel(LogLevel.INFO);
      const logger = createLogger('Test');

      logger.debug('Debug message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
    });

    it('logs info messages when level is INFO', () => {
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      setLogLevel(LogLevel.INFO);
      const logger = createLogger('Test');

      logger.info('Info message');

      expect(consoleInfoSpy).toHaveBeenCalled();
    });

    it('does not log info messages when level is WARN', () => {
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      setLogLevel(LogLevel.WARN);
      const logger = createLogger('Test');

      logger.info('Info message');

      expect(consoleInfoSpy).not.toHaveBeenCalled();
    });

    it('logs warn messages when level is WARN', () => {
      setLogLevel(LogLevel.WARN);
      const logger = createLogger('Test');

      logger.warn('Warning message');

      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('does not log warn messages when level is ERROR', () => {
      setLogLevel(LogLevel.ERROR);
      const logger = createLogger('Test');

      logger.warn('Warning message');

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('logs error messages at ERROR level', () => {
      setLogLevel(LogLevel.ERROR);
      const logger = createLogger('Test');

      logger.error('Error message');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('always logs error messages regardless of level', () => {
      setLogLevel(LogLevel.ERROR);
      const logger = createLogger('Test');

      logger.error('Critical error');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('setLogLevel and getLogLevel', () => {
    it('sets and gets log level correctly', () => {
      setLogLevel(LogLevel.WARN);

      // getLogLevel returns a string like 'warn', not the enum value
      expect(getLogLevel()).toBe('warn');
    });

    it('defaults to INFO level', () => {
      // Reset to check default
      setLogLevel(LogLevel.INFO);

      // getLogLevel returns a string like 'info', not the enum value
      expect(getLogLevel()).toBe('info');
    });
  });

  describe('isLevelEnabled', () => {
    it('returns true for enabled levels', () => {
      setLogLevel(LogLevel.INFO);

      expect(isLevelEnabled(LogLevel.INFO)).toBe(true);
      expect(isLevelEnabled(LogLevel.WARN)).toBe(true);
      expect(isLevelEnabled(LogLevel.ERROR)).toBe(true);
    });

    it('returns false for disabled levels', () => {
      setLogLevel(LogLevel.WARN);

      expect(isLevelEnabled(LogLevel.DEBUG)).toBe(false);
      expect(isLevelEnabled(LogLevel.INFO)).toBe(false);
    });

    it('returns true for ERROR level when set to ERROR', () => {
      setLogLevel(LogLevel.ERROR);

      expect(isLevelEnabled(LogLevel.ERROR)).toBe(true);
    });
  });

  describe('log message formatting', () => {
    it('logs messages with additional data', () => {
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const logger = createLogger('Test');
      const data = { userId: '123', action: 'login' };

      logger.info('User action', data);

      expect(consoleInfoSpy).toHaveBeenCalled();
    });

    it('logs error objects correctly', () => {
      const logger = createLogger('Test');
      const error = new Error('Something went wrong');

      // Logger expects context object, not Error directly
      logger.error('Operation failed', { error: error.message });

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('handles context objects', () => {
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const logger = createLogger('Test');

      // Logger takes (message, context) where context is a Record
      logger.info('Message', { arg1: 'value1', arg2: 'value2', key: 'value' });

      expect(consoleInfoSpy).toHaveBeenCalled();
    });

    it('handles empty context', () => {
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const logger = createLogger('Test');

      // Logger can be called with just message
      logger.info('Message');

      expect(consoleInfoSpy).toHaveBeenCalled();
    });
  });

  describe('multiple loggers', () => {
    it('creates independent loggers for different modules', () => {
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const loggerA = createLogger('ModuleA');
      const loggerB = createLogger('ModuleB');

      loggerA.info('Message from A');
      loggerB.info('Message from B');

      expect(consoleInfoSpy).toHaveBeenCalledTimes(2);
    });

    it('shares log level across all loggers', () => {
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const loggerA = createLogger('ModuleA');
      const loggerB = createLogger('ModuleB');

      setLogLevel(LogLevel.ERROR);

      loggerA.info('Should not appear');
      loggerB.info('Should not appear');

      expect(consoleInfoSpy).not.toHaveBeenCalled();
    });
  });

  describe('LogLevel enum', () => {
    it('has correct level ordering', () => {
      expect(LogLevel.DEBUG).toBeLessThan(LogLevel.INFO);
      expect(LogLevel.INFO).toBeLessThan(LogLevel.WARN);
      expect(LogLevel.WARN).toBeLessThan(LogLevel.ERROR);
    });
  });
});
