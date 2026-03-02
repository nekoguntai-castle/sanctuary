import { afterEach, describe, expect, it, vi } from 'vitest';

const originalMetaEnv = {
  VITE_LOG_LEVEL: (import.meta as any).env?.VITE_LOG_LEVEL,
  DEV: (import.meta as any).env?.DEV,
};

const setImportMetaEnv = (patch: Record<string, unknown>) => {
  Object.entries(patch).forEach(([key, value]) => {
    (import.meta as any).env[key] = value;
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
    setImportMetaEnv({
      VITE_LOG_LEVEL: originalMetaEnv.VITE_LOG_LEVEL,
      DEV: originalMetaEnv.DEV,
    });
    delete (globalThis as any).__setLogLevel;
    delete (globalThis as any).__getLogLevel;
    delete (globalThis as any).__LogLevel;
    vi.restoreAllMocks();
  });

  it('initializes with a usable default log level', async () => {
    setImportMetaEnv({ VITE_LOG_LEVEL: undefined });

    const loggerModule = await importFreshLogger();

    expect(loggerModule.isLevelEnabled(loggerModule.LogLevel.DEBUG)).toBe(true);
    expect(loggerModule.getLogLevel()).toBeTypeOf('string');
  });

  it('covers string parsing branches and getLogLevel fallback', async () => {
    setImportMetaEnv({ VITE_LOG_LEVEL: 'info' });

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

  it('does not attach window helpers when window is unavailable', async () => {
    setImportMetaEnv({ VITE_LOG_LEVEL: undefined });
    delete (globalThis as any).__setLogLevel;
    delete (globalThis as any).__getLogLevel;

    const loggerModule = await importFreshLoggerWithoutWindow();

    expect((globalThis as any).__setLogLevel).toBeUndefined();
    expect((globalThis as any).__getLogLevel).toBeUndefined();
    expect(loggerModule.getLogLevel()).toBeTypeOf('string');
  });
});
