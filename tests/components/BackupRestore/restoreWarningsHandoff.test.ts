import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import {
  RESTORE_WARNINGS_HANDOFF_KEY,
  RESTORE_WARNINGS_HANDOFF_TTL_MS,
  restoreWarningNotification,
  stashRestoreWarnings,
  takeRestoreWarnings,
} from '../../../src/components/BackupRestore/hooks/restoreWarningsHandoff';

const loggerSpies = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => loggerSpies,
}));

const NOW = 1_800_000_000_000;

function seed(value: unknown) {
  sessionStorage.setItem(RESTORE_WARNINGS_HANDOFF_KEY, typeof value === 'string' ? value : JSON.stringify(value));
}

describe('restoreWarningsHandoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('uses the literal storage key and a 24 hour TTL', () => {
    expect(RESTORE_WARNINGS_HANDOFF_KEY).toBe('sanctuary_restore_warnings_handoff');
    expect(RESTORE_WARNINGS_HANDOFF_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('stashes the warnings and returns the written hand-off', () => {
    const handoff = stashRestoreWarnings(['w1', 'w2'], NOW);

    expect(handoff.createdAt).toBe(NOW);
    expect(handoff.warnings).toStrictEqual(['w1', 'w2']);
    expect(handoff.id).toMatch(new RegExp(`^${NOW}-[0-9a-z]+$`));
    expect(JSON.parse(sessionStorage.getItem(RESTORE_WARNINGS_HANDOFF_KEY) as string)).toStrictEqual(handoff);
  });

  it('gives successive stashes distinct ids', () => {
    const first = stashRestoreWarnings(['w1'], NOW);
    const second = stashRestoreWarnings(['w1'], NOW);
    expect(first.id).not.toBe(second.id);
  });

  it('defaults createdAt to the current time', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    expect(stashRestoreWarnings(['w1']).createdAt).toBe(NOW);
  });

  it('still returns the hand-off when sessionStorage refuses the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const handoff = stashRestoreWarnings(['w1'], NOW);

    expect(handoff.warnings).toStrictEqual(['w1']);
    expect(loggerSpies.debug).toHaveBeenCalledTimes(1);
  });

  it('returns null when no hand-off is stored', () => {
    expect(takeRestoreWarnings(NOW)).toBeNull();
  });

  it('returns a valid hand-off once and removes the key', () => {
    const handoff = stashRestoreWarnings(['w1', 'w2'], NOW);

    expect(takeRestoreWarnings(NOW + 1000)).toStrictEqual(handoff);
    expect(sessionStorage.getItem(RESTORE_WARNINGS_HANDOFF_KEY)).toBeNull();
    expect(takeRestoreWarnings(NOW + 1000)).toBeNull();
  });

  it('defaults the take time to the current time', () => {
    const handoff = stashRestoreWarnings(['w1'], NOW);
    vi.spyOn(Date, 'now').mockReturnValue(NOW + RESTORE_WARNINGS_HANDOFF_TTL_MS);
    expect(takeRestoreWarnings()).toStrictEqual(handoff);
  });

  it('enforces the TTL bounds inclusively and rejects a future createdAt', () => {
    stashRestoreWarnings(['w1'], NOW);
    expect(takeRestoreWarnings(NOW)).not.toBeNull();

    stashRestoreWarnings(['w1'], NOW);
    expect(takeRestoreWarnings(NOW + RESTORE_WARNINGS_HANDOFF_TTL_MS)).not.toBeNull();

    stashRestoreWarnings(['w1'], NOW);
    expect(takeRestoreWarnings(NOW + RESTORE_WARNINGS_HANDOFF_TTL_MS + 1)).toBeNull();
    expect(sessionStorage.getItem(RESTORE_WARNINGS_HANDOFF_KEY)).toBeNull();

    stashRestoreWarnings(['w1'], NOW);
    expect(takeRestoreWarnings(NOW - 1)).toBeNull();
    expect(sessionStorage.getItem(RESTORE_WARNINGS_HANDOFF_KEY)).toBeNull();
  });

  it.each([
    ['malformed JSON', '{not json'],
    ['null', null],
    ['a non-object', 'just a string'],
    ['a missing id', { createdAt: NOW, warnings: ['w1'] }],
    ['a non-string id', { id: 7, createdAt: NOW, warnings: ['w1'] }],
    ['a non-numeric createdAt', { id: 'h', createdAt: '1', warnings: ['w1'] }],
    ['a non-finite createdAt', '{"id":"h","createdAt":1e999,"warnings":["w1"]}'],
    ['non-array warnings', { id: 'h', createdAt: NOW, warnings: 'w1' }],
    ['empty warnings', { id: 'h', createdAt: NOW, warnings: [] }],
    ['non-string warnings', { id: 'h', createdAt: NOW, warnings: ['w1', 2] }],
  ])('rejects and removes %s', (_label, value) => {
    seed(value === null ? 'null' : value);

    expect(takeRestoreWarnings(NOW)).toBeNull();
    expect(sessionStorage.getItem(RESTORE_WARNINGS_HANDOFF_KEY)).toBeNull();
  });

  it('returns null without throwing when sessionStorage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(takeRestoreWarnings(NOW)).toBeNull();
    expect(loggerSpies.debug).toHaveBeenCalledTimes(1);
  });

  it('builds a distinct persistent warning notification per index', () => {
    const handoff = { id: 'h-1', createdAt: NOW, warnings: ['w1', 'w2'] };

    expect(restoreWarningNotification(handoff, 'w2', 1)).toStrictEqual({
      type: 'warning',
      scope: 'global',
      scopeId: 'restore:h-1:1',
      severity: 'warning',
      title: 'Restore Warning',
      message: 'w2',
      persistent: true,
    });
  });
});
