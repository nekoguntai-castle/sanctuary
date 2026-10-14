import { describe, expect, it, vi } from 'vitest';
import {
  ElectrumFrameDecoder,
  ElectrumFrameTooLargeError,
  ElectrumMalformedFrameError,
  processResponse,
  readElectrumResponseId,
} from '../../../../src/services/bitcoin/electrum/protocol';
import { ElectrumRpcError } from '../../../../src/services/bitcoin/electrum/types';

describe('ElectrumFrameDecoder', () => {
  it('preserves ordered frames across byte fragmentation and UTF-8 boundaries', () => {
    const decoder = new ElectrumFrameDecoder(1024);
    const wire = Buffer.from([
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'café' }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, result: { ok: true } }),
      '',
    ].join('\n'));
    const responses: unknown[] = [];

    for (const byte of wire) {
      responses.push(...decoder.push(Buffer.from([byte])).map(frame => frame.response));
    }

    expect(responses).toEqual([
      { jsonrpc: '2.0', id: 1, result: 'café' },
      { jsonrpc: '2.0', id: 2, result: { ok: true } },
    ]);
  });

  it('accepts a fragmented frame at the exact byte limit', () => {
    const frame = Buffer.from(JSON.stringify({ id: 1, result: 'x'.repeat(200) }));
    const decoder = new ElectrumFrameDecoder(frame.length);

    expect(decoder.push(frame.subarray(0, 37))).toEqual([]);
    expect(decoder.push(Buffer.concat([frame.subarray(37), Buffer.from('\n')])).map(
      decoded => decoded.response,
    )).toEqual([
      { id: 1, result: 'x'.repeat(200) },
    ]);
  });

  it('keeps fragment metadata constant under near-limit byte fragmentation', () => {
    const frame = Buffer.from(JSON.stringify({ id: 1, result: 'x'.repeat(60_000) }));
    const decoder = new ElectrumFrameDecoder(frame.length);

    for (const byte of frame) decoder.push(Buffer.from([byte]));

    expect((decoder as any).frameBuffer).toBeInstanceOf(Buffer);
    expect((decoder as any).frameBuffer.length).toBe(frame.length);
    expect((decoder as any).bufferedBytes).toBe(frame.length);
    expect(decoder.push(Buffer.from('\n'))[0]).toMatchObject({
      response: { id: 1, result: 'x'.repeat(60_000) },
      frameBytes: frame.length,
    });
  });

  it('rejects an over-limit partial frame promptly and resets for recovery', () => {
    const decoder = new ElectrumFrameDecoder(16);

    expect(() => decoder.push(Buffer.alloc(17, 0x61))).toThrow(ElectrumFrameTooLargeError);
    expect(decoder.push(Buffer.from('{"id":1}\n'))[0]?.response).toEqual({ id: 1 });
  });

  it('applies a stricter per-operation frame limit without changing its default', () => {
    const decoder = new ElectrumFrameDecoder(64);

    expect(() => decoder.push(
      Buffer.from('{"id":1,"result":"xxxxxxxxxxxxxxxxx"}\n'),
      undefined,
      () => 16,
    )).toThrow('exceeded 16 bytes');
    expect(decoder.push(Buffer.from('{"id":2,"result":"recovered"}\n'))[0]?.response).toEqual({
      id: 2,
      result: 'recovered',
    });
  });

  it('reads only a top-level JSON-RPC id without materializing nested results', () => {
    expect(readElectrumResponseId(Buffer.from(
      '{"result":{"id":999},"meta":"id","id" : 42}',
    ))).toBe(42);
    expect(readElectrumResponseId(Buffer.from('{"method":"notice","id":null}'))).toBeNull();
    expect(readElectrumResponseId(Buffer.from('{"result":{"id":999}}'))).toBeUndefined();
    expect(readElectrumResponseId(Buffer.from(
      '{"result":"escaped \\\" id","id" \t\r\n: \t-42}',
    ))).toBe(-42);
    expect(readElectrumResponseId(Buffer.from('{"id":invalid}'))).toBeUndefined();
    expect(readElectrumResponseId(Buffer.from('{"id":-invalid}'))).toBeUndefined();
    expect(readElectrumResponseId(Buffer.from('{"id":nullx}'))).toBeUndefined();
    expect(readElectrumResponseId(Buffer.from('{"id":0}'))).toBe(0);
    expect(readElectrumResponseId(Buffer.from('{"id":01}'))).toBeUndefined();
    expect(readElectrumResponseId(Buffer.from('{"id":1.0}'))).toBeUndefined();
    expect(readElectrumResponseId(Buffer.from('{"id":1e2}'))).toBeUndefined();
    expect(readElectrumResponseId(Buffer.from('{"id":null,"id":42}'))).toBeUndefined();
    expect(readElectrumResponseId(Buffer.from(
      '{"id":null,"\\u0069d":42}',
    ))).toBeUndefined();
    expect(readElectrumResponseId(Buffer.from('{"\\u0069'))).toBeUndefined();
    expect(readElectrumResponseId(Buffer.from('{"unterminated'))).toBeUndefined();
    expect(readElectrumResponseId(Buffer.from('{"id":9007199254740992}'))).toBeUndefined();
  });

  it('rejects malformed complete frames and resets for recovery', () => {
    const decoder = new ElectrumFrameDecoder(64);

    expect(() => decoder.push(Buffer.from('not-json\n'))).toThrow(ElectrumMalformedFrameError);
    expect(decoder.push(Buffer.from('{"id":2}\n'))[0]?.response).toEqual({ id: 2 });
  });
});

describe('processResponse', () => {
  const pendingFor = (id: number) => {
    const request = { resolve: vi.fn(), reject: vi.fn(), timeoutId: setTimeout(() => undefined, 0) };
    return { request, pending: new Map([[id, request]]) };
  };

  it('rejects a JSON-RPC error answer with a typed ElectrumRpcError carrying the code', () => {
    const { request, pending } = pendingFor(1);
    processResponse({ jsonrpc: '2.0', id: 1, error: { code: -26, message: 'min relay fee not met' } }, pending);
    const error = request.reject.mock.calls[0][0] as ElectrumRpcError;
    expect(error).toBeInstanceOf(ElectrumRpcError);
    expect(error.message).toBe('min relay fee not met');
    expect(error.code).toBe(-26);
    expect(request.resolve).not.toHaveBeenCalled();
  });

  it('falls back to the serialized error when the server sends no message', () => {
    const { request, pending } = pendingFor(2);
    processResponse({ jsonrpc: '2.0', id: 2, error: { code: 1, message: '' } }, pending);
    expect(request.reject.mock.calls[0][0]).toBeInstanceOf(ElectrumRpcError);
    expect(request.reject.mock.calls[0][0].message).toBe('{"code":1,"message":""}');
  });

  it('resolves a result answer', () => {
    const { request, pending } = pendingFor(3);
    processResponse({ jsonrpc: '2.0', id: 3, result: 'ok' }, pending);
    expect(request.resolve).toHaveBeenCalledWith('ok');
  });
});
