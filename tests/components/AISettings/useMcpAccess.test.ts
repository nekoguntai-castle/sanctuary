import { describe, expect, it } from 'vitest';
import {
  getMcpKeyLifecycle,
  localDateTimeToIso,
  parseWalletScopeInput,
} from '../../../components/AISettings/hooks/useMcpAccess';

describe('useMcpAccess helpers', () => {
  it('normalizes wallet scope input', () => {
    expect(parseWalletScopeInput('wallet-1, wallet-2\nwallet-1')).toEqual(['wallet-1', 'wallet-2']);
    expect(parseWalletScopeInput('   ')).toBeUndefined();
  });

  it('converts datetime-local values to ISO when valid', () => {
    expect(localDateTimeToIso('not-a-date')).toBeUndefined();
    expect(localDateTimeToIso('')).toBeUndefined();
    expect(localDateTimeToIso('2026-05-01T12:30')).toMatch(/^2026-05-01T/);
  });

  it('classifies MCP key lifecycle states', () => {
    const now = new Date('2026-05-01T00:00:00.000Z');

    expect(getMcpKeyLifecycle({
      id: 'key-1',
      userId: 'user-1',
      name: 'Active',
      keyPrefix: 'mcp_active',
      scope: {},
      createdAt: now.toISOString(),
    }, now)).toBe('active');
    expect(getMcpKeyLifecycle({
      id: 'key-2',
      userId: 'user-1',
      name: 'Expired',
      keyPrefix: 'mcp_expired',
      scope: {},
      createdAt: now.toISOString(),
      expiresAt: '2026-04-30T00:00:00.000Z',
    }, now)).toBe('expired');
    expect(getMcpKeyLifecycle({
      id: 'key-3',
      userId: 'user-1',
      name: 'Revoked',
      keyPrefix: 'mcp_revoked',
      scope: {},
      createdAt: now.toISOString(),
      revokedAt: '2026-04-30T00:00:00.000Z',
    }, now)).toBe('revoked');
  });
});
