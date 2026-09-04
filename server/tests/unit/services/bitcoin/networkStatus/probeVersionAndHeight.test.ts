import { describe, expect, it } from 'vitest';
import { probeVersionAndHeight } from '../../../../../src/services/bitcoin/networkStatus/probeVersionAndHeight';

describe('probeVersionAndHeight', () => {
  it('returns ok:true with both values on full success', async () => {
    const result = await probeVersionAndHeight({
      getServerVersion: () => Promise.resolve({ server: 'X', protocol: '1.4' }),
      getBlockHeight: () => Promise.resolve(500),
    });

    expect(result).toEqual({ ok: true, version: { server: 'X', protocol: '1.4' }, blockHeight: 500 });
  });

  it('surfaces the version rejection reason when only the version RPC fails', async () => {
    const versionError = new Error('version failed');
    const result = await probeVersionAndHeight({
      getServerVersion: () => Promise.reject(versionError),
      getBlockHeight: () => Promise.resolve(500),
    });

    expect(result).toEqual({ ok: false, failure: versionError });
  });

  it('surfaces the height rejection reason when only the height RPC fails', async () => {
    const heightError = new Error('height failed');
    const result = await probeVersionAndHeight({
      getServerVersion: () => Promise.resolve({ server: 'X', protocol: '1.4' }),
      getBlockHeight: () => Promise.reject(heightError),
    });

    expect(result).toEqual({ ok: false, failure: heightError });
  });

  it('surfaces the version rejection reason (not the height reason) when both RPCs reject', async () => {
    const versionError = new Error('version failed');
    const heightError = new Error('height failed');
    const result = await probeVersionAndHeight({
      getServerVersion: () => Promise.reject(versionError),
      getBlockHeight: () => Promise.reject(heightError),
    });

    expect(result).toEqual({ ok: false, failure: versionError });
  });
});
