import { EventEmitter } from 'node:events';
import https from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OutboundResponseTooLargeError,
  requestPinnedAddress,
} from '../../../../src/services/outboundNetwork/nativeRequest';

interface MockResponse extends EventEmitter {
  destroy: (error?: Error) => void;
  headers: Record<string, string>;
  statusCode: number;
}

interface MockRequest extends EventEmitter {
  destroy: (error?: Error) => void;
  end: (body?: string | Buffer) => void;
}

describe('pinned native request', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('pins the chosen IP while preserving original Host and TLS SNI without redirects', async () => {
    const { request, response } = mockHttpsResponse({ status: 302, chunks: ['redirect'] });
    const requestSpy = vi.spyOn(https, 'request').mockImplementationOnce(((options, callback) => {
      expect(options).toMatchObject({
        agent: false,
        hostname: '93.184.216.34',
        method: 'POST',
        path: '/payjoin?v=1',
        port: 443,
        protocol: 'https:',
        servername: 'merchant.example',
      });
      expect(options.headers).toMatchObject({ host: 'merchant.example' });
      callback?.(response as never);
      return request as never;
    }) as typeof https.request);

    await expect(requestPinnedAddress({
      url: new URL('https://merchant.example/payjoin?v=1'),
      resolvedAddress: '93.184.216.34',
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'psbt',
      responseByteLimit: 102_400,
      timeoutMs: 30_000,
    })).resolves.toMatchObject({
      ok: false,
      status: 302,
      body: Buffer.from('redirect'),
    });
    expect(requestSpy).toHaveBeenCalledOnce();
  });

  it('preserves a bracketed global IPv6 Host while omitting TLS SNI for the literal', async () => {
    const { request, response } = mockHttpsResponse({ status: 200, chunks: [] });
    vi.spyOn(https, 'request').mockImplementationOnce(((options, callback) => {
      expect(options).toMatchObject({
        hostname: '2606:4700:4700::1111',
        protocol: 'https:',
      });
      expect(options).not.toHaveProperty('servername');
      expect(options.headers).toMatchObject({
        host: '[2606:4700:4700::1111]',
      });
      callback?.(response as never);
      return request as never;
    }) as typeof https.request);

    await expect(requestPinnedAddress({
      ...makeOptions(),
      url: new URL('https://[2606:4700:4700::1111]/payjoin'),
      resolvedAddress: '2606:4700:4700::1111',
    })).resolves.toMatchObject({ ok: true, status: 200 });
  });

  it('accepts exactly 102400 raw response bytes', async () => {
    const body = Buffer.alloc(102_400, 0x61);
    installHttpsResponse({ chunks: [body], status: 200 });

    const response = await requestPinnedAddress(makeOptions());

    expect(response.body).toHaveLength(102_400);
  });

  it('rejects an over-limit Content-Length before buffering the body', async () => {
    const { request, response } = mockHttpsResponse({
      chunks: [],
      headers: { 'content-length': '102401' },
      status: 200,
    });
    const destroySpy = vi.spyOn(response, 'destroy');
    vi.spyOn(https, 'request').mockImplementationOnce(((_options, callback) => {
      callback?.(response as never);
      return request as never;
    }) as typeof https.request);

    await expect(requestPinnedAddress(makeOptions()))
      .rejects.toBeInstanceOf(OutboundResponseTooLargeError);
    expect(destroySpy).toHaveBeenCalled();
  });

  it('handles array and unsafe Content-Length header values fail-closed', async () => {
    installHttpsResponse({
      chunks: ['a'],
      headers: { 'content-length': ['1'] } as unknown as Record<string, string>,
      status: 200,
    });
    await expect(requestPinnedAddress(makeOptions())).resolves.toMatchObject({
      body: Buffer.from('a'),
    });

    installHttpsResponse({
      chunks: [],
      headers: { 'content-length': '999999999999999999999' },
      status: 200,
    });
    await expect(requestPinnedAddress(makeOptions()))
      .rejects.toBeInstanceOf(OutboundResponseTooLargeError);
  });

  it('rejects oversized chunked and multibyte bodies by raw bytes', async () => {
    installHttpsResponse({ chunks: [Buffer.alloc(102_400), Buffer.from('x')], status: 200 });
    await expect(requestPinnedAddress(makeOptions()))
      .rejects.toBeInstanceOf(OutboundResponseTooLargeError);

    installHttpsResponse({ chunks: ['€'.repeat(34_134)], status: 400 });
    await expect(requestPinnedAddress(makeOptions()))
      .rejects.toBeInstanceOf(OutboundResponseTooLargeError);
  });

  it('destroys a request on its absolute timeout', async () => {
    vi.useFakeTimers();
    const request = new EventEmitter() as MockRequest;
    request.end = vi.fn();
    request.destroy = (error?: Error) => request.emit('error', error);
    vi.spyOn(https, 'request').mockImplementationOnce((() => request as never) as typeof https.request);

    const pending = requestPinnedAddress({ ...makeOptions(), timeoutMs: 50 });
    const rejection = expect(pending).rejects.toThrow('Outbound request timeout');
    await vi.advanceTimersByTimeAsync(51);

    await rejection;
  });
});

function makeOptions() {
  return {
    url: new URL('https://merchant.example/payjoin'),
    resolvedAddress: '93.184.216.34',
    body: 'psbt',
    responseByteLimit: 102_400,
    timeoutMs: 30_000,
  };
}

function installHttpsResponse(input: {
  chunks: Array<string | Buffer>;
  headers?: Record<string, string>;
  status: number;
}): void {
  const { request, response } = mockHttpsResponse(input);
  vi.spyOn(https, 'request').mockImplementationOnce(((_options, callback) => {
    callback?.(response as never);
    return request as never;
  }) as typeof https.request);
}

function mockHttpsResponse(input: {
  chunks: Array<string | Buffer>;
  headers?: Record<string, string>;
  status: number;
}): { request: MockRequest; response: MockResponse } {
  const response = new EventEmitter() as MockResponse;
  response.headers = input.headers ?? {};
  response.statusCode = input.status;
  response.destroy = (error?: Error) => {
    if (error) queueMicrotask(() => response.emit('error', error));
  };

  const request = new EventEmitter() as MockRequest;
  request.destroy = (error?: Error) => {
    if (error) queueMicrotask(() => request.emit('error', error));
  };
  request.end = () => {
    queueMicrotask(() => {
      for (const chunk of input.chunks) response.emit('data', chunk);
      response.emit('end');
    });
  };
  return { request, response };
}
