/**
 * Focused behavior tests for DeviceParserRegistry class internals.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceParser } from '../../../services/deviceParsers/types';

const { mockDebug, mockWarn } = vi.hoisted(() => ({
  mockDebug: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: (...args: unknown[]) => mockDebug(...args),
    info: vi.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: vi.fn(),
  }),
}));

import { DeviceParserRegistry } from '../../../services/deviceParsers/registry';

function makeParser(
  id: string,
  priority: number,
  canParseImpl: (data: unknown) => { detected: boolean; confidence: number },
  parseImpl: (data: unknown) => { xpub?: string } = () => ({ xpub: `${id}-xpub` })
): DeviceParser {
  return {
    id,
    name: `${id}-name`,
    description: `${id}-desc`,
    priority,
    canParse: vi.fn(canParseImpl),
    parse: vi.fn(parseImpl),
  };
}

describe('DeviceParserRegistry class behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers parsers by descending priority and returns immutable snapshots', () => {
    const registry = new DeviceParserRegistry();
    const low = makeParser('low', 10, () => ({ detected: false, confidence: 10 }));
    const high = makeParser('high', 90, () => ({ detected: false, confidence: 20 }));

    registry.register(low);
    registry.register(high);

    expect(registry.count).toBe(2);
    expect(registry.getAll().map(p => p.id)).toEqual(['high', 'low']);

    const snapshot = registry.getAll();
    snapshot.pop();
    expect(registry.count).toBe(2);
  });

  it('throws for duplicate parser IDs', () => {
    const registry = new DeviceParserRegistry();
    const parser = makeParser('dup', 10, () => ({ detected: false, confidence: 0 }));
    registry.register(parser);

    expect(() => registry.register(parser)).toThrow("Device parser 'dup' is already registered");
  });

  it('supports get and unregister operations', () => {
    const registry = new DeviceParserRegistry();
    const parser = makeParser('p1', 10, () => ({ detected: false, confidence: 0 }));
    registry.register(parser);

    expect(registry.get('p1')).toBe(parser);
    expect(registry.unregister('p1')).toBe(true);
    expect(registry.unregister('missing')).toBe(false);
    expect(registry.get('p1')).toBeUndefined();
  });

  it('detects first matching parser and handles canParse exceptions', () => {
    const registry = new DeviceParserRegistry({ debug: true });
    const throwing = makeParser(
      'throwing',
      100,
      () => {
        throw new Error('bad detector');
      }
    );
    const matched = makeParser('matched', 90, () => ({ detected: true, confidence: 75 }));
    registry.register(throwing);
    registry.register(matched);

    const parser = registry.detect({ some: 'input' });
    expect(parser?.id).toBe('matched');
    expect(mockWarn).toHaveBeenCalled();
    expect(mockDebug).toHaveBeenCalled();
  });

  it('returns null when no parser can detect input', () => {
    const registry = new DeviceParserRegistry();
    registry.register(makeParser('a', 10, () => ({ detected: false, confidence: 1 })));
    registry.register(makeParser('b', 20, () => ({ detected: false, confidence: 2 })));

    expect(registry.detect({})).toBeNull();
  });

  it('stringifies non-Error values thrown by canParse and parse', () => {
    const registry = new DeviceParserRegistry();
    const detectorThrower = makeParser(
      'detector-throw',
      20,
      () => {
        throw 'detector-string';
      }
    );
    const parseThrower = makeParser(
      'parse-throw',
      10,
      () => ({ detected: true, confidence: 100 }),
      () => {
        throw 'parse-string';
      }
    );

    registry.register(detectorThrower);
    registry.register(parseThrower);

    expect(registry.detect({ foo: 'bar' })?.id).toBe('parse-throw');
    expect(mockWarn).toHaveBeenCalledWith(
      'Parser canParse threw error',
      expect.objectContaining({ parser: 'detector-throw', error: 'detector-string' })
    );

    expect(registry.parse({ foo: 'bar' })).toBeNull();
    expect(mockWarn).toHaveBeenCalledWith(
      'Parser threw error during parse',
      expect.objectContaining({ parser: 'parse-throw', error: 'parse-string' })
    );
  });

  it('returns detectAll sorted by confidence and fallback values for thrown detectors', () => {
    const registry = new DeviceParserRegistry();
    const parserA = makeParser('a', 1, () => ({ detected: true, confidence: 40 }));
    const parserB = makeParser('b', 2, () => ({ detected: true, confidence: 80 }));
    const parserC = makeParser(
      'c',
      3,
      () => {
        throw new Error('boom');
      }
    );
    registry.register(parserA);
    registry.register(parserB);
    registry.register(parserC);

    const results = registry.detectAll('payload');
    expect(results.map(r => r.parser.id)).toEqual(['b', 'a', 'c']);
    expect(results.find(r => r.parser.id === 'c')?.result).toEqual({ detected: false, confidence: 0 });
  });

  it('parses using explicit parser ID and appends format field', () => {
    const registry = new DeviceParserRegistry();
    const parser = makeParser('explicit', 5, () => ({ detected: false, confidence: 0 }), () => ({
      xpub: 'xpub-explicit',
    }));
    registry.register(parser);

    expect(registry.parse({ raw: true }, 'explicit')).toEqual({
      xpub: 'xpub-explicit',
      format: 'explicit',
    });
  });

  it('returns null and warns when parser ID is unknown', () => {
    const registry = new DeviceParserRegistry();
    expect(registry.parse({ raw: true }, 'missing')).toBeNull();
    expect(mockWarn).toHaveBeenCalled();
  });

  it('returns null on parse() with no detected parser when debug is disabled', () => {
    const registry = new DeviceParserRegistry();
    registry.register(makeParser('none', 1, () => ({ detected: false, confidence: 0 })));

    expect(registry.parse({})).toBeNull();
  });

  it('auto-detects parser on parse() and handles missing/throwing parsers', () => {
    const registry = new DeviceParserRegistry({ debug: true });
    const good = makeParser('good', 10, () => ({ detected: true, confidence: 10 }), () => ({ xpub: 'xpub-good' }));
    const bad = makeParser('bad', 20, () => ({ detected: false, confidence: 0 }));
    registry.register(good);
    registry.register(bad);

    expect(registry.parse({ x: 1 })).toEqual({ xpub: 'xpub-good', format: 'good' });

    const noMatchRegistry = new DeviceParserRegistry({ debug: true });
    noMatchRegistry.register(makeParser('none', 1, () => ({ detected: false, confidence: 0 })));
    expect(noMatchRegistry.parse({})).toBeNull();
    expect(mockDebug).toHaveBeenCalled();

    const parseThrowsRegistry = new DeviceParserRegistry();
    parseThrowsRegistry.register(
      makeParser('throws', 1, () => ({ detected: true, confidence: 100 }), () => {
        throw new Error('parse failed');
      })
    );
    expect(parseThrowsRegistry.parse('anything')).toBeNull();
    expect(mockWarn).toHaveBeenCalled();
  });

  it('parseJson handles both valid JSON and raw string fallback', () => {
    const registry = new DeviceParserRegistry();
    registry.register(makeParser('json', 1, () => ({ detected: true, confidence: 100 })));

    expect(registry.parseJson('{"k":"v"}')).toEqual({ xpub: 'json-xpub', format: 'json' });
    expect(registry.parseJson('not-json')).toEqual({ xpub: 'json-xpub', format: 'json' });
  });

  it('returns registry stats snapshot', () => {
    const registry = new DeviceParserRegistry();
    registry.register(makeParser('alpha', 2, () => ({ detected: false, confidence: 0 })));
    registry.register(makeParser('beta', 5, () => ({ detected: false, confidence: 0 })));

    expect(registry.getStats()).toEqual({
      parserCount: 2,
      parsers: [
        { id: 'beta', name: 'beta-name', priority: 5 },
        { id: 'alpha', name: 'alpha-name', priority: 2 },
      ],
    });
  });
});
