import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => mocks.logger,
}));

import {
  extractXpubsFromDescriptor,
  getHardwareWalletType,
} from '../../hooks/send/types';

describe('hooks/send/types helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['trezor-safe-7', 'trezor'],
    ['LEDGER-NANO-X', 'ledger'],
    ['ColdCard Mk4', 'coldcard'],
    ['bitbox02', 'bitbox'],
    ['foundation-passport', 'passport'],
    ['blockstream-jade', 'jade'],
    ['unknown-device', null],
  ])('maps device type %s to %s', (input, expected) => {
    expect(getHardwareWalletType(input)).toBe(expected);
  });

  it('returns undefined and warns when descriptor is missing', () => {
    expect(extractXpubsFromDescriptor(undefined)).toBeUndefined();
    expect(mocks.logger.warn).toHaveBeenCalledWith('extractXpubsFromDescriptor: No descriptor provided');
  });

  it('returns undefined when descriptor has no xpub entries', () => {
    const descriptor = 'wpkh([abcdef12/84h/0h/0h]02abcdef0123456789)';

    expect(extractXpubsFromDescriptor(descriptor)).toBeUndefined();
    expect(mocks.logger.warn).toHaveBeenCalledWith('extractXpubsFromDescriptor: No xpubs found in descriptor');
  });

  it('extracts lowercase fingerprint -> xpub map from descriptor', () => {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const xpub = `xpub${alphabet}`;
    const zpub = `zpub${alphabet.slice(0, 40)}`;
    const descriptor =
      `wsh(sortedmulti(2,[A1B2C3D4/48h/0h/0h/2h]${xpub}/0/*,` +
      `[deadBEEF/48h/0h/0h/2h]${zpub}/0/*))`;

    const result = extractXpubsFromDescriptor(descriptor);

    expect(result).toEqual({
      a1b2c3d4: xpub,
      deadbeef: zpub,
    });
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'extractXpubsFromDescriptor: Extracted xpubs',
      expect.objectContaining({
        count: 2,
        fingerprints: ['a1b2c3d4', 'deadbeef'],
      })
    );
  });
});
