import { describe, expect, it, vi } from 'vitest';
import { memoizeUntilRejected } from '../../src/utils/memoizeUntilRejected';

// Regression: lazy `import()` promises for the hardware-wallet runtime and the
// BitBox modules were memoized with `??=` and never cleared on rejection, so
// one failed chunk load (deploy changed chunk hashes, network blip) failed
// every later hardware-wallet action until a full page reload.

describe('memoizeUntilRejected', () => {
  it('shares one in-flight and resolved promise', async () => {
    const load = vi.fn(async () => ({ ok: true }));
    const get = memoizeUntilRejected(load);

    const [a, b] = await Promise.all([get(), get()]);
    const c = await get();

    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('retries after a rejected load instead of caching the failure', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce({ ok: true });
    const get = memoizeUntilRejected(load);

    await expect(get()).rejects.toThrow('Failed to fetch dynamically imported module');
    await expect(get()).resolves.toEqual({ ok: true });
    await get();

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale rejection clear a newer load', async () => {
    let rejectFirst!: (error: Error) => void;
    const load = vi.fn()
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
      .mockResolvedValue({ ok: true });
    const get = memoizeUntilRejected(load);

    const first = get();
    rejectFirst(new Error('boom'));
    await expect(first).rejects.toThrow('boom');
    const second = get();
    await expect(second).resolves.toEqual({ ok: true });
    expect(get()).toBe(second);
  });
});
