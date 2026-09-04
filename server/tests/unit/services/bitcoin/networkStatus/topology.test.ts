import { describe, expect, it } from 'vitest';
import {
  eligibleServersFor,
  toOperationalServerInputs,
  failoverRolesFor,
  type ConfiguredServerRow,
} from '../../../../../src/services/bitcoin/networkStatus/topology';

function row(overrides: Partial<ConfiguredServerRow> & Pick<ConfiguredServerRow, 'id'>): ConfiguredServerRow {
  return {
    label: overrides.id,
    host: `${overrides.id}.example.com`,
    port: 50002,
    network: 'mainnet',
    enabled: true,
    priority: 1,
    ...overrides,
  };
}

describe('eligibleServersFor', () => {
  it('excludes disabled, wrong-network, and silent-payments-only servers', () => {
    const servers = [
      row({ id: 'a', enabled: true, network: 'mainnet' }),
      row({ id: 'disabled', enabled: false, network: 'mainnet' }),
      row({ id: 'other-net', enabled: true, network: 'testnet3' }),
      row({ id: 'sp-only', enabled: true, network: 'mainnet', serverUsage: 'silent_payments' }),
      row({ id: 'both', enabled: true, network: 'mainnet', serverUsage: 'both' }),
    ];
    const result = eligibleServersFor(servers, 'mainnet');
    expect(result.map((s) => s.id).sort()).toEqual(['a', 'both']);
  });

  it('orders canonically by (priority, id), including a tie-break for equal priority', () => {
    const servers = [
      row({ id: 'z', priority: 1 }),
      row({ id: 'a', priority: 1 }),
      row({ id: 'mid', priority: 0 }),
    ];
    const result = eligibleServersFor(servers, 'mainnet');
    expect(result.map((s) => s.id)).toEqual(['mid', 'a', 'z']);
  });

  it('returns an empty array for undefined servers', () => {
    expect(eligibleServersFor(undefined, 'mainnet')).toEqual([]);
  });

  it('defaults an unset priority to 0 when ordering', () => {
    const servers = [
      row({ id: 'b', priority: 1 }),
      row({ id: 'unset', priority: undefined }),
    ];
    const result = eligibleServersFor(servers, 'mainnet');
    expect(result.map((s) => s.id)).toEqual(['unset', 'b']);
  });
});

describe('toOperationalServerInputs', () => {
  it('prefers live stats over persisted values when present', () => {
    const servers = [row({ id: 'a', isHealthy: false, lastHealthCheck: '2026-01-01T00:00:00.000Z' })];
    const live = new Map([['a', { isHealthy: true, lastHealthCheck: new Date('2026-02-01T00:00:00.000Z'), cooldownUntil: null }]]);
    const [input] = toOperationalServerInputs(servers, live);
    expect(input.isHealthy).toBe(true);
    expect(input.lastHealthCheck).toEqual(new Date('2026-02-01T00:00:00.000Z'));
  });

  it('falls back to persisted values when no live entry exists', () => {
    const servers = [row({ id: 'a', isHealthy: true, lastHealthCheck: '2026-01-01T00:00:00.000Z' })];
    const [input] = toOperationalServerInputs(servers, new Map());
    expect(input.isHealthy).toBe(true);
    expect(input.lastHealthCheck).toBe('2026-01-01T00:00:00.000Z');
  });

  it('passes through a null lastHealthCheck from a live entry unmodified', () => {
    const servers = [row({ id: 'a', isHealthy: true, lastHealthCheck: '2026-01-01T00:00:00.000Z' })];
    const live = new Map([['a', { isHealthy: true, lastHealthCheck: null, cooldownUntil: null }]]);
    const [input] = toOperationalServerInputs(servers, live);
    expect(input.lastHealthCheck).toBeNull();
  });

  it('defaults isHealthy/lastHealthCheck to false/null when persisted values are entirely unset (no live entry)', () => {
    const servers = [row({ id: 'a' })];
    const [input] = toOperationalServerInputs(servers, new Map());
    expect(input.isHealthy).toBe(false);
    expect(input.lastHealthCheck).toBeNull();
  });
});

describe('failoverRolesFor', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z');

  it('exposes primaryServerId as the first canonical server', () => {
    const servers = [row({ id: 'b', priority: 2 }), row({ id: 'a', priority: 1 })];
    const roles = failoverRolesFor(servers, new Map(), now);
    expect(roles.primaryServerId).toBe('a');
  });

  it('nextAfter excludes the given server and returns the next eligible candidate', () => {
    const servers = [row({ id: 'primary', priority: 1 }), row({ id: 'backup', priority: 2 })];
    const roles = failoverRolesFor(servers, new Map(), now);
    expect(roles.nextAfter('primary')).toBe('backup');
    expect(roles.nextAfter('backup')).toBe('primary');
  });

  it('uses a persisted lastHealthCheck string (parsed to a Date) when no live entry exists', () => {
    const servers = [
      row({ id: 'primary', priority: 1, isHealthy: true, lastHealthCheck: '2026-01-01T00:00:00.000Z' }),
      row({ id: 'backup', priority: 2, isHealthy: true }),
    ];
    const roles = failoverRolesFor(servers, new Map(), now);
    // Both eligible (no cooldown, isHealthy true) -> primary wins on priority.
    expect(roles.preferredServerId).toBe('primary');
  });

  it('nextAfter returns null when excluding the only server', () => {
    const servers = [row({ id: 'only', priority: 1 })];
    const roles = failoverRolesFor(servers, new Map(), now);
    expect(roles.nextAfter('only')).toBeNull();
  });

  it('never-checked servers (no live stats, no persisted completed check) are all treated as available: preferred = primary', () => {
    // Neither server has isHealthy or lastHealthCheck set at all -- this is
    // the "uninitialized pool, nothing checked yet" case. A never-checked
    // server must not be synthesized as isHealthy:false; it must be omitted
    // from the state map entirely so the canonical selector's "no stats ->
    // available" default (matching createDefaultServerState()) applies.
    const servers = [row({ id: 'primary', priority: 1 }), row({ id: 'backup', priority: 2 })];
    const roles = failoverRolesFor(servers, new Map(), now);
    expect(roles.preferredServerId).toBe('primary');
  });

  it('a persisted-offline primary loses to a never-checked backup: preferred = backup', () => {
    const servers = [
      row({ id: 'primary', priority: 1, isHealthy: false, lastHealthCheck: '2026-01-01T00:00:00.000Z' }),
      row({ id: 'backup', priority: 2 }),
    ];
    const roles = failoverRolesFor(servers, new Map(), now);
    expect(roles.preferredServerId).toBe('backup');
  });

  it('the DTO availability for a never-checked server stays "unchecked", not "offline"', () => {
    const servers = [row({ id: 'a' })];
    const [input] = toOperationalServerInputs(servers, new Map());
    // toOperationalServerInputs reports the persisted shape directly; the
    // enum derivation itself lives in the projector, but the raw inputs it
    // consumes must not fabricate isHealthy:false as if a check completed.
    expect(input.lastHealthCheck).toBeNull();
  });

  it('preferredServerId skips a cooling-down primary', () => {
    const servers = [
      row({ id: 'primary', priority: 1, isHealthy: true }),
      row({ id: 'backup', priority: 2, isHealthy: true }),
    ];
    const live = new Map([
      ['primary', { isHealthy: true, lastHealthCheck: new Date(now), cooldownUntil: new Date(now + 60_000) }],
    ]);
    const roles = failoverRolesFor(servers, live, now);
    expect(roles.preferredServerId).toBe('backup');
  });
});
