import { describe, expect, it } from 'vitest';
import { MobileCreateDeviceRequestSchema } from '../../shared/schemas/mobileApiRequests';

const validAccount = {
  purpose: 'single_sig' as const,
  scriptType: 'native_segwit' as const,
  derivationPath: "m/84'/0'/0'",
  xpub: 'xpub-device-evidence',
};

describe('mobile device request identity evidence', () => {
  it('normalizes a valid master fingerprint with account evidence', () => {
    const result = MobileCreateDeviceRequestSchema.parse({
      type: 'ledger',
      label: 'Ledger',
      fingerprint: 'ABCD1234',
      accounts: [validAccount],
    });

    expect(result.fingerprint).toBe('abcd1234');
  });

  it.each(['', 'abcd123', 'not-hex!', '00000000', ' ABCD1234 '])(
    'rejects invalid or unverified fingerprint evidence %j',
    fingerprint => {
      expect(MobileCreateDeviceRequestSchema.safeParse({
        type: 'ledger',
        label: 'Ledger',
        fingerprint,
        accounts: [validAccount],
      }).success).toBe(false);
    },
  );

  it('requires legacy xpub and derivation-path evidence as an exact pair', () => {
    const base = { type: 'ledger', label: 'Ledger', fingerprint: 'abcd1234' };

    expect(MobileCreateDeviceRequestSchema.safeParse({
      ...base,
      xpub: 'xpub-device-evidence',
    }).success).toBe(false);
    expect(MobileCreateDeviceRequestSchema.safeParse({
      ...base,
      derivationPath: "m/84'/0'/0'",
    }).success).toBe(false);
    expect(MobileCreateDeviceRequestSchema.safeParse({
      ...base,
      xpub: ' xpub-device-evidence',
      derivationPath: "m/84'/0'/0'",
    }).success).toBe(false);
  });
});
