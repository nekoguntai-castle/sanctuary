import { describe, expect, it } from 'vitest';

export function registerNormalizeIncomingAccountsTests(): void {
describe('normalizeIncomingAccounts', () => {
  it('returns error when neither xpub nor accounts are provided', async () => {
    const { normalizeIncomingAccounts } = await import('../../../../src/api/devices/accountConflicts');
    const result = normalizeIncomingAccounts(undefined, undefined, undefined);
    expect(result).toEqual({ error: 'Either xpub or accounts array is required' });
  });
});
}
