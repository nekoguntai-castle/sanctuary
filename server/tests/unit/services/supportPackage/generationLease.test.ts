import { describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import { acquireSupportPackageGenerationLease } from '../../../../src/services/supportPackage/generationLease';

function client() {
  return {
    set: vi.fn(),
    eval: vi.fn(),
  } as unknown as Redis;
}

describe('support package generation lease', () => {
  it('returns unavailable without a connected dedicated store', async () => {
    await expect(acquireSupportPackageGenerationLease(null, false))
      .resolves.toEqual({ status: 'unavailable' });
  });

  it('returns busy when another deployment replica owns the lease', async () => {
    const redis = client();
    vi.mocked(redis.set).mockResolvedValue(null);

    await expect(acquireSupportPackageGenerationLease(redis, true))
      .resolves.toEqual({ status: 'busy' });
  });

  it('releases with compare-and-delete ownership', async () => {
    const redis = client();
    vi.mocked(redis.set).mockResolvedValue('OK');
    vi.mocked(redis.eval).mockResolvedValue(1);

    const lease = await acquireSupportPackageGenerationLease(redis, true);
    expect(lease.status).toBe('acquired');
    if (lease.status !== 'acquired') throw new Error('lease not acquired');
    await lease.release();

    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('generation-lease'),
      expect.any(String),
      'PX',
      90_000,
      'NX',
    );
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET'"),
      1,
      expect.stringContaining('generation-lease'),
      expect.any(String),
    );
  });

  it('fails closed on Redis errors', async () => {
    const redis = client();
    vi.mocked(redis.set).mockRejectedValue(new Error('redis failed'));

    await expect(acquireSupportPackageGenerationLease(redis, true))
      .resolves.toEqual({ status: 'unavailable' });
  });

  it('fails closed when lease acquisition stalls', async () => {
    vi.useFakeTimers();
    const redis = client();
    vi.mocked(redis.set).mockReturnValue(new Promise(() => undefined));

    const lease = acquireSupportPackageGenerationLease(redis, true);
    await vi.advanceTimersByTimeAsync(501);

    await expect(lease).resolves.toEqual({ status: 'unavailable' });
    vi.useRealTimers();
  });

  it('bounds release while leaving TTL recovery intact', async () => {
    vi.useFakeTimers();
    const redis = client();
    vi.mocked(redis.set).mockResolvedValue('OK');
    vi.mocked(redis.eval).mockReturnValue(new Promise(() => undefined));

    const lease = await acquireSupportPackageGenerationLease(redis, true);
    if (lease.status !== 'acquired') throw new Error('lease not acquired');
    const release = lease.release().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(501);

    await expect(release).resolves.toEqual(
      expect.objectContaining({ message: 'support_package_lease_timeout' }),
    );
    vi.useRealTimers();
  });
});
