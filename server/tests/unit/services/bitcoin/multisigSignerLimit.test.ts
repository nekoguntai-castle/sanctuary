import { describe, expect, it } from 'vitest';
import {
  MULTISIG_SIGNER_LIMIT_MESSAGE,
  assertSupportedMultisigSignerCount,
  exceedsMultisigSignerLimit,
} from '../../../../src/services/bitcoin/multisigSignerLimit';

describe('multisigSignerLimit', () => {
  it.each([
    [2, false],
    [16, false],
    [17, true],
  ])('reports whether %i signers exceed the spendable limit', (signerCount, exceeds) => {
    expect(exceedsMultisigSignerLimit(signerCount)).toBe(exceeds);
  });

  it('asserts the same boundary', () => {
    expect(() => assertSupportedMultisigSignerCount(16)).not.toThrow();
    expect(() => assertSupportedMultisigSignerCount(17)).toThrow(MULTISIG_SIGNER_LIMIT_MESSAGE);
  });
});
