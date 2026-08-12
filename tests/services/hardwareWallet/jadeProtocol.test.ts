import { decode, encode } from 'cbor-x';
import { describe, expect, it, vi } from 'vitest';
import {
  JADE_PROTOCOL_LIMITS,
  JadeFrameDecoder,
  JadeProtocolSession,
  validateAuthContinuation,
} from '../../../src/services/hardwareWallet/adapters/jadeProtocol';

type Request = { id: string; method: string; params?: unknown };
type Emit = (value: unknown, transform?: (bytes: Uint8Array) => Uint8Array[]) => void;

const concat = (...chunks: Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};

const splitAt = (offset: number) => (bytes: Uint8Array): Uint8Array[] => [
  bytes.slice(0, offset), bytes.slice(offset),
];

function response(request: Request, result: unknown, extra: Record<string, unknown> = {}) {
  return { id: request.id, result, ...extra };
}

function authContinuation(overrides: Record<string, unknown> = {}) {
  return {
    http_request: {
      params: {
        urls: ['https://j8d.io/get_pin', 'http://exampleabcdef.onion/get_pin'],
        method: 'POST',
        accept: 'json',
        data: { key: 'value' },
      },
      'on-reply': 'pin',
      ...overrides,
    },
  };
}

function scriptedSession(
  handler: (request: Request, emit: Emit, call: number) => void | Promise<void>,
  timeoutMs = 250,
  interactiveTimeoutMs = timeoutMs,
) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let call = 0;
  const requests: Request[] = [];
  const requestBytes: Uint8Array[] = [];
  const readable = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
  });
  const emit: Emit = (value, transform) => {
    const bytes = Uint8Array.from(encode(value));
    for (const chunk of transform ? transform(bytes) : [bytes]) controller.enqueue(chunk);
  };
  const writable = new WritableStream<Uint8Array>({
    async write(bytes) {
      requestBytes.push(Uint8Array.from(bytes));
      const request = decode(bytes) as Request;
      requests.push(request);
      await handler(request, emit, ++call);
    },
  });
  const invalidate = vi.fn(async () => {
    try { controller.close(); } catch { /* already closed */ }
  });
  const session = new JadeProtocolSession({
    reader: readable.getReader(),
    writer: writable.getWriter(),
    invalidate,
    rpcIdPrefix: '0000000000',
  }, { rpcTimeoutMs: timeoutMs, interactiveRpcTimeoutMs: interactiveTimeoutMs });
  return { session, invalidate, requests, requestBytes, controller };
}

describe('Jade CBOR framing', () => {
  it('preserves a trailing incomplete frame across fragmented reads', () => {
    const decoder = new JadeFrameDecoder();
    const first = Uint8Array.from(encode({ id: 'one', result: true }));
    const second = Uint8Array.from(encode({ id: 'two', result: false }));
    const halfway = Math.floor(second.length / 2);
    expect(decoder.push(concat(first, second.slice(0, halfway)))).toEqual([{ id: 'one', result: true }]);
    expect(decoder.push(second.slice(halfway))).toEqual([{ id: 'two', result: false }]);
  });

  it('decodes coalesced complete frames without losing their boundary', () => {
    const decoder = new JadeFrameDecoder();
    expect(decoder.push(concat(
      Uint8Array.from(encode({ id: 'one', result: 1 })),
      Uint8Array.from(encode({ id: 'two', result: 2 })),
    ))).toEqual([{ id: 'one', result: 1 }, { id: 'two', result: 2 }]);
  });

  it('accepts an exact-size frame and rejects one byte over the frame limit', () => {
    const exactPayload = new Uint8Array(JADE_PROTOCOL_LIMITS.maxFrameBytes - 7);
    expect(Uint8Array.from(encode(exactPayload))).toHaveLength(JADE_PROTOCOL_LIMITS.maxFrameBytes);
    expect(new JadeFrameDecoder().push(Uint8Array.from(encode(exactPayload)))[0]).toEqual(exactPayload);
    const oversizedPayload = new Uint8Array(JADE_PROTOCOL_LIMITS.maxFrameBytes - 6);
    expect(() => new JadeFrameDecoder().push(Uint8Array.from(encode(oversizedPayload)))).toThrow();
    const decoder = new JadeFrameDecoder() as unknown as {
      assertFrameLimits: (values: unknown[]) => void;
    };
    expect(() => decoder.assertFrameLimits([
      new Uint8Array(JADE_PROTOCOL_LIMITS.maxFrameBytes),
    ])).toThrow('frame limit');
  }, 15_000);

  it('rejects malformed CBOR and an incomplete frame growing past the limit', () => {
    expect(() => new JadeFrameDecoder().push(Uint8Array.of(0x1c))).toThrow('malformed CBOR');
    const incomplete = new Uint8Array(JADE_PROTOCOL_LIMITS.maxFrameBytes + 1);
    incomplete.set([0x5a, 0x00, 0x20, 0x00, 0x00]);
    expect(() => new JadeFrameDecoder().push(incomplete)).toThrow('frame limit');
  });

  it('rejects non-binary, aggregate-buffer overflow, and invalid decoder positions', () => {
    expect(() => new JadeFrameDecoder().push('not bytes' as never)).toThrow('non-binary');
    expect(() => new JadeFrameDecoder().push(
      new Uint8Array(JADE_PROTOCOL_LIMITS.maxBufferedBytes + 1),
    )).toThrow('buffer limit');
    const decoder = new JadeFrameDecoder() as unknown as {
      preserveIncomplete: (error: Error & { incomplete: boolean; lastPosition: number }, bytes: Uint8Array) => unknown[];
    };
    expect(() => decoder.preserveIncomplete(
      Object.assign(new Error('bad'), { incomplete: true, lastPosition: 2 }),
      Uint8Array.of(1),
    )).toThrow('position is invalid');
    expect(decoder.preserveIncomplete(
      Object.assign(new Error('incomplete'), { incomplete: true }) as never,
      new Uint8Array(0),
    )).toEqual([]);
  });
});

describe('Jade RPC session safety', () => {
  it('handles response fragmentation and uses firmware-compatible monotonic numeric IDs', async () => {
    const transport = scriptedSession((request, emit) => {
      emit(response(request, request.method), splitAt(2));
    });
    await expect(transport.session.rpc('first')).resolves.toMatchObject({ result: 'first' });
    await expect(transport.session.rpc('second')).resolves.toMatchObject({ result: 'second' });
    expect(transport.requests.map(item => item.id)).toEqual(['0000000000:1', '0000000000:2']);
    expect(transport.invalidate).not.toHaveBeenCalled();
  });

  it('generates a firmware-bounded random session prefix and rejects invalid injected prefixes', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const readable = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    let requestId = '';
    const writable = new WritableStream<Uint8Array>({
      write(bytes) {
        const request = decode(bytes) as Request;
        requestId = request.id;
        controller.enqueue(Uint8Array.from(encode(response(request, true))));
      },
    });
    const session = new JadeProtocolSession({
      reader: readable.getReader(),
      writer: writable.getWriter(),
      invalidate: vi.fn(),
    });
    await session.rpc('ping');
    expect(requestId).toMatch(/^[0-9a-f]{10}:1$/);
    expect(requestId.length).toBeLessThan(16);

    expect(() => new JadeProtocolSession({
      reader: new ReadableStream<Uint8Array>().getReader(),
      writer: new WritableStream<Uint8Array>().getWriter(),
      invalidate: vi.fn(),
      rpcIdPrefix: 'too-long-or-invalid',
    })).toThrow('Invalid Jade RPC ID prefix');
  });

  it('fails closed before a bounded RPC ID can be reused or exceed firmware limits', async () => {
    const transport = scriptedSession((request, emit) => emit(response(request, true)));
    (transport.session as unknown as { nextId: number }).nextId = 9_999;

    await expect(transport.session.rpc('overflow')).rejects.toThrow('sequence exhausted');
    expect(transport.requests).toEqual([]);
    expect(transport.invalidate).toHaveBeenCalledOnce();
  });

  it('rejects coalesced unsolicited responses and invalidates once', async () => {
    const transport = scriptedSession((request, _emit, _call) => {
      const first = Uint8Array.from(encode(response(request, true)));
      const second = Uint8Array.from(encode({ id: 'unsolicited', result: true }));
      transport.controller.enqueue(concat(first, second));
    });
    await expect(transport.session.rpc('ping')).rejects.toThrow('coalesced');
    expect(transport.invalidate).toHaveBeenCalledOnce();
  });

  it('rejects an expected response followed by a partial unsolicited frame', async () => {
    const transport = scriptedSession((request) => {
      const expected = Uint8Array.from(encode(response(request, true)));
      const unsolicited = Uint8Array.from(encode({ id: 'unsolicited', result: true }));
      transport.controller.enqueue(concat(expected, unsolicited.slice(0, 2)));
    });
    await expect(transport.session.rpc('ping')).rejects.toThrow('coalesced');
    expect(transport.invalidate).toHaveBeenCalledOnce();
  });

  it('rejects stale and duplicate IDs as session-fatal', async () => {
    const stale = scriptedSession((_request, emit) => emit({ id: 'ffffffffee:1', result: true }));
    await expect(stale.session.rpc('ping')).rejects.toThrow('stale or unsolicited');
    expect(stale.invalidate).toHaveBeenCalledOnce();

    let firstId = '';
    const duplicate = scriptedSession((request, emit, call) => {
      if (call === 1) firstId = request.id;
      emit({ id: call === 1 ? request.id : firstId, result: true });
    });
    await duplicate.session.rpc('one');
    await expect(duplicate.session.rpc('two')).rejects.toThrow('duplicate');
    expect(duplicate.invalidate).toHaveBeenCalledOnce();
  });

  it.each([
    null,
    true,
    { id: '', result: true },
    { id: '0000000000:1', result: true, extra: true },
    { id: '0000000000:1', result: true, error: { code: 1, message: 'both' } },
    { id: '0000000000:1' },
    { id: '0000000000:1', error: { code: 1, message: 'bad', extra: true } },
    { id: '0000000000:1', error: 'bad' },
    { id: '0000000000:1', error: { code: 1.5, message: 'bad' } },
    { id: '0000000000:1', error: { code: 1, message: 2 } },
    { id: '0000000000:1', result: true, seqnum: 1 },
    { id: '0000000000:1', result: true, seqnum: 2, seqlen: 1 },
  ])('rejects malformed response schema %#', async (malformed) => {
    const transport = scriptedSession((_request, emit) => emit(malformed));
    await expect(transport.session.rpc('ping')).rejects.toThrow();
    expect(transport.invalidate).toHaveBeenCalledOnce();
  });

  it('makes device errors, writer failures, closed streams, and malformed CBOR fatal', async () => {
    const device = scriptedSession(request => {
      device.controller.enqueue(Uint8Array.from(encode({
        id: request.id, error: { code: -1, message: 'denied' },
      })));
    });
    await expect(device.session.rpc('ping')).rejects.toThrow('Jade error (-1): denied');
    expect(device.invalidate).toHaveBeenCalledOnce();

    const writer = scriptedSession(() => { throw new Error('write failed'); });
    await expect(writer.session.rpc('ping')).rejects.toThrow('write failed');
    expect(writer.invalidate).toHaveBeenCalledOnce();

    const closed = scriptedSession(() => closed.controller.close());
    await expect(closed.session.rpc('ping')).rejects.toThrow('closed unexpectedly');
    expect(closed.invalidate).toHaveBeenCalledOnce();

    const malformed = scriptedSession(() => malformed.controller.enqueue(Uint8Array.of(0x1c)));
    await expect(malformed.session.rpc('ping')).rejects.toThrow('malformed CBOR');
    expect(malformed.invalidate).toHaveBeenCalledOnce();
  });

  it('uses an absolute real-time deadline, clears its timer, and invalidates on timeout', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const transport = scriptedSession(() => undefined, 10);
    const started = Date.now();
    await expect(transport.session.rpc('wait')).rejects.toThrow('Timeout waiting for Jade response');
    expect(Date.now() - started).toBeLessThan(500);
    expect(clearSpy).toHaveBeenCalled();
    expect(transport.invalidate).toHaveBeenCalledOnce();
    clearSpy.mockRestore();
  });

  it('rejects invalid methods and oversized requests before transport use', async () => {
    const invalidMethod = scriptedSession(() => undefined);
    await expect(invalidMethod.session.rpc('')).rejects.toThrow('Invalid Jade RPC method');
    expect(invalidMethod.requests).toHaveLength(0);
    expect(invalidMethod.invalidate).toHaveBeenCalledOnce();

    const oversized = scriptedSession(() => undefined);
    await expect(oversized.session.rpc('huge', {
      bytes: new Uint8Array(JADE_PROTOCOL_LIMITS.maxFrameBytes),
    })).rejects.toThrow('request exceeds the frame limit');
    expect(oversized.requests).toHaveLength(0);
    expect(oversized.invalidate).toHaveBeenCalledOnce();
  });

  it('handles empty reads against the same deadline and preserves failures when invalidation rejects', async () => {
    const emptyThenReply = scriptedSession((request) => {
      emptyThenReply.controller.enqueue(new Uint8Array(0));
      emptyThenReply.controller.enqueue(Uint8Array.from(encode(response(request, true))));
    });
    await expect(emptyThenReply.session.rpc('ping')).resolves.toMatchObject({ result: true });

    const noTime = scriptedSession(() => undefined, 0);
    await expect(noTime.session.rpc('ping')).rejects.toThrow('Timeout waiting for Jade response');

    const failing = scriptedSession(() => { throw new Error('original failure'); });
    failing.invalidate.mockRejectedValueOnce(new Error('invalidation failure'));
    await expect(failing.session.rpc('ping')).rejects.toThrow('original failure');
  });

  it('invalidates concurrent use and prevents later reuse', async () => {
    const transport = scriptedSession(() => undefined, 100);
    const first = transport.session.rpc('one');
    await expect(transport.session.rpc('two')).rejects.toThrow('Concurrent');
    await expect(first).rejects.toThrow();
    await expect(transport.session.rpc('three')).rejects.toThrow('no longer valid');
    expect(transport.invalidate).toHaveBeenCalledOnce();
  });
});

describe('Jade PIN authentication relay', () => {
  it.each([
    ['https://j8d.io/get_pin', 'get_pin'],
    ['https://j8d.io/set_pin', 'set_pin'],
  ] as const)('accepts the exact official %s continuation', (url, operation) => {
    const value = authContinuation();
    value.http_request.params.urls[0] = url;
    expect(validateAuthContinuation(value)).toEqual({ operation, data: { key: 'value' } });
  });

  it.each([
    authContinuation({ unexpected: true }),
    authContinuation({ 'on-reply': 'other' }),
    authContinuation({ params: { urls: ['https://j8d.io/get_pin'], method: 'GET', accept: 'json', data: {} } }),
    authContinuation({ params: { urls: ['https://j8d.io/get_pin'], method: 'POST', accept: 'text', data: {} } }),
    authContinuation({ params: { urls: ['https://evil.example/get_pin'], method: 'POST', accept: 'json', data: {} } }),
    authContinuation({ params: { urls: ['https://j8d.io/get_pin', 'https://evil.example'], method: 'POST', accept: 'json', data: {} } }),
    authContinuation({ params: { urls: ['https://j8d.io/get_pin', 'https://j8d.io/set_pin'], method: 'POST', accept: 'json', data: {} } }),
    authContinuation({ params: { urls: ['https://j8d.io/get_pin'], method: 'POST', accept: 'json', data: {}, extra: true } }),
  ])('rejects unsupported or non-exact continuations %#', (value) => {
    expect(() => validateAuthContinuation(value)).toThrow();
  });

  it('runs a bounded multi-message relay loop and sends relay JSON as exact pin params', async () => {
    const relay = vi.fn()
      .mockResolvedValueOnce({ step: 1 })
      .mockResolvedValueOnce({ step: 2 });
    const transport = scriptedSession((request, emit, call) => {
      if (call <= 2) emit(response(request, authContinuation()));
      else emit(response(request, true));
    });
    await expect(transport.session.authenticate('testnet', relay, 123)).resolves.toBeUndefined();
    expect(relay).toHaveBeenCalledTimes(2);
    expect(relay).toHaveBeenCalledWith({ operation: 'get_pin', data: { key: 'value' } });
    expect(transport.requests).toEqual([
      { id: '0000000000:1', method: 'auth_user', params: { network: 'testnet', epoch: 123 } },
      { id: '0000000000:2', method: 'pin', params: { step: 1 } },
      { id: '0000000000:3', method: 'pin', params: { step: 2 } },
    ]);
    expect(transport.invalidate).not.toHaveBeenCalled();
  });

  it('invalidates malformed continuations, relay failures, invalid relay JSON, and false completion', async () => {
    const malformed = scriptedSession((request, emit) => emit(response(request, { wrong: true })));
    await expect(malformed.session.authenticate('mainnet', vi.fn(), 1)).rejects.toThrow('malformed');
    expect(malformed.invalidate).toHaveBeenCalledOnce();

    const rejected = scriptedSession((request, emit) => emit(response(request, authContinuation())));
    await expect(rejected.session.authenticate('mainnet', async () => { throw new Error('relay down'); }, 1))
      .rejects.toThrow('relay down');
    expect(rejected.invalidate).toHaveBeenCalledOnce();

    const invalidJson = scriptedSession((request, emit) => emit(response(request, authContinuation())));
    await expect(invalidJson.session.authenticate('mainnet', async () => Number.NaN, 1)).rejects.toThrow('bounded JSON');
    expect(invalidJson.invalidate).toHaveBeenCalledOnce();

    const exhausted = scriptedSession((request, emit) => emit(response(request, authContinuation())));
    await expect(exhausted.session.authenticate('mainnet', async () => ({}), 1)).rejects.toThrow('continuation limit');
    expect(exhausted.requests).toHaveLength(JADE_PROTOCOL_LIMITS.maxExtendedDataChunks + 1);
    expect(exhausted.invalidate).toHaveBeenCalledOnce();
  });

  it('enforces the exact 16 KiB JSON bound and rejects cyclic relay bodies', () => {
    const base = authContinuation();
    const params = base.http_request.params as { data: Record<string, string> };
    const exactOverhead = new TextEncoder().encode(JSON.stringify({ value: '' })).length;
    params.data = {
      value: 'x'.repeat(JADE_PROTOCOL_LIMITS.maxOracleBodyBytes - exactOverhead),
    };
    expect(() => validateAuthContinuation(base)).not.toThrow();
    params.data.value += 'x';
    expect(() => validateAuthContinuation(base)).toThrow('bounded JSON');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    params.data = cyclic as Record<string, string>;
    expect(() => validateAuthContinuation(base)).toThrow('bounded JSON');
  });

  it.each([
    undefined,
    () => true,
    Number.POSITIVE_INFINITY,
    new Date(),
    Object.assign(Object.create(null) as Record<string, unknown>, { valid: true }),
    [null, true, 1, 'value', { nested: [] }],
  ])('validates JSON-compatible PIN data %#', (data) => {
    const value = authContinuation();
    value.http_request.params.data = data as never;
    const isValid = data !== undefined && typeof data !== 'function'
      && data !== Number.POSITIVE_INFINITY && !(data instanceof Date);
    if (isValid) expect(() => validateAuthContinuation(value)).not.toThrow();
    else expect(() => validateAuthContinuation(value)).toThrow('bounded JSON');
  });

  it('rejects sparse arrays, symbol keys, non-string and malformed oracle URLs', () => {
    const value = authContinuation();
    const sparse = new Array(2);
    sparse[1] = true;
    value.http_request.params.data = sparse as never;
    expect(() => validateAuthContinuation(value)).toThrow('bounded JSON');
    const symbolic: Record<string, unknown> = {};
    Object.defineProperty(symbolic, Symbol('hidden'), { value: true, enumerable: true });
    value.http_request.params.data = symbolic as never;
    expect(() => validateAuthContinuation(value)).toThrow('bounded JSON');
    for (const url of [123, 'not a URL', 'ftp://exampleabcdef.onion/get_pin', 'http://u:p@exampleabcdef.onion']) {
      value.http_request.params.data = {} as never;
      value.http_request.params.urls = ['https://j8d.io/get_pin', url as string];
      expect(() => validateAuthContinuation(value)).toThrow('destination');
    }
  });

  it('allows success after exactly 256 continuations', async () => {
    const transport = scriptedSession((request, emit, call) => {
      emit(response(request, call <= JADE_PROTOCOL_LIMITS.maxExtendedDataChunks
        ? authContinuation()
        : true));
    });
    await expect(transport.session.authenticate('mainnet', async () => ({}), 1)).resolves.toBeUndefined();
    expect(transport.requests).toHaveLength(JADE_PROTOCOL_LIMITS.maxExtendedDataChunks + 1);
  });
});

describe('Jade signed PSBT chunking', () => {
  it('allows interactive signing to exceed the normal RPC timeout', async () => {
    vi.useFakeTimers();
    try {
      const transport = scriptedSession(() => undefined, 25, 100);
      let settled = false;
      const outcome = transport.session.signPsbt('mainnet', Uint8Array.of(1)).then(
        () => ({ error: undefined }),
        (error: unknown) => ({ error }),
      ).finally(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(26);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(74);
      const { error } = await outcome;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('Timeout waiting for Jade response');
      expect(transport.invalidate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends a binary PSBT and returns a single binary response exactly', async () => {
    const signed = Uint8Array.of(9, 8, 7);
    const transport = scriptedSession((request, emit) => emit(response(request, signed)));
    await expect(transport.session.signPsbt('mainnet', Uint8Array.of(1, 2, 3))).resolves.toEqual(signed);
    expect(transport.requests[0]).toMatchObject({
      id: '0000000000:1', method: 'sign_psbt',
      params: { network: 'mainnet' },
    });
    const decodedParams = transport.requests[0].params as { psbt: Uint8Array };
    expect(Array.from(decodedParams.psbt)).toEqual([1, 2, 3]);
    const encodedRequest = Buffer.from(transport.requestBytes[0]).toString('hex');
    expect(encodedRequest).toContain('43010203');
    expect(encodedRequest).not.toContain('d84043010203');
  });

  it('requests and reassembles exact orig/origid/seqnum/seqlen chunks', async () => {
    const chunks = [Uint8Array.of(1, 2), Uint8Array.of(3), Uint8Array.of(4, 5)];
    const transport = scriptedSession((request, emit, call) => {
      emit(response(request, chunks[call - 1], { seqnum: call, seqlen: 3 }));
    });
    await expect(transport.session.signPsbt('testnet', Uint8Array.of(0xaa)))
      .resolves.toEqual(Uint8Array.of(1, 2, 3, 4, 5));
    expect(transport.requests.slice(1).map(item => item.params)).toEqual([
      { orig: 'sign_psbt', origid: '0000000000:1', seqnum: 2, seqlen: 3 },
      { orig: 'sign_psbt', origid: '0000000000:1', seqnum: 3, seqlen: 3 },
    ]);
  });

  it.each([
    { result: 'not binary' },
    { result: new Uint8Array(0) },
    { result: Uint8Array.of(1), seqnum: 2, seqlen: 2 },
    { result: Uint8Array.of(1), seqnum: 1, seqlen: JADE_PROTOCOL_LIMITS.maxExtendedDataChunks + 1 },
  ])('invalidates invalid initial chunk data %#', async (chunk) => {
    const transport = scriptedSession((request, emit) => emit(response(request, chunk.result, chunk)));
    await expect(transport.session.signPsbt('mainnet', Uint8Array.of(1))).rejects.toThrow();
    expect(transport.invalidate).toHaveBeenCalledOnce();
  });

  it('invalidates invalid networks, epochs, and PSBT inputs', async () => {
    const network = scriptedSession(() => undefined);
    await expect(network.session.signPsbt('regtest' as never, Uint8Array.of(1))).rejects.toThrow('network');
    expect(network.invalidate).toHaveBeenCalledOnce();
    const empty = scriptedSession(() => undefined);
    await expect(empty.session.signPsbt('mainnet', new Uint8Array(0))).rejects.toThrow('Invalid Jade PSBT');
    expect(empty.invalidate).toHaveBeenCalledOnce();
    const epoch = scriptedSession(() => undefined);
    await expect(epoch.session.authenticate('mainnet', vi.fn(), -1)).rejects.toThrow('epoch');
    expect(epoch.invalidate).toHaveBeenCalledOnce();
  });

  it('invalidates reordered continuation chunks and aggregate overflow', async () => {
    const reordered = scriptedSession((request, emit, call) => {
      emit(response(request, Uint8Array.of(call), {
        seqnum: call === 1 ? 1 : 2,
        seqlen: call === 1 ? 3 : 2,
      }));
    });
    await expect(reordered.session.signPsbt('mainnet', Uint8Array.of(1))).rejects.toThrow('reordered');
    expect(reordered.invalidate).toHaveBeenCalledOnce();

    const chunk = new Uint8Array(700_000);
    const overflow = scriptedSession((request, emit, call) => {
      emit(response(request, chunk, { seqnum: call, seqlen: 4 }));
    }, 2_000);
    await expect(overflow.session.signPsbt('mainnet', Uint8Array.of(1))).rejects.toThrow('aggregate byte limit');
    expect(overflow.invalidate).toHaveBeenCalledOnce();
  });
});
