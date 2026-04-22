/**
 * Logger Tests
 *
 * Tests for the logging utility including automatic redaction
 * and error handling.
 */

// Unmock logger since we're testing the actual implementation
vi.unmock('../../../src/utils/logger');
vi.unmock('../../../src/utils/requestContext');
vi.unmock('../../../src/utils/redact');

import { createLogger, setLogLevel, getConfiguredLogLevel, LogLevel, extractError, createTimer } from '../../../src/utils/logger';
import { requestContext } from '../../../src/utils/requestContext';

// Capture console.log output for testing
const originalConsoleLog = console.log;
let capturedLogs: string[] = [];

beforeAll(() => {
  console.log = (...args: any[]) => {
    capturedLogs.push(args.join(' '));
  };
});

afterAll(() => {
  console.log = originalConsoleLog;
});

beforeEach(() => {
  // Ensure debug level for tests
  setLogLevel('debug');
  // Clear logs AFTER setLogLevel so tests start fresh
  capturedLogs = [];
});

describe('Logger', () => {
  describe('createLogger', () => {
    it('should create a logger with the given prefix', () => {
      const log = createLogger('TEST');

      log.info('Test message');

      expect(capturedLogs[0]).toContain('[TEST]');
      expect(capturedLogs[0]).toContain('Test message');
    });

    it('should have all log level methods', () => {
      const log = createLogger('TEST');

      expect(log.debug).toBeDefined();
      expect(log.info).toBeDefined();
      expect(log.warn).toBeDefined();
      expect(log.error).toBeDefined();
    });
  });

  describe('log levels', () => {
    it('should log at debug level when set to debug', () => {
      const log = createLogger('TEST');

      log.debug('Debug message');

      expect(capturedLogs[0]).toContain('DEBUG');
      expect(capturedLogs[0]).toContain('Debug message');
    });

    it('should not log debug when set to info', () => {
      setLogLevel('info');
      capturedLogs = []; // Clear the log from setLogLevel
      const log = createLogger('TEST');

      log.debug('Debug message');

      expect(capturedLogs.length).toBe(0);
    });

    it('should always log errors regardless of level', () => {
      setLogLevel('error');
      capturedLogs = []; // Clear the log from setLogLevel
      const log = createLogger('TEST');

      log.debug('Debug message');
      log.info('Info message');
      log.warn('Warn message');
      log.error('Error message');

      expect(capturedLogs.length).toBe(1);
      expect(capturedLogs[0]).toContain('ERROR');
    });
  });

  describe('context formatting', () => {
    it('should format simple context as key=value', () => {
      const log = createLogger('TEST');

      log.info('Test', { key: 'value', num: 42 });

      expect(capturedLogs[0]).toContain('key=value');
      expect(capturedLogs[0]).toContain('num=42');
    });

    it('should handle null and undefined context values', () => {
      const log = createLogger('TEST');

      log.info('Test', { nullVal: null, undefVal: undefined });

      expect(capturedLogs[0]).toContain('nullVal=null');
      expect(capturedLogs[0]).toContain('undefVal=null');
    });

    it('should JSON stringify nested objects', () => {
      const log = createLogger('TEST');

      log.info('Test', { nested: { inner: 'value' } });

      expect(capturedLogs[0]).toContain('nested=');
      expect(capturedLogs[0]).toContain('"inner":"value"');
    });

    it('should stringify nested Error objects inside arrays', () => {
      const log = createLogger('TEST');

      log.info('Nested error', { payload: [new Error('nested boom')] });

      expect(capturedLogs[0]).toContain('nested boom');
      expect(capturedLogs[0]).toContain('name');
    });

    it('should handle circular objects nested inside arrays', () => {
      const log = createLogger('TEST');
      const circular: any = { id: 'loop' };
      circular.self = circular;

      log.info('Circular array payload', { payload: [circular] });

      expect(capturedLogs[0]).toContain('[Circular]');
    });

    it('falls back to [Object] when context serialization throws', () => {
      const log = createLogger('TEST');

      log.info('BigInt payload', { payload: { amount: 1n } as any });

      expect(capturedLogs[0]).toContain('payload=[Object]');
    });

    it('removes line breaks and escapes other control characters before writing a log line', () => {
      const log = createLogger('TEST');

      log.info('first line\nsecond line\rthird line', {
        'bad\nkey': 'alpha\nbeta\r\ngamma',
        tabbed: 'before\tafter',
      });

      const line = capturedLogs[0];
      expect(line).not.toContain('\n');
      expect(line).not.toContain('\r');
      expect(line).not.toContain('\t');
      expect(line).toContain('first linesecond linethird line');
      expect(line).toContain('badkey=alphabetagamma');
      expect(line).toContain('tabbed=before\\tafter');
    });
  });

  describe('automatic redaction', () => {
    it('should redact password fields', () => {
      const log = createLogger('TEST');

      log.info('Login attempt', { username: 'john', password: 'secret123' });

      expect(capturedLogs[0]).toContain('username=john');
      expect(capturedLogs[0]).toContain('password=[REDACTED]');
      expect(capturedLogs[0]).not.toContain('secret123');
    });

    it('should redact token fields', () => {
      const log = createLogger('TEST');

      log.info('Auth request', { token: 'abc123', refreshToken: 'def456' });

      expect(capturedLogs[0]).toContain('token=[REDACTED]');
      expect(capturedLogs[0]).toContain('refreshToken=[REDACTED]');
      expect(capturedLogs[0]).not.toContain('abc123');
      expect(capturedLogs[0]).not.toContain('def456');
    });

    it('should redact API key fields', () => {
      const log = createLogger('TEST');

      log.info('API call', { apiKey: 'key123', api_secret: 'secret456' });

      expect(capturedLogs[0]).toContain('apiKey=[REDACTED]');
      expect(capturedLogs[0]).toContain('api_secret=[REDACTED]');
    });

    it('should redact Bitcoin-specific fields', () => {
      const log = createLogger('TEST');

      log.info('Wallet', {
        walletId: '123',
        xpub: 'xpub123...',
        xprv: 'xprv456...',
        mnemonic: 'word1 word2 word3',
        seed: 'seed phrase here',
      });

      expect(capturedLogs[0]).toContain('walletId=123');
      expect(capturedLogs[0]).toContain('xpub=[REDACTED]');
      expect(capturedLogs[0]).toContain('xprv=[REDACTED]');
      expect(capturedLogs[0]).toContain('mnemonic=[REDACTED]');
      expect(capturedLogs[0]).toContain('seed=[REDACTED]');
    });

    it('should redact nested sensitive fields', () => {
      const log = createLogger('TEST');

      log.info('Config', {
        database: {
          host: 'localhost',
          password: 'dbpass123',
        },
      });

      expect(capturedLogs[0]).toContain('host');
      expect(capturedLogs[0]).toContain('password');
      expect(capturedLogs[0]).toContain('[REDACTED]');
      expect(capturedLogs[0]).not.toContain('dbpass123');
    });
  });

  describe('error handling', () => {
    it('should safely format Error objects', () => {
      const log = createLogger('TEST');
      const error = new Error('Something went wrong');

      log.error('Operation failed', { error });

      expect(capturedLogs[0]).toContain('Something went wrong');
      expect(capturedLogs[0]).toContain('Error');
    });

    it('should handle TypeError', () => {
      const log = createLogger('TEST');
      const error = new TypeError('Invalid type');

      log.error('Type error', { error });

      expect(capturedLogs[0]).toContain('Invalid type');
      expect(capturedLogs[0]).toContain('TypeError');
    });

    it('should handle errors with sensitive data in message', () => {
      const log = createLogger('TEST');
      const error = new Error('Failed to connect with password');

      log.error('Connection failed', { error });

      // The error message itself is logged (can't auto-redact message content)
      // but the error object is safely formatted
      expect(capturedLogs[0]).toContain('Failed to connect');
    });

    it('should not include stack traces in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const log = createLogger('TEST');
      const error = new Error('Test error');

      log.error('Error occurred', { error });

      // Stack should not appear in production
      expect(capturedLogs[0]).not.toContain('at ');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('setLogLevel and getConfiguredLogLevel', () => {
    it('should change log level with string', () => {
      setLogLevel('warn');
      expect(getConfiguredLogLevel()).toBe('warn');
    });

    it('should change log level with enum', () => {
      setLogLevel(LogLevel.ERROR);
      expect(getConfiguredLogLevel()).toBe('error');
    });

    it('should accept all valid levels', () => {
      setLogLevel('debug');
      expect(getConfiguredLogLevel()).toBe('debug');

      setLogLevel('info');
      expect(getConfiguredLogLevel()).toBe('info');

      setLogLevel('warn');
      expect(getConfiguredLogLevel()).toBe('warn');

      setLogLevel('error');
      expect(getConfiguredLogLevel()).toBe('error');
    });

    it('ignores unknown string log levels', () => {
      setLogLevel('warn');
      expect(getConfiguredLogLevel()).toBe('warn');

      setLogLevel('not-a-level');
      expect(getConfiguredLogLevel()).toBe('warn');
    });

    it('falls back to info when current level is outside known map', () => {
      setLogLevel(999 as any);
      expect(getConfiguredLogLevel()).toBe('info');
    });
  });

  describe('request context enrichment', () => {
    it('adds request and trace correlation fields from request context', () => {
      const log = createLogger('CTX');

      requestContext.run(
        {
          requestId: 'req-1234',
          traceId: '12345678abcdef00',
          userId: 'ctx-user',
          startTime: Date.now(),
        },
        () => {
          log.info('contextual log', { event: 'demo' });
        }
      );

      const line = capturedLogs[capturedLogs.length - 1];
      expect(line).toContain('[req-1234]');
      expect(line).toContain('[trace:12345678]');
      expect(line).toContain('userId=ctx-user');
      expect(line).toContain('traceId=12345678abcdef00');
    });

    it('does not override explicitly provided userId or traceId', () => {
      const log = createLogger('CTX');

      requestContext.run(
        {
          requestId: 'req-5678',
          traceId: 'aaaaaaaaaaaaaaaa',
          userId: 'ctx-user',
          startTime: Date.now(),
        },
        () => {
          log.info('explicit context', {
            userId: 'explicit-user',
            traceId: 'explicit-trace',
          });
        }
      );

      const line = capturedLogs[capturedLogs.length - 1];
      expect(line).toContain('userId=explicit-user');
      expect(line).toContain('traceId=explicit-trace');
      expect(line).not.toContain('userId=ctx-user');
    });
  });

  describe('timestamp format', () => {
    it('should include ISO timestamp', () => {
      const log = createLogger('TEST');

      log.info('Test message');

      // Should match ISO 8601 format
      expect(capturedLogs[0]).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\]/);
    });
  });

  describe('empty context', () => {
    it('should handle undefined context', () => {
      const log = createLogger('TEST');

      log.info('Test message');

      expect(capturedLogs[0]).toContain('Test message');
      expect(capturedLogs[0]).not.toContain('undefined');
    });

    it('should handle empty object context', () => {
      const log = createLogger('TEST');

      log.info('Test message', {});

      expect(capturedLogs[0]).toContain('Test message');
    });
  });

  describe('circular reference handling', () => {
    it('should handle circular references in context', () => {
      const log = createLogger('TEST');
      const obj: any = { name: 'test' };
      obj.self = obj;

      // This should not throw and should handle the circular reference
      expect(() => {
        log.info('Circular test', { data: obj });
      }).not.toThrow();

      expect(capturedLogs[0]).toContain('[Circular]');
    });
  });
});

describe('extractError', () => {
  it('should extract error message from Error object', () => {
    const error = new Error('Something went wrong');
    const result = extractError(error);

    expect(result.error).toBe('Something went wrong');
  });

  it('should extract error name for non-standard errors', () => {
    const error = new TypeError('Invalid type');
    const result = extractError(error);

    expect(result.error).toBe('Invalid type');
    expect(result.errorName).toBe('TypeError');
  });

  it('should not include errorName for generic Error', () => {
    const error = new Error('Generic error');
    const result = extractError(error);

    expect(result.error).toBe('Generic error');
    expect(result.errorName).toBeUndefined();
  });

  it('should handle string errors', () => {
    const result = extractError('string error');

    expect(result.error).toBe('string error');
  });

  it('should handle null errors', () => {
    const result = extractError(null);

    expect(result.error).toBeDefined();
  });

  it('should handle undefined errors', () => {
    const result = extractError(undefined);

    expect(result.error).toBeDefined();
  });

  it('should handle object errors', () => {
    const result = extractError({ message: 'object error' });

    expect(result.error).toBeDefined();
  });

  it('should handle RangeError', () => {
    const error = new RangeError('Out of range');
    const result = extractError(error);

    expect(result.error).toBe('Out of range');
    expect(result.errorName).toBe('RangeError');
  });
});

describe('createTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should measure elapsed time in milliseconds', () => {
    const timer = createTimer();

    vi.advanceTimersByTime(100);

    expect(timer.elapsed()).toBe(100);
  });

  it('should format elapsed time in milliseconds', () => {
    const timer = createTimer();

    vi.advanceTimersByTime(500);

    expect(timer.elapsedFormatted()).toBe('500ms');
  });

  it('should format elapsed time in seconds when >= 1000ms', () => {
    const timer = createTimer();

    vi.advanceTimersByTime(1500);

    expect(timer.elapsedFormatted()).toBe('1.50s');
  });

  it('should return elapsed time on end()', () => {
    const timer = createTimer();

    vi.advanceTimersByTime(200);

    const duration = timer.end();
    expect(duration).toBe(200);
  });

  it('should log completion when operation name and logger provided', () => {
    const log = createLogger('TEST');
    const timer = createTimer('test-operation', log);

    vi.advanceTimersByTime(300);
    timer.end({ extra: 'context' });

    expect(capturedLogs[capturedLogs.length - 1]).toContain('test-operation completed');
    expect(capturedLogs[capturedLogs.length - 1]).toContain('duration');
    expect(capturedLogs[capturedLogs.length - 1]).toContain('extra=context');
  });

  it('should not log when no operation name provided', () => {
    const initialLogCount = capturedLogs.length;
    const timer = createTimer();

    vi.advanceTimersByTime(100);
    timer.end();

    // No additional logs should be added
    expect(capturedLogs.length).toBe(initialLogCount);
  });

  it('should not log when no logger provided', () => {
    const initialLogCount = capturedLogs.length;
    const timer = createTimer('operation-name');

    vi.advanceTimersByTime(100);
    timer.end();

    // No additional logs should be added
    expect(capturedLogs.length).toBe(initialLogCount);
  });

  it('should include durationMs in logged context', () => {
    const log = createLogger('TEST');
    const timer = createTimer('timed-op', log);

    vi.advanceTimersByTime(250);
    timer.end();

    expect(capturedLogs[capturedLogs.length - 1]).toContain('durationMs=250');
  });

  it('should handle end() being called multiple times', () => {
    const timer = createTimer();

    vi.advanceTimersByTime(100);
    const first = timer.end();

    vi.advanceTimersByTime(100);
    const second = timer.end();

    expect(first).toBe(100);
    expect(second).toBe(200);
  });
});

describe('logger module initialization', () => {
  it('uses LOG_LEVEL from environment when valid', async () => {
    const old = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'warn';
    vi.resetModules();

    const mod = await import('../../../src/utils/logger');

    expect(mod.getConfiguredLogLevel()).toBe('warn');
    process.env.LOG_LEVEL = old;
  });

  it('falls back to info when LOG_LEVEL is invalid', async () => {
    const old = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'invalid-level';
    vi.resetModules();

    const mod = await import('../../../src/utils/logger');

    expect(mod.getConfiguredLogLevel()).toBe('info');
    process.env.LOG_LEVEL = old;
  });
});
