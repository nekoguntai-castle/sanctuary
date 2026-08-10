import { describe, expect, it, vi } from 'vitest';
import { testXpubs } from '../../../../fixtures/bitcoin';

const policyMatch = vi.hoisted(() => vi.fn()
  .mockReturnValueOnce(true)
  .mockReturnValueOnce(false));

vi.mock('@sanctuary/shared/constants/walletPolicy', async (importOriginal) => ({
  ...await importOriginal<typeof import('@sanctuary/shared/constants/walletPolicy')>(),
  accountPathMatchesWalletPolicy: policyMatch,
}));

import { parseColdcardExport } from '../../../../../src/services/bitcoin/descriptorParser/coldcardParser';

describe('Coldcard selected-policy defense in depth', () => {
  it('rechecks the selected path even after candidate validation succeeds', () => {
    expect(() => parseColdcardExport({
      xfp: 'AABBCCDD',
      bip84: {
        xpub: testXpubs.mainnet.bip84,
        deriv: "m/84'/0'/0'",
      },
    })).toThrow('Coldcard derivation path does not match the selected wallet policy');
    expect(policyMatch).toHaveBeenCalledTimes(2);
  });
});
