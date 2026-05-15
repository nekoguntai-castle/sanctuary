import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkApiHealth, isConnectedHealthResponse } from '../../src/api/health';

function response(status: number, ok = status >= 200 && status < 300): Pick<Response, 'ok' | 'status'> {
  return { ok, status };
}

describe('API health helper', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('uses the shared API base URL with no-auth GET options', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200));

    await expect(checkApiHealth({ fetchImpl })).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/health', {
      method: 'GET',
      credentials: 'include',
      signal: expect.any(AbortSignal),
    });
    expect(fetchImpl.mock.calls[0][1]).not.toHaveProperty('headers');
  });

  it('joins configured VITE_API_URL values without double slashes', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test/v1/');
    const fetchImpl = vi.fn().mockResolvedValue(response(200));

    await checkApiHealth({ fetchImpl });

    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.test/v1/health');
  });

  it.each([
    [response(200), true],
    [response(204), true],
    [response(401, false), true],
    [response(503, false), false],
  ])('classifies health response %j as connected=%s', (healthResponse, expected) => {
    expect(isConnectedHealthResponse(healthResponse)).toBe(expected);
  });

  it('propagates network failures for callers to map to an error state', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));

    await expect(checkApiHealth({ fetchImpl })).rejects.toThrow('network down');
  });

  it('aborts the request when the health timeout expires', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return new Promise((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }) as unknown as typeof fetch;

    const check = checkApiHealth({ fetchImpl, timeoutMs: 10 }).catch((error: Error) => error);

    await vi.advanceTimersByTimeAsync(10);

    expect(capturedSignal?.aborted).toBe(true);
    const error = await check;
    expect((error as Error).message).toBe('aborted');
  });

  it('follows an external abort signal', async () => {
    const controller = new AbortController();
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return new Promise((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }) as unknown as typeof fetch;

    const check = checkApiHealth({ fetchImpl, signal: controller.signal }).catch((error: Error) => error);
    controller.abort();

    expect(capturedSignal?.aborted).toBe(true);
    const error = await check;
    expect((error as Error).message).toBe('aborted');
  });

  it('starts aborted when the external signal was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return Promise.reject(new Error('already aborted'));
    }) as unknown as typeof fetch;

    await expect(checkApiHealth({ fetchImpl, signal: controller.signal })).rejects.toThrow('already aborted');

    expect(capturedSignal?.aborted).toBe(true);
  });
});
