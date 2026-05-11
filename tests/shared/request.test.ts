import { describe,expect,it,vi } from 'vitest';
import { extractClientIp,generateRequestId,isSensitivePath,sanitizePath } from '@sanctuary/shared/utils/request';

describe('shared request utilities', () => {
  it('generateRequestId uses crypto.randomUUID when available', () => {
    const originalCrypto = globalThis.crypto;
    const randomUUID = vi.fn().mockReturnValue('abcd1234-ffff-eeee-dddd-ccccbbbb9999');
    vi.stubGlobal('crypto', { randomUUID } as unknown as Crypto);

    expect(generateRequestId()).toBe('abcd1234');
    expect(randomUUID).toHaveBeenCalledTimes(1);

    vi.stubGlobal('crypto', originalCrypto);
  });

  it('generateRequestId falls back to random hex when randomUUID is unavailable', () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {} as unknown as Crypto);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

    const id = generateRequestId();
    expect(id).toHaveLength(8);
    expect(id).toMatch(/^[0-9a-f]+$/);

    randomSpy.mockRestore();
    vi.stubGlobal('crypto', originalCrypto);
  });

  it('extractClientIp prefers forwarded header and falls back to remote/unknown', () => {
    expect(extractClientIp('203.0.113.1, 198.51.100.2', '10.0.0.1')).toBe('203.0.113.1');
    expect(extractClientIp(['198.51.100.4, 198.51.100.5'], '10.0.0.2')).toBe('198.51.100.4');
    expect(extractClientIp(undefined, '192.0.2.10')).toBe('192.0.2.10');
    expect(extractClientIp(undefined, undefined)).toBe('unknown');
  });

  it('sanitizePath strips control characters and applies max length limit', () => {
    expect(sanitizePath('/api/\nsecret\tpath\r')).toBe('/api/secretpath');
    expect(sanitizePath('/very/long/path', 5)).toBe('/very');
  });

  it('isSensitivePath matches auth/admin-sensitive endpoints only', () => {
    expect(isSensitivePath('/v1/auth/login')).toBe(true);
    expect(isSensitivePath('/v1/auth/password/reset')).toBe(true);
    expect(isSensitivePath('/v1/admin/node-config')).toBe(true);
    expect(isSensitivePath('/v1/wallets/list')).toBe(false);
  });
});
