import { afterEach, describe, expect, it, vi } from 'vitest';

const setLoggerEnvOverride = (env?: Record<string, unknown>) => {
  if (!env) {
    delete (globalThis as any).__SANCTUARY_LOGGER_ENV__;
    return;
  }
  Object.defineProperty(globalThis, '__SANCTUARY_LOGGER_ENV__', {
    value: env,
    configurable: true,
    writable: true,
  });
};

const importFreshLogger = async () => {
  vi.resetModules();
  return import('../../utils/logger');
};

const importFreshLoggerWithoutWindow = async () => {
  vi.resetModules();
  const previousWindow = (globalThis as any).window;
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');

  Object.defineProperty(globalThis, 'window', {
    value: undefined,
    configurable: true,
    writable: true,
  });

  try {
    return await import('../../utils/logger');
  } finally {
    if (hadWindow) {
      Object.defineProperty(globalThis, 'window', {
        value: previousWindow,
        configurable: true,
        writable: true,
      });
    } else {
      delete (globalThis as any).window;
    }
  }
};

describe('logger branch coverage', () => {
  afterEach(() => {
    setLoggerEnvOverride();
    delete (globalThis as any).__setLogLevel;
    delete (globalThis as any).__getLogLevel;
    delete (globalThis as any).__LogLevel;
    vi.restoreAllMocks();
  });

  it('uses env log level when configured to a valid value', async () => {
    setLoggerEnvOverride({ VITE_LOG_LEVEL: 'warn', DEV: true });
    const loggerModule = await importFreshLogger();

    expect(loggerModule.getLogLevel()).toBe('warn');
    expect(loggerModule.isLevelEnabled(loggerModule.LogLevel.INFO)).toBe(false);
    expect(loggerModule.isLevelEnabled(loggerModule.LogLevel.WARN)).toBe(true);
  });

  it('covers string parsing branches and getLogLevel fallback', async () => {
    setLoggerEnvOverride({ VITE_LOG_LEVEL: 'info', DEV: true });

    const loggerModule = await importFreshLogger();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    loggerModule.setLogLevel('debug');
    expect(loggerModule.getLogLevel()).toBe('debug');

    loggerModule.setLogLevel('invalid-level');
    expect(warnSpy).toHaveBeenCalled();

    const entriesSpy = vi.spyOn(Object, 'entries').mockReturnValue([] as Array<[string, unknown]>);
    expect(loggerModule.getLogLevel()).toBe('info');
    entriesSpy.mockRestore();
  });

  it('falls back to debug in development when env level is invalid', async () => {
    setLoggerEnvOverride({ VITE_LOG_LEVEL: 'not-a-level', DEV: true });

    const loggerModule = await importFreshLogger();

    expect(loggerModule.getLogLevel()).toBe('debug');
    expect(loggerModule.isLevelEnabled(loggerModule.LogLevel.DEBUG)).toBe(true);
  });

  it('falls back to warn in production when env level is missing', async () => {
    setLoggerEnvOverride({ DEV: false });

    const loggerModule = await importFreshLogger();

    expect(loggerModule.getLogLevel()).toBe('warn');
    expect(loggerModule.isLevelEnabled(loggerModule.LogLevel.INFO)).toBe(false);
  });

  it('does not attach window helpers when window is unavailable', async () => {
    setLoggerEnvOverride();
    delete (globalThis as any).__setLogLevel;
    delete (globalThis as any).__getLogLevel;

    const loggerModule = await importFreshLoggerWithoutWindow();

    expect((globalThis as any).__setLogLevel).toBeUndefined();
    expect((globalThis as any).__getLogLevel).toBeUndefined();
    expect(loggerModule.getLogLevel()).toBeTypeOf('string');
  });

  it('initializes with a usable default log level when no override is provided', async () => {
    setLoggerEnvOverride();
    const loggerModule = await importFreshLogger();

    expect(loggerModule.getLogLevel()).toBeTypeOf('string');
  });
});
