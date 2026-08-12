import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import https from 'node:https';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JadePinRelayError,
  relayJadePinRequest,
} from '../../../src/services/jadePinRelay';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => logger,
}));

interface FakeRequest extends EventEmitter {
  destroy: (error?: Error) => void;
  end: (body?: string | Buffer) => void;
}

interface FakeResponse extends EventEmitter {
  complete: boolean;
  destroy: (error?: Error) => void;
  headers: Record<string, string | string[] | undefined>;
  statusCode?: number;
}

interface ResponseFixture {
  chunks?: ReadonlyArray<string | Buffer>;
  complete?: boolean;
  headers?: Record<string, string | string[] | undefined>;
  status?: number | null;
}

describe('Jade PIN fixed-destination relay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([
    ['get_pin', '/get_pin'],
    ['set_pin', '/set_pin'],
  ] as const)('constructs the fixed %s request without accepting a URL', async (operation, path) => {
    const { request, response } = makeResponse({
      chunks: ['{"pin":"reply"}'],
      headers: {
        'content-length': '15',
        'content-type': 'application/json; charset=utf-8',
      },
    });
    let writtenBody: string | Buffer | undefined;
    request.end = (body) => {
      writtenBody = body;
      emitResponse(response, ['{"pin":"reply"}']);
    };

    const requestSpy = installRequest(request, response, options => {
      expect(options).toMatchObject({
        agent: false,
        hostname: 'j8d.io',
        method: 'POST',
        path,
        port: 443,
        protocol: 'https:',
        servername: 'j8d.io',
      });
      expect(options.headers).toMatchObject({
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength('{"blinded":"payload"}'),
        'Content-Type': 'application/json',
      });
      expect(options).not.toHaveProperty('url');
    });

    await expect(relayJadePinRequest({ operation, data: { blinded: 'payload' } }))
      .resolves.toEqual({ pin: 'reply' });

    expect(requestSpy).toHaveBeenCalledOnce();
    expect(writtenBody).toBe('{"blinded":"payload"}');
  });

  it('accepts a request body of exactly 16 KiB and rejects one byte over before networking', async () => {
    const exactData = 'a'.repeat(16_384 - 2);
    const { request, response } = makeResponse({ chunks: ['null'] });
    installRequest(request, response);

    await expect(relayJadePinRequest({ operation: 'get_pin', data: exactData }))
      .resolves.toBeNull();

    const requestSpy = vi.spyOn(https, 'request');
    requestSpy.mockClear();
    await expect(relayJadePinRequest({ operation: 'get_pin', data: `${exactData}x` }))
      .rejects.toMatchObject({ category: 'request_too_large' });
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('rejects an operation outside the fixed allowlist without networking', async () => {
    const requestSpy = vi.spyOn(https, 'request');

    await expect(relayJadePinRequest({
      operation: 'https://attacker.invalid/private' as 'get_pin',
      data: {},
    })).rejects.toMatchObject({ category: 'invalid_operation' });

    expect(requestSpy).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    (() => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      return circular;
    })(),
  ])('rejects a non-serializable direct service input before networking', async data => {
    const requestSpy = vi.spyOn(https, 'request');

    await expect(relayJadePinRequest({
      operation: 'get_pin',
      data: data as never,
    })).rejects.toMatchObject({ category: 'request_too_large' });

    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('sanitizes a synchronous HTTPS request setup failure', async () => {
    const secret = 'synchronous-network-secret';
    const requestSpy = vi.spyOn(https, 'request').mockImplementationOnce(() => {
      throw new Error(secret);
    });

    const rejection = relayJadePinRequest({ operation: 'get_pin', data: {} });

    await expect(rejection).rejects.toMatchObject({ category: 'network' });
    await expect(rejection).rejects.not.toThrow(secret);
    expect(requestSpy).toHaveBeenCalledOnce();
  });

  it.each([
    [{ status: 302, headers: { location: 'https://j8d.io/get_pin' } }, 'status'],
    [{ status: 503 }, 'status'],
    [{ headers: { 'content-type': 'text/plain' } }, 'content_type'],
    [{ headers: { 'content-type': undefined } }, 'content_type'],
    [{ headers: { 'content-type': ['application/json', 'text/plain'] as string[] } }, 'content_type'],
    [{ chunks: ['not-json'] }, 'invalid_json'],
    [{ chunks: ['{"ok":true}'], complete: false }, 'truncated'],
    [{ status: null }, 'status'],
  ] as const)('fails closed for an invalid upstream response: %j', async (fixture, category) => {
    const { request, response } = makeResponse(fixture);
    installRequest(request, response);

    await expect(relayJadePinRequest({ operation: 'get_pin', data: {} }))
      .rejects.toMatchObject({ category });
  });

  it('rejects a declared oversized response before buffering it', async () => {
    const { request, response } = makeResponse({
      chunks: [],
      headers: {
        'content-length': '16385',
        'content-type': 'application/json',
      },
    });
    const destroyResponse = vi.spyOn(response, 'destroy');
    installRequest(request, response);

    await expect(relayJadePinRequest({ operation: 'get_pin', data: {} }))
      .rejects.toMatchObject({ category: 'response_too_large' });
    expect(destroyResponse).toHaveBeenCalled();
  });

  it.each(['invalid', ['12', '13'] as string[], '999999999999999999999'] as const)(
    'rejects an ambiguous Content-Length without buffering: %j',
    async contentLength => {
      const { request, response } = makeResponse({
        chunks: [],
        headers: { 'content-length': contentLength },
      });
      installRequest(request, response);

      await expect(relayJadePinRequest({ operation: 'get_pin', data: {} }))
        .rejects.toMatchObject({ category: 'response_too_large' });
    },
  );

  it('accepts exactly 16 KiB and rejects an oversized streamed response', async () => {
    const exact = JSON.stringify('a'.repeat(16_384 - 2));
    const exactFixture = makeResponse({ chunks: [exact] });
    installRequest(exactFixture.request, exactFixture.response);
    await expect(relayJadePinRequest({ operation: 'get_pin', data: {} }))
      .resolves.toBe('a'.repeat(16_384 - 2));

    const oversizedFixture = makeResponse({
      chunks: [Buffer.alloc(16_384, 0x20), Buffer.from('x')],
    });
    installRequest(oversizedFixture.request, oversizedFixture.response);
    await expect(relayJadePinRequest({ operation: 'get_pin', data: {} }))
      .rejects.toMatchObject({ category: 'response_too_large' });
  });

  it('fails a response stream error without exposing the upstream error', async () => {
    const secret = 'blind-pin-secret-response';
    const { request, response } = makeResponse({ chunks: [] });
    request.end = () => queueMicrotask(() => response.emit('error', new Error(secret)));
    installRequest(request, response);

    let rejection: unknown;
    try {
      await relayJadePinRequest({ operation: 'set_pin', data: {} });
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(JadePinRelayError);
    if (!(rejection instanceof JadePinRelayError)) {
      throw new Error('Expected JadePinRelayError');
    }
    expect(rejection.message).not.toContain(secret);
    expect(JSON.stringify(rejection.details)).not.toContain(secret);
  });

  it('rejects an aborted upstream response as truncated', async () => {
    const { request, response } = makeResponse({ chunks: [] });
    request.end = () => queueMicrotask(() => response.emit('aborted'));
    installRequest(request, response);

    await expect(relayJadePinRequest({ operation: 'get_pin', data: {} }))
      .rejects.toMatchObject({ category: 'truncated' });
  });

  it('rejects a premature response close as truncated', async () => {
    const { request, response } = makeResponse({ chunks: [], complete: false });
    request.end = () => queueMicrotask(() => response.emit('close'));
    installRequest(request, response);

    await expect(relayJadePinRequest({ operation: 'get_pin', data: {} }))
      .rejects.toMatchObject({ category: 'truncated' });
  });

  it('performs no automatic retry after a network error', async () => {
    const request = makePendingRequest();
    request.end = () => queueMicrotask(() => request.emit('error', new Error('offline')));
    const requestSpy = vi.spyOn(https, 'request')
      .mockImplementationOnce((() => request as never) as typeof https.request);

    await expect(relayJadePinRequest({ operation: 'get_pin', data: {} }))
      .rejects.toMatchObject({ category: 'network' });

    expect(requestSpy).toHaveBeenCalledOnce();
  });

  it('enforces a 5 second TLS connect timeout independently of the total deadline', async () => {
    vi.useFakeTimers();
    const request = makePendingRequest();
    const socket = Object.assign(new EventEmitter(), { connecting: true });
    const destroy = vi.spyOn(request, 'destroy');
    vi.spyOn(https, 'request').mockImplementationOnce((() => request as never) as typeof https.request);

    const pending = relayJadePinRequest({ operation: 'get_pin', data: {} });
    request.emit('socket', socket);
    const rejection = expect(pending).rejects.toMatchObject({ category: 'connect_timeout' });
    await vi.advanceTimersByTimeAsync(5_001);

    await rejection;
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('clears the connect deadline after TLS and enforces the 15 second total timeout', async () => {
    vi.useFakeTimers();
    const request = makePendingRequest();
    const socket = Object.assign(new EventEmitter(), { connecting: true });
    vi.spyOn(https, 'request').mockImplementationOnce((() => request as never) as typeof https.request);

    const pending = relayJadePinRequest({ operation: 'set_pin', data: {} });
    request.emit('socket', socket);
    socket.emit('secureConnect');
    await vi.advanceTimersByTimeAsync(5_001);
    expect(request.destroy).not.toHaveBeenCalled();

    const rejection = expect(pending).rejects.toMatchObject({ category: 'total_timeout' });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
  });

  it('ignores a late socket event after a synchronous response rejection', async () => {
    vi.useFakeTimers();
    const { request, response } = makeResponse({ status: 500, chunks: [] });
    installRequest(request, response);

    const rejection = relayJadePinRequest({ operation: 'get_pin', data: {} });
    request.emit('socket', Object.assign(new EventEmitter(), { connecting: true }));
    await expect(rejection).rejects.toMatchObject({ category: 'status' });
    await vi.runAllTimersAsync();

    expect(request.destroy).not.toHaveBeenCalled();
  });

  it('uses category-only diagnostics and never logs payloads or response bodies', async () => {
    const requestSecret = 'request-body-secret';
    const responseSecret = 'response-body-secret';
    const { request, response } = makeResponse({ chunks: [responseSecret] });
    installRequest(request, response);

    await expect(relayJadePinRequest({
      operation: 'get_pin',
      data: { secret: requestSecret },
    })).rejects.toBeInstanceOf(JadePinRelayError);

    const serializedLogs = JSON.stringify(Object.values(logger).flatMap(mock => mock.mock.calls));
    expect(serializedLogs).not.toContain(requestSecret);
    expect(serializedLogs).not.toContain(responseSecret);
    expect(serializedLogs).not.toContain('https://j8d.io');
    expect(logger.warn).toHaveBeenCalledOnce();
    const diagnostic = logger.warn.mock.calls[0]?.[1];
    expect(Object.keys(diagnostic ?? {}).sort()).toEqual([
      'category',
      'correlationId',
      'durationMs',
      'operation',
    ]);
    expect(diagnostic?.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

function makePendingRequest(): FakeRequest {
  const request = new EventEmitter() as FakeRequest;
  request.end = vi.fn();
  request.destroy = vi.fn((error?: Error) => {
    if (error) queueMicrotask(() => request.emit('error', error));
  });
  return request;
}

function makeResponse(fixture: ResponseFixture): { request: FakeRequest; response: FakeResponse } {
  const response = new EventEmitter() as FakeResponse;
  response.complete = fixture.complete ?? true;
  response.headers = {
    'content-type': 'application/json',
    ...fixture.headers,
  };
  response.statusCode = fixture.status === null ? undefined : fixture.status ?? 200;
  response.destroy = vi.fn((error?: Error) => {
    if (error) queueMicrotask(() => response.emit('error', error));
  });

  const request = makePendingRequest();
  request.end = vi.fn(() => emitResponse(response, fixture.chunks ?? ['null']));
  return { request, response };
}

function emitResponse(response: FakeResponse, chunks: ReadonlyArray<string | Buffer>): void {
  queueMicrotask(() => {
    for (const chunk of chunks) response.emit('data', chunk);
    response.emit('end');
    response.emit('close');
  });
}

function installRequest(
  request: FakeRequest,
  response: FakeResponse,
  inspect?: (options: https.RequestOptions) => void,
) {
  return vi.spyOn(https, 'request').mockImplementationOnce(((
    options: string | URL | https.RequestOptions,
    optionsOrCallback?: https.RequestOptions | ((response: IncomingMessage) => void),
    callback?: (response: IncomingMessage) => void,
  ) => {
    if (typeof options !== 'object' || options instanceof URL) {
      throw new Error('Expected fixed RequestOptions');
    }
    inspect?.(options);
    const responseCallback = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    responseCallback?.(response as never);
    return request as never;
  }) as typeof https.request);
}
