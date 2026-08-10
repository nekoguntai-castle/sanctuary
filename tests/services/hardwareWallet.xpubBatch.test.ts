import { describe, expect, it, vi } from 'vitest';
import { fetchStandardXpubBatch } from '../../src/services/hardwareWallet/xpubBatch';

const result = {
  purpose: 'single_sig' as const,
  scriptType: 'native_segwit' as const,
  path: "m/84'/0'/0'",
  xpub: 'xpub-test',
  fingerprint: 'ABCD1234',
};

describe('fetchStandardXpubBatch identity enforcement', () => {
  it('validates and canonicalizes the failure-aware service response', async () => {
    const service = {
      getAllXpubs: vi.fn(),
      getAllXpubsWithFailures: vi.fn(async () => ({
        results: [result],
        failures: [],
        totalPaths: 1,
      })),
    };

    await expect(fetchStandardXpubBatch(service, undefined, {
      connectedFingerprint: 'abcd1234',
    })).resolves.toEqual({
      results: [{ ...result, fingerprint: 'abcd1234' }],
      failures: [],
      totalPaths: 1,
    });
    expect(service.getAllXpubs).not.toHaveBeenCalled();
  });

  it('validates the legacy array response instead of trusting it', async () => {
    const service = { getAllXpubs: vi.fn(async () => [{ ...result, fingerprint: '' }]) };

    await expect(fetchStandardXpubBatch(service, undefined, {
      connectedFingerprint: 'abcd1234',
    })).rejects.toThrow(/master fingerprint/i);
  });

  it('requires connected identity to match the stored device', async () => {
    const service = { getAllXpubs: vi.fn(async () => [result]) };

    await expect(fetchStandardXpubBatch(service, undefined, {
      connectedFingerprint: 'deadbeef',
      storedFingerprint: 'abcd1234',
    })).rejects.toThrow(/fingerprint mismatch/i);
  });
});
