/**
 * Bounded Jade CBOR-RPC session.
 *
 * Every response must match the one in-flight randomized ID; duplicates,
 * unsolicited/coalesced frames, malformed chunks, limits, and timeouts
 * invalidate the complete session. Authentication selects only the official
 * clearnet PIN endpoints; vendor-advertised onion alternatives may accompany
 * them but are never selected or forwarded by the same-origin relay.
 */
import { Decoder, Encoder } from 'cbor-x';
export const JADE_PROTOCOL_LIMITS = Object.freeze({
  maxFrameBytes: 1_048_576,
  maxBufferedBytes: 2_097_152,
  maxExtendedDataChunks: 256,
  rpcTimeoutMs: 60_000,
  interactiveRpcTimeoutMs: 300_000,
  maxOracleBodyBytes: 16_384,
});
export type JadeNetwork = 'mainnet' | 'testnet';
export type JadePinOperation = 'get_pin' | 'set_pin';
export type JsonValue = null | boolean | number | string | JsonValue[] | {
  [key: string]: JsonValue;
};
interface JadeRpcError {
  code: number;
  message: string;
  data?: unknown;
}
export interface JadeRpcResponse {
  id: string;
  result?: unknown;
  error?: JadeRpcError;
  seqnum?: number;
  seqlen?: number;
}
export interface JadePinRelayRequest {
  operation: JadePinOperation;
  data: JsonValue;
}
export type JadePinRelay = (request: JadePinRelayRequest) => Promise<JsonValue>;
interface JadeProtocolTransport {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  invalidate: () => void | Promise<void>;
  rpcIdPrefix?: string;
}
export interface JadeProtocolTimeouts {
  rpcTimeoutMs: number;
  interactiveRpcTimeoutMs: number;
}
interface IncompleteCborError extends Error {
  incomplete?: boolean;
  lastPosition?: number;
  values?: unknown[];
}
const RESPONSE_KEYS = new Set(['id', 'result', 'error', 'seqnum', 'seqlen']);
const ERROR_KEYS = new Set(['code', 'message', 'data']);
const OFFICIAL_PIN_URLS = new Map<string, JadePinOperation>([
  ['https://j8d.io/get_pin', 'get_pin'],
  ['https://j8d.io/set_pin', 'set_pin'],
]);
const textEncoder = new TextEncoder();
const cborEncoder = new Encoder({ useRecords: false, tagUint8Array: false });
const MAX_RPC_SEQUENCE = 9_999;
const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const hasOwn = (value: object, key: PropertyKey): boolean => (
  Object.prototype.hasOwnProperty.call(value, key)
);

function assertExactKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  if (Object.keys(value).some(key => !allowed.has(key))) {
    throw new Error(`${label} contains unsupported fields`);
  }
}
const validatedJsonNode = (value: unknown, ancestors: Set<object>): JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JSON numbers must be finite');
    return value;
  }
  if (typeof value !== 'object') throw new Error('Unsupported JSON value');
  if (ancestors.has(value)) throw new Error('Cyclic JSON value');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        if (!hasOwn(value, index)) throw new Error('Sparse JSON arrays are unsupported');
        validatedJsonNode(value[index], ancestors);
      }
      return value as JsonValue[];
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error('Non-plain JSON object');
    if (Object.getOwnPropertySymbols(value).length > 0) throw new Error('Symbol JSON keys are unsupported');
    for (const entry of Object.values(value)) validatedJsonNode(entry, ancestors);
    return value as { [key: string]: JsonValue };
  } finally {
    ancestors.delete(value);
  }
};
function validatedJsonValue(value: unknown, label: string): JsonValue {
  try {
    const validated = validatedJsonNode(value, new Set());
    const serialized = JSON.stringify(validated);
    if (textEncoder.encode(serialized).length > JADE_PROTOCOL_LIMITS.maxOracleBodyBytes) {
      throw new Error('byte limit exceeded');
    }
    return validated;
  } catch {
    throw new Error(`${label} is not bounded JSON`);
  }
}
function validatedRpcError(value: unknown): JadeRpcError {
  if (!isRecord(value)) throw new Error('Jade returned a malformed RPC error');
  assertExactKeys(value, ERROR_KEYS, 'Jade RPC error');
  if (!Number.isInteger(value.code) || typeof value.message !== 'string') {
    throw new Error('Jade returned a malformed RPC error');
  }
  return value as unknown as JadeRpcError;
}

function validatedRpcResponse(value: unknown): JadeRpcResponse {
  if (!isRecord(value)) throw new Error('Jade returned a malformed RPC response');
  assertExactKeys(value, RESPONSE_KEYS, 'Jade RPC response');
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error('Jade returned a malformed RPC response ID');
  }
  const hasResult = hasOwn(value, 'result');
  const hasError = hasOwn(value, 'error');
  if (hasResult === hasError) throw new Error('Jade RPC response must contain exactly one result or error');
  if (hasError) validatedRpcError(value.error);
  const hasSequence = hasOwn(value, 'seqnum');
  const hasLength = hasOwn(value, 'seqlen');
  if (hasSequence !== hasLength) throw new Error('Jade returned incomplete extended-data metadata');
  if (!hasSequence) return value as unknown as JadeRpcResponse;
  if (!Number.isInteger(value.seqnum) || !Number.isInteger(value.seqlen)
    || Number(value.seqnum) < 1 || Number(value.seqlen) < Number(value.seqnum)) {
    throw new Error('Jade returned invalid extended-data metadata');
  }
  return value as unknown as JadeRpcResponse;
}

export class JadeFrameDecoder {
  private readonly decoder = new Decoder({ mapsAsObjects: true });
  private buffered = new Uint8Array(0);

  push(chunk: Uint8Array): unknown[] {
    if (!(chunk instanceof Uint8Array)) throw new Error('Jade serial transport returned non-binary data');
    if (this.buffered.length + chunk.length > JADE_PROTOCOL_LIMITS.maxBufferedBytes) {
      throw new Error('Jade CBOR buffer limit exceeded');
    }
    const combined = new Uint8Array(this.buffered.length + chunk.length);
    combined.set(this.buffered);
    combined.set(chunk, this.buffered.length);
    try {
      const values = this.decoder.decodeMultiple(combined) as unknown[];
      this.buffered = new Uint8Array(0);
      this.assertSingleRawFrameLimit(values, combined.length);
      this.assertFrameLimits(values);
      return values;
    } catch (error) {
      return this.preserveIncomplete(error as IncompleteCborError, combined);
    }
  }

  reset(): void {
    this.buffered = new Uint8Array(0);
  }
  hasPendingFrame(): boolean {
    return this.buffered.length > 0;
  }
  private preserveIncomplete(error: IncompleteCborError, combined: Uint8Array): unknown[] {
    if (!error.incomplete) throw new Error('Jade returned malformed CBOR data');
    const values = error.values ?? [];
    const consumed = error.lastPosition ?? 0;
    if (!Number.isInteger(consumed) || consumed < 0 || consumed > combined.length) {
      throw new Error('Jade CBOR decoder position is invalid');
    }
    this.buffered = combined.slice(consumed);
    this.assertSingleRawFrameLimit(values, consumed);
    this.assertFrameLimits(values);
    if (this.buffered.length > JADE_PROTOCOL_LIMITS.maxFrameBytes) {
      throw new Error('Jade CBOR frame limit exceeded');
    }
    return values;
  }

  private assertFrameLimits(values: unknown[]): void {
    for (const value of values) {
      if (cborEncoder.encode(value).length > JADE_PROTOCOL_LIMITS.maxFrameBytes) {
        throw new Error('Jade CBOR frame limit exceeded');
      }
    }
  }

  private assertSingleRawFrameLimit(values: unknown[], encodedBytes: number): void {
    if (values.length === 1 && encodedBytes > JADE_PROTOCOL_LIMITS.maxFrameBytes) {
      throw new Error('Jade CBOR frame limit exceeded');
    }
  }
}

export class JadeProtocolSession {
  private readonly decoder = new JadeFrameDecoder();
  private readonly completedIds = new Set<string>();
  private readonly rpcIdPrefix: string;
  private nextId = 0;
  private invalid = false;
  private inFlight = false;

  constructor(
    private readonly transport: JadeProtocolTransport,
    private readonly timeouts: JadeProtocolTimeouts = JADE_PROTOCOL_LIMITS,
  ) {
    this.rpcIdPrefix = transport.rpcIdPrefix ?? randomRpcIdPrefix();
    if (!/^[0-9a-f]{10}$/.test(this.rpcIdPrefix)) {
      throw new Error('Invalid Jade RPC ID prefix');
    }
  }

  async rpc(method: string, params?: unknown, interactive = false): Promise<JadeRpcResponse> {
    if (this.invalid) throw new Error('Jade session is no longer valid');
    if (this.inFlight) return this.fail(new Error('Concurrent Jade RPC requests are unsupported'));
    if (typeof method !== 'string' || method.length === 0) return this.fail(new Error('Invalid Jade RPC method'));
    this.inFlight = true;
    if (this.nextId >= MAX_RPC_SEQUENCE) {
      return this.fail(new Error('Jade RPC ID sequence exhausted'));
    }
    const id = `${this.rpcIdPrefix}:${++this.nextId}`;
    try {
      const request = params === undefined ? { id, method } : { id, method, params };
      const bytes = cborEncoder.encode(request);
      if (bytes.length > JADE_PROTOCOL_LIMITS.maxFrameBytes) {
        throw new Error('Jade request exceeds the frame limit');
      }
      await this.transport.writer.write(Uint8Array.from(bytes));
      const timeoutMs = interactive ? this.timeouts.interactiveRpcTimeoutMs : this.timeouts.rpcTimeoutMs;
      const response = await this.readCorrelated(id, timeoutMs);
      if (response.error) throw new Error(`Jade error (${response.error.code}): ${response.error.message}`);
      return response;
    } catch (error) {
      await this.invalidateSafely();
      throw error;
    } finally {
      this.inFlight = false;
    }
  }

  async authenticate(network: JadeNetwork, relay: JadePinRelay, epoch: number): Promise<void> {
    return this.runFatal(async () => {
      assertNetwork(network);
      if (!Number.isSafeInteger(epoch) || epoch < 0) throw new Error('Invalid Jade authentication epoch');
      let response = await this.rpc('auth_user', { network, epoch }, true);
      for (let count = 0; count < JADE_PROTOCOL_LIMITS.maxExtendedDataChunks; count++) {
        if (response.result === true) return;
        const reply = await relay(validateAuthContinuation(response.result));
        response = await this.rpc('pin', validatedJsonValue(reply, 'Jade PIN relay response'), true);
      }
      if (response.result === true) return;
      throw new Error('Jade authentication continuation limit exceeded');
    });
  }

  async signPsbt(network: JadeNetwork, psbt: Uint8Array): Promise<Uint8Array> {
    return this.runFatal(async () => {
      assertNetwork(network);
      if (!(psbt instanceof Uint8Array) || psbt.length === 0) throw new Error('Invalid Jade PSBT');
      const first = await this.rpc('sign_psbt', { network, psbt }, true);
      const firstChunk = resultBytes(first.result);
      if (first.seqnum === undefined) return firstChunk;
      assertChunkMetadata(first, 1, first.seqlen);
      const total = first.seqlen!;
      if (total > JADE_PROTOCOL_LIMITS.maxExtendedDataChunks) {
        throw new Error('Jade extended-data chunk limit exceeded');
      }
      return this.readPsbtChunks(first.id, firstChunk, total);
    });
  }

  private async readPsbtChunks(originalId: string, first: Uint8Array, total: number): Promise<Uint8Array> {
    const chunks = [first];
    let totalBytes = first.length;
    for (let sequence = 2; sequence <= total; sequence++) {
      const response = await this.rpc('get_extended_data', {
        orig: 'sign_psbt', origid: originalId, seqnum: sequence, seqlen: total,
      });
      assertChunkMetadata(response, sequence, total);
      const chunk = resultBytes(response.result);
      totalBytes += chunk.length;
      if (totalBytes > JADE_PROTOCOL_LIMITS.maxBufferedBytes) throw aggregateError();
      chunks.push(chunk);
    }
    const result = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  private async readCorrelated(expectedId: string, timeoutMs: number): Promise<JadeRpcResponse> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const read = await this.readBefore(deadline);
      if (read.done) throw new Error('Jade serial port closed unexpectedly');
      if (!read.value || read.value.length === 0) continue;
      const frames = this.decoder.push(read.value);
      if (frames.length === 0) continue;
      if (frames.length !== 1 || this.decoder.hasPendingFrame()) {
        throw new Error('Jade returned unsolicited coalesced RPC responses');
      }
      return this.consume(expectedId, validatedRpcResponse(frames[0]));
    }
  }
  private async readBefore(deadline: number): Promise<ReadableStreamReadResult<Uint8Array>> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Timeout waiting for Jade response');
    let rejectTimeout!: (reason: Error) => void;
    const timeout = new Promise<never>((_, reject) => { rejectTimeout = reject; });
    const timer = setTimeout(
      () => rejectTimeout(new Error('Timeout waiting for Jade response')),
      remaining,
    );
    try {
      return await Promise.race([this.transport.reader.read(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
  private consume(expectedId: string, response: JadeRpcResponse): JadeRpcResponse {
    if (this.completedIds.has(response.id)) throw new Error('Jade returned a duplicate RPC response');
    if (response.id !== expectedId) throw new Error('Jade returned a stale or unsolicited RPC response');
    this.completedIds.add(response.id);
    return response;
  }

  private async runFatal<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      await this.invalidateSafely();
      throw error;
    }
  }

  private async fail(error: Error): Promise<never> {
    await this.invalidateSafely();
    throw error;
  }

  private async invalidateSafely(): Promise<void> {
    if (this.invalid) return;
    this.invalid = true;
    this.decoder.reset();
    try {
      await this.transport.invalidate();
    } catch (invalidationError) {
      // Preserve the protocol failure that caused invalidation.
      void invalidationError;
    }
  }
}

function randomRpcIdPrefix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function resultBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length === 0) {
    throw new Error('Jade returned an invalid binary PSBT chunk');
  }
  return value;
}

function assertChunkMetadata(response: JadeRpcResponse, sequence: number, total?: number): void {
  if (response.seqnum !== sequence || response.seqlen !== total) {
    throw new Error('Jade returned reordered or inconsistent extended-data chunks');
  }
}

function aggregateError(): Error {
  return new Error('Jade signed PSBT exceeds the aggregate byte limit');
}

function assertNetwork(network: JadeNetwork): void {
  if (network !== 'mainnet' && network !== 'testnet') throw new Error('Invalid Jade network');
}

export function validateAuthContinuation(value: unknown): JadePinRelayRequest {
  const continuation = authContinuationRecord(value);
  const params = authContinuationParams(continuation);
  assertExactKeys(params, new Set(['urls', 'method', 'accept', 'data']), 'Jade PIN-oracle request');
  if (params.method !== 'POST' || params.accept !== 'json' || !Array.isArray(params.urls)) {
    throw new Error('Jade returned an unsupported PIN-oracle request');
  }
  return {
    operation: validateOracleUrls(params.urls),
    data: validatedJsonValue(params.data, 'Jade PIN-oracle request body'),
  };
}

function authContinuationRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isRecord(value.http_request)) {
    throw new Error('Jade returned a malformed authentication continuation');
  }
  return value.http_request;
}

function authContinuationParams(continuation: Record<string, unknown>): Record<string, unknown> {
  assertExactKeys(continuation, new Set(['params', 'on-reply']), 'Jade authentication continuation');
  if (continuation['on-reply'] !== 'pin' || !isRecord(continuation.params)) {
    throw new Error('Jade returned an unsupported authentication continuation');
  }
  return continuation.params;
}

function validateOracleUrls(urls: unknown[]): JadePinOperation {
  const official = urls.filter((url): url is string => typeof url === 'string' && OFFICIAL_PIN_URLS.has(url));
  if (official.length !== 1 || urls.some(isUnsupportedOracleUrl)) {
    throw new Error('Jade PIN-oracle destination is unsupported');
  }
  return OFFICIAL_PIN_URLS.get(official[0])!;
}

function isUnsupportedOracleUrl(value: unknown): boolean {
  if (typeof value !== 'string') return true;
  if (OFFICIAL_PIN_URLS.has(value)) return false;
  try {
    const parsed = new URL(value);
    // The pinned vendor response can include an onion alternative alongside
    // one exact official clearnet URL. It is tolerated as inert metadata only;
    // validateOracleUrls always returns the official operation and the relay
    // accepts no URL field at all.
    return !['http:', 'https:'].includes(parsed.protocol)
      || !parsed.hostname.endsWith('.onion')
      || parsed.username !== '' || parsed.password !== '';
  } catch {
    return true;
  }
}
