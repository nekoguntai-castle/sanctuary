import { describe, expect, it, vi } from 'vitest';

const { mockGetConfig } = vi.hoisted(() => ({ mockGetConfig: vi.fn() }));

vi.mock('../../../src/config', () => ({ getConfig: mockGetConfig }));

import { requestWorkerDiagnostics } from '../../../src/services/workerDiagnosticsClient';

const snapshot = {
  protocolVersion: 1,
  sampledAt: '2026-08-02T00:00:00.000Z',
  worker: { readiness: 'ready', uptime: '1h-24h', concurrency: '2-5' },
  notificationPipeline: { consumerRunning: true, transactionHandlerRegistered: true },
  redis: { state: 'connected' },
  database: { state: 'connected' },
  electrum: {
    managerRunning: true,
    connected: true,
    subscriptionOwner: true,
    subscribedAddresses: '2-5',
  },
  telegram: {
    circuitState: 'closed',
    failures: '0',
    totalRequests: '2-5',
    lastFailureAge: 'never',
    lastSuccessAge: 'never',
    lastFailureClass: 'none',
  },
  notificationTelemetryWriter: { observation: 'unavailable' },
};

describe('worker diagnostics client', () => {
  const options = {
    url: 'http://worker:3002/internal/diagnostics/v1/snapshot',
    secret: 's'.repeat(32),
    timeoutMs: 1000,
    nowMs: 1_800_000_000_000,
    nonce: 'a'.repeat(32),
  };

  it('signs the request and returns a validated observation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await expect(requestWorkerDiagnostics({ ...options, fetchImpl })).resolves.toEqual({
      status: 'observed',
      value: snapshot,
    });
    expect(fetchImpl).toHaveBeenCalledWith(options.url, expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'x-sanctuary-nonce': options.nonce,
        'x-sanctuary-signature': expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }));
  });

  it('uses configured defaults and the global fetch implementation', async () => {
    mockGetConfig.mockReturnValue({
      worker: {
        diagnosticsUrl: options.url,
        diagnosticsSecret: options.secret,
        diagnosticsTimeoutMs: 321,
      },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(snapshot)),
    );

    await expect(requestWorkerDiagnostics()).resolves.toEqual({
      status: 'observed',
      value: snapshot,
    });
    expect(fetchSpy).toHaveBeenCalledWith(options.url, expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
  });

  it.each([
    { diagnosticsUrl: '', diagnosticsSecret: options.secret },
    { diagnosticsUrl: options.url, diagnosticsSecret: '' },
  ])('fails closed when configured diagnostics credentials are incomplete', async (worker) => {
    mockGetConfig.mockReturnValue({ worker });

    await expect(requestWorkerDiagnostics()).resolves.toEqual({ status: 'unavailable' });
  });

  it.each([404, 426])('maps HTTP %s to unsupported', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status }));
    await expect(requestWorkerDiagnostics({ ...options, fetchImpl })).resolves.toEqual({
      status: 'unsupported',
    });
  });

  it('rejects an invalid success payload as unsupported', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ protocolVersion: 2 })));
    await expect(requestWorkerDiagnostics({ ...options, fetchImpl })).resolves.toEqual({
      status: 'unsupported',
    });
  });

  it('maps an unsuccessful non-protocol response to unavailable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('private failure', { status: 500 }));

    await expect(requestWorkerDiagnostics({ ...options, fetchImpl })).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it.each([
    new Response(JSON.stringify(snapshot), {
      headers: { 'Content-Length': '9999' },
    }),
    new Response('x'.repeat(128), {
      headers: { 'Content-Length': '1' },
    }),
  ])('rejects declared and streamed oversized responses', async (response) => {
    const fetchImpl = vi.fn().mockResolvedValue(response);
    await expect(requestWorkerDiagnostics({
      ...options,
      fetchImpl,
      maxResponseBytes: 64,
    })).resolves.toEqual({ status: 'unavailable' });
  });

  it('rejects malformed bounded JSON without exposing it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{private malformed'));
    await expect(requestWorkerDiagnostics({ ...options, fetchImpl })).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('rejects a successful response without a body', async () => {
    const response = new Response(null, { status: 200 });
    const fetchImpl = vi.fn().mockResolvedValue(response);

    await expect(requestWorkerDiagnostics({ ...options, fetchImpl })).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('tolerates cancellation failure while rejecting a declared oversized response', async () => {
    const body = new ReadableStream({
      cancel: () => {
        throw new Error('private cancellation failure');
      },
    });
    const response = new Response(body, { headers: { 'Content-Length': '65' } });
    const fetchImpl = vi.fn().mockResolvedValue(response);

    await expect(requestWorkerDiagnostics({
      ...options,
      fetchImpl,
      maxResponseBytes: 64,
    })).resolves.toEqual({ status: 'unavailable' });
  });

  it('tolerates reader cancellation failure after a streamed response crosses the limit', async () => {
    const body = new ReadableStream({
      start: (controller) => controller.enqueue(new Uint8Array(65)),
      cancel: () => {
        throw new Error('private cancellation failure');
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body));

    await expect(requestWorkerDiagnostics({
      ...options,
      fetchImpl,
      maxResponseBytes: 64,
    })).resolves.toEqual({ status: 'unavailable' });
  });

  it('returns timeout without exposing transport errors', async () => {
    const error = new Error('private upstream detail');
    error.name = 'TimeoutError';
    const fetchImpl = vi.fn().mockRejectedValue(error);
    await expect(requestWorkerDiagnostics({ ...options, fetchImpl })).resolves.toEqual({
      status: 'timeout',
    });
  });

  it.each(['AbortError', 'TimeoutError'])('classifies %s transport failures as timeouts', async (name) => {
    const error = new Error('private upstream detail');
    error.name = name;
    const fetchImpl = vi.fn().mockRejectedValue(error);

    await expect(requestWorkerDiagnostics({ ...options, fetchImpl })).resolves.toEqual({
      status: 'timeout',
    });
  });

  it('maps non-error and ordinary transport failures to unavailable', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce('private failure')
      .mockRejectedValueOnce(new Error('private failure'));

    await expect(requestWorkerDiagnostics({ ...options, fetchImpl })).resolves.toEqual({
      status: 'unavailable',
    });
    await expect(requestWorkerDiagnostics({ ...options, fetchImpl })).resolves.toEqual({
      status: 'unavailable',
    });
  });
});
