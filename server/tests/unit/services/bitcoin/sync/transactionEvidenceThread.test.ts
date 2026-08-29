import { describe, expect, it, vi } from 'vitest';
import { RawTransactionEvidenceError } from '../../../../../src/services/bitcoin/rawTransactionEvidence';
import type { RawTransaction } from '../../../../../src/services/bitcoin/sync';

const workerMock = vi.hoisted(() => ({
  created: [] as Array<{ filename: string; options: unknown; worker: unknown }>,
  posted: [] as Array<{ message: unknown; transferList?: readonly ArrayBuffer[] }>,
  dispatch: undefined as undefined | ((
    worker: any,
    message?: unknown,
    transferList?: readonly ArrayBuffer[],
  ) => void),
}));

vi.mock('node:worker_threads', () => ({
  Worker: class {
    private readonly listeners = new Map<string, Set<(value: any) => void>>();
    private readonly onceListeners = new Map<string, Set<(value: any) => void>>();
    readonly terminate = vi.fn(async () => 0);

    constructor(filename: string, options: unknown) {
      workerMock.created.push({ filename, options, worker: this });
      const workerData = (options as { workerData?: unknown }).workerData;
      if (!(workerData as { persistent?: boolean } | undefined)?.persistent) {
        queueMicrotask(() => workerMock.dispatch?.(this));
      }
    }

    on(event: string, listener: (value: any) => void): this {
      const listeners = this.listeners.get(event) ?? new Set();
      listeners.add(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    once(event: string, listener: (value: any) => void): this {
      const listeners = this.onceListeners.get(event) ?? new Set();
      listeners.add(listener);
      this.onceListeners.set(event, listeners);
      return this;
    }

    off(event: string, listener: (value: any) => void): this {
      this.listeners.get(event)?.delete(listener);
      this.onceListeners.get(event)?.delete(listener);
      return this;
    }

    postMessage(message: unknown, transferList?: readonly ArrayBuffer[]): void {
      workerMock.posted.push({ message, transferList });
      queueMicrotask(() => workerMock.dispatch?.(this, message, transferList));
    }

    emit(event: string, value: any): void {
      const listeners = [
        ...(this.listeners.get(event) ?? []),
        ...(this.onceListeners.get(event) ?? []),
      ];
      this.onceListeners.delete(event);
      for (const listener of listeners) listener(value);
    }

    emitPair(message: any, error: Error): void {
      const onMessage = [
        ...(this.listeners.get('message') ?? []),
        ...(this.onceListeners.get('message') ?? []),
      ];
      const onError = [
        ...(this.listeners.get('error') ?? []),
        ...(this.onceListeners.get('error') ?? []),
      ];
      this.onceListeners.delete('message');
      this.onceListeners.delete('error');
      for (const listener of onMessage) listener(message);
      for (const listener of onError) listener(error);
    }
  },
}));

import {
  createCompactTransactionEvidenceProjector,
  createTransactionEvidenceProjector,
  DetachedTransactionEvidenceError,
  projectTransactionEvidenceOffThread,
  projectedTransactionEvidenceComplexity,
  resolveTransactionEvidenceWorkerEntrypoint,
} from '../../../../../src/services/bitcoin/sync/transactionEvidenceThread';
import type { CompactTransactionEvidenceEnvelope } from '../../../../../src/services/bitcoin/sync/transactionEvidenceProjection';

const txid = '11'.repeat(32);
const details: RawTransaction = { txid, hex: '00', vin: [], vout: [] };
const input = {
  expectedTxid: txid,
  details,
  network: 'mainnet' as const,
  limits: { maxInputs: 25_000, maxOutputs: 25_000, maxScriptHexChars: 1024 * 1024 },
};
const projected: RawTransaction = { txid, hex: '00', vin: [], vout: [] };
const compactEnvelope = (): CompactTransactionEvidenceEnvelope => ({
  txid,
  canonicalBytes: Uint8Array.from([1, 2, 3]),
  digest: 'sealed-digest',
  complexity: { rawHexChars: 6, inputs: 0, outputs: 0, scriptHexChars: 0 },
  metadata: {},
  inputTxids: new Uint8Array(),
  inputVouts: new Uint32Array(),
  paidWalletScriptIndexes: new Uint32Array(),
});

describe('transaction evidence worker-thread transport', () => {
  it('rejects protocol responses on the legacy one-shot transport', async () => {
    workerMock.dispatch = worker => worker.emit('message', {
      operation: 'compact',
      ok: false,
      reason: 'txid_mismatch',
    });

    await expect(projectTransactionEvidenceOffThread(input))
      .rejects.toThrow('Unexpected transaction evidence response');
  });

  it('initializes immutable lowercase wallet scripts and transfers one compact byte buffer', async () => {
    workerMock.created.length = 0;
    workerMock.posted.length = 0;
    workerMock.dispatch = (worker, message) => {
      const request = message as {
        operation: 'compact';
        input: { canonicalBytes: Uint8Array; expectedTxid: string; metadata: unknown };
      };
      worker.emit('message', {
        operation: 'compact',
        ok: true,
        envelope: {
          txid: request.input.expectedTxid,
          canonicalBytes: request.input.canonicalBytes,
          digest: 'sealed-digest',
          complexity: { rawHexChars: 2, inputs: 0, outputs: 0, scriptHexChars: 0 },
          metadata: request.input.metadata,
          inputTxids: new Uint8Array(),
          inputVouts: new Uint32Array(),
          paidWalletScriptIndexes: new Uint32Array(),
        },
      });
    };
    const projector = createCompactTransactionEvidenceProjector(['AA', 'bb']);

    const envelope = await projector.projectCompact(input);

    expect(workerMock.created[0].options).toMatchObject({
      workerData: { persistent: true, walletScripts: ['aa', 'bb'] },
      resourceLimits: { maxOldGenerationSizeMb: 32 },
    });
    expect(workerMock.posted).toHaveLength(1);
    expect(workerMock.posted[0].message).toMatchObject({ operation: 'compact' });
    expect(workerMock.posted[0].transferList).toHaveLength(1);
    expect(workerMock.posted[0].transferList?.[0]).toBe(envelope.canonicalBytes.buffer);
    expect(envelope.metadata).toEqual({
      time: undefined,
      blocktime: undefined,
      blockheight: undefined,
      confirmations: undefined,
      blockhash: undefined,
    });
    await projector.close();
  });

  it('transfers and restores the same sealed envelope for full and exact-output work', async () => {
    workerMock.posted.length = 0;
    const envelope: CompactTransactionEvidenceEnvelope = {
      txid,
      canonicalBytes: Uint8Array.from([1, 2, 3]),
      digest: 'sealed-digest',
      complexity: { rawHexChars: 6, inputs: 0, outputs: 0, scriptHexChars: 0 },
      metadata: { time: 7 },
      inputTxids: new Uint8Array(),
      inputVouts: new Uint32Array(),
      paidWalletScriptIndexes: new Uint32Array(),
    };
    let call = 0;
    workerMock.dispatch = (worker, message) => {
      const request = message as {
        operation: 'full' | 'output' | 'outputs';
        input: { canonicalBytes: Uint8Array; digest: string };
      };
      call += 1;
      if (request.operation === 'full') {
        worker.emit('message', {
          operation: 'full',
          ok: true,
          result: {
            value: { txid, vin: [], vout: [] },
            canonicalBytes: request.input.canonicalBytes,
            digest: request.input.digest,
          },
        });
      } else if (request.operation === 'output') {
        worker.emit('message', {
          operation: 'output',
          ok: true,
          result: {
            output: { vout: 0, valueSats: 5n, scriptPubKeyHex: '51' },
            canonicalBytes: request.input.canonicalBytes,
            digest: request.input.digest,
          },
        });
      } else {
        worker.emit('message', {
          operation: 'outputs',
          ok: true,
          result: {
            outputs: [{ vout: 0, valueSats: 5n, scriptPubKeyHex: '51' }],
            missingVouts: [9],
            invalidVouts: [],
            canonicalBytes: request.input.canonicalBytes,
            digest: request.input.digest,
          },
        });
      }
    };
    const projector = createCompactTransactionEvidenceProjector([]);

    const full = await projector.projectFull(envelope);
    const exact = await projector.extractOutput(envelope, 0);
    const exactSet = await projector.extractOutputs(envelope, [0, 9]);

    expect(call).toBe(3);
    expect(full.value).toEqual({ txid, vin: [], vout: [] });
    expect(exact.output).toEqual({ vout: 0, valueSats: 5n, scriptPubKeyHex: '51' });
    expect(exactSet.outputs).toEqual([{ vout: 0, valueSats: 5n, scriptPubKeyHex: '51' }]);
    expect(exactSet.missingVouts).toEqual([9]);
    expect(exactSet.invalidVouts).toEqual([]);
    expect(workerMock.posted.map(item => item.transferList?.length)).toEqual([1, 1, 1]);
    expect(envelope.canonicalBytes).toBe(exactSet.canonicalBytes);
    await projector.close();
  });

  it('restores ownership on a classified exact-output failure and remains usable', async () => {
    const envelope: CompactTransactionEvidenceEnvelope = {
      txid,
      canonicalBytes: Uint8Array.from([1]),
      digest: 'sealed-digest',
      complexity: { rawHexChars: 2, inputs: 0, outputs: 0, scriptHexChars: 0 },
      metadata: {},
      inputTxids: new Uint8Array(),
      inputVouts: new Uint32Array(),
      paidWalletScriptIndexes: new Uint32Array(),
    };
    workerMock.dispatch = (worker, message) => {
      const request = message as { operation: string; input: { canonicalBytes: Uint8Array } };
      worker.emit('message', request.operation === 'output'
        ? {
            operation: 'output',
            ok: false,
            reason: 'missing_output',
            canonicalBytes: request.input.canonicalBytes,
            digest: envelope.digest,
          }
        : { ok: true, value: projected });
    };
    const projector = createCompactTransactionEvidenceProjector([]);

    await expect(projector.extractOutput(envelope, 9)).rejects.toMatchObject({
      reason: 'missing_output',
    });
    expect(envelope.canonicalBytes).toEqual(Uint8Array.from([1]));
    await expect(projector.project(input)).resolves.toBe(projected);
    await projector.close();
  });

  it('marks worker failure while ownership is detached as non-refetchable', async () => {
    const envelope: CompactTransactionEvidenceEnvelope = {
      txid,
      canonicalBytes: Uint8Array.from([1, 2, 3]),
      digest: 'sealed-digest',
      complexity: { rawHexChars: 6, inputs: 0, outputs: 0, scriptHexChars: 0 },
      metadata: {},
      inputTxids: new Uint8Array(),
      inputVouts: new Uint32Array(),
      paidWalletScriptIndexes: new Uint32Array(),
    };
    workerMock.dispatch = (worker, _message, transferList) => {
      structuredClone(null, { transfer: [...(transferList ?? [])] });
      worker.emit('error', new Error('worker crashed'));
    };
    const projector = createCompactTransactionEvidenceProjector([]);

    await expect(projector.projectFull(envelope)).rejects.toMatchObject({
      name: 'DetachedTransactionEvidenceError',
      noRemoteFallback: true,
    } satisfies Partial<DetachedTransactionEvidenceError>);
    expect(envelope.canonicalBytes.byteLength).toBe(0);
    await projector.close();
  });

  it('reuses one queue-depth-one worker and awaits its final teardown', async () => {
    workerMock.created.length = 0;
    workerMock.dispatch = worker => worker.emit('message', { ok: true, value: projected });
    const projector = createTransactionEvidenceProjector();

    await expect(projector.project(input)).resolves.toBe(projected);
    await expect(projector.project(input)).resolves.toBe(projected);

    expect(workerMock.created).toHaveLength(1);
    expect(workerMock.created[0].options).toMatchObject({
      workerData: { persistent: true },
      resourceLimits: { maxOldGenerationSizeMb: 32 },
    });
    const worker = workerMock.created[0].worker as { terminate: ReturnType<typeof vi.fn> };
    expect(worker.terminate).not.toHaveBeenCalled();
    await projector.close();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('rejects concurrent work instead of growing an evidence queue', async () => {
    workerMock.created.length = 0;
    workerMock.dispatch = () => undefined;
    const projector = createTransactionEvidenceProjector();
    const first = projector.project(input);

    await expect(projector.project(input)).rejects.toThrow('queue is full');
    const worker = workerMock.created[0].worker as { emit: (event: string, value: unknown) => void };
    worker.emit('message', { ok: true, value: projected });
    await expect(first).resolves.toBe(projected);
    await projector.close();
  });

  it('retains worker-provided complexity without rescanning the result', async () => {
    const complexity = { rawHexChars: 2, inputs: 0, outputs: 0, scriptHexChars: 0 };
    workerMock.dispatch = worker => worker.emit('message', {
      ok: true,
      value: projected,
      complexity,
    });
    const projector = createTransactionEvidenceProjector();

    await expect(projector.project(input)).resolves.toBe(projected);
    expect(projectedTransactionEvidenceComplexity(projected)).toEqual(complexity);
    await projector.close();
  });

  it('retains worker-provided complexity on the legacy one-shot transport', async () => {
    const complexity = { rawHexChars: 2, inputs: 0, outputs: 0, scriptHexChars: 0 };
    workerMock.dispatch = worker => worker.emit('message', {
      ok: true,
      value: projected,
      complexity,
    });

    await expect(projectTransactionEvidenceOffThread(input)).resolves.toBe(projected);
    expect(projectedTransactionEvidenceComplexity(projected)).toEqual(complexity);
  });

  it('rejects classified failures returned by the persistent worker', async () => {
    workerMock.dispatch = worker => worker.emit('message', {
      ok: false,
      reason: 'txid_mismatch',
    });
    const projector = createTransactionEvidenceProjector();

    await expect(projector.project(input)).rejects.toMatchObject({
      name: 'RawTransactionEvidenceError',
      reason: 'txid_mismatch',
    } satisfies Partial<RawTransactionEvidenceError>);
    await projector.close();
  });

  it('rejects protocol responses on the persistent legacy projection path', async () => {
    workerMock.dispatch = worker => worker.emit('message', {
      operation: 'compact',
      ok: false,
      reason: 'txid_mismatch',
    });
    const projector = createTransactionEvidenceProjector();

    await expect(projector.project(input))
      .rejects.toThrow('Unexpected transaction evidence response');
    await projector.close();
  });

  it('uses an empty compact encoding when legacy details omit raw hex', async () => {
    workerMock.dispatch = worker => worker.emit('message', {
      operation: 'compact',
      ok: false,
      reason: 'missing_result',
    });
    const projector = createCompactTransactionEvidenceProjector([]);

    await expect(projector.projectCompact({
      ...input,
      details: { txid, vin: [], vout: [] },
    })).rejects.toMatchObject({ reason: 'missing_result' });
    expect(workerMock.posted.at(-1)?.message).toMatchObject({
      operation: 'compact',
      input: { canonicalBytes: new Uint8Array() },
    });
    await projector.close();
  });

  it.each([
    ['compact', 'full'],
    ['full', 'output'],
    ['output', 'outputs'],
    ['outputs', 'full'],
  ] as const)('fails detached when %s receives a %s protocol response', async (request, response) => {
    workerMock.dispatch = worker => worker.emit('message', {
      operation: response,
      ok: true,
    });
    const projector = createCompactTransactionEvidenceProjector([]);
    const envelope = compactEnvelope();
    const pending = request === 'compact'
      ? projector.projectCompact(input)
      : request === 'full'
        ? projector.projectFull(envelope)
        : request === 'output'
          ? projector.extractOutput(envelope, 0)
          : projector.extractOutputs(envelope, [0]);

    await expect(pending).rejects.toMatchObject({
      name: request === 'compact' ? 'Error' : 'DetachedTransactionEvidenceError',
    });
    await projector.close();
  });

  it('contains teardown rejection after a detached protocol response', async () => {
    workerMock.dispatch = worker => worker.emit('message', {
      operation: 'output',
      ok: true,
    });
    const projector = createCompactTransactionEvidenceProjector([]);
    const worker = workerMock.created.at(-1)?.worker as {
      terminate: ReturnType<typeof vi.fn>;
    };
    worker.terminate.mockRejectedValueOnce(new Error('detached teardown failed'));

    await expect(projector.projectFull(compactEnvelope())).rejects.toMatchObject({
      name: 'DetachedTransactionEvidenceError',
    });
    await expect(projector.close()).rejects.toThrow('detached teardown failed');
  });

  it.each(['full', 'outputs'] as const)(
    'restores transferred ownership on classified %s failure',
    async (operation) => {
      const envelope = compactEnvelope();
      workerMock.dispatch = (worker, message) => {
        const request = message as { input: { canonicalBytes: Uint8Array; digest: string } };
        worker.emit('message', {
          operation,
          ok: false,
          reason: 'evidence_digest_mismatch',
          canonicalBytes: request.input.canonicalBytes,
          digest: request.input.digest,
        });
      };
      const projector = createCompactTransactionEvidenceProjector([]);
      const pending = operation === 'full'
        ? projector.projectFull(envelope)
        : projector.extractOutputs(envelope, [0]);

      await expect(pending).rejects.toMatchObject({ reason: 'evidence_digest_mismatch' });
      expect(envelope.canonicalBytes).toEqual(Uint8Array.from([1, 2, 3]));
      await projector.close();
    },
  );

  it.each([
    ['missing transferred bytes', undefined, undefined, 'DetachedTransactionEvidenceError'],
    ['changed transferred digest', Uint8Array.from([1, 2, 3]), 'changed', 'RawTransactionEvidenceError'],
  ] as const)('fails closed for %s', async (_label, canonicalBytes, digest, name) => {
    workerMock.dispatch = worker => worker.emit('message', {
      operation: 'full',
      ok: false,
      reason: 'txid_mismatch',
      canonicalBytes,
      digest,
    });
    const projector = createCompactTransactionEvidenceProjector([]);

    await expect(projector.projectFull(compactEnvelope())).rejects.toMatchObject({ name });
    await projector.close();
  });

  it('ignores a second persistent terminal event after a reply settles', async () => {
    workerMock.dispatch = worker => worker.emitPair(
      { ok: true, value: projected },
      new Error('late persistent worker error'),
    );
    const projector = createTransactionEvidenceProjector();

    await expect(projector.project(input)).resolves.toBe(projected);
    await projector.close();
  });

  it('fails closed when a projector worker cannot receive messages', async () => {
    const worker = {
      on: vi.fn().mockReturnThis(),
      once: vi.fn().mockReturnThis(),
      off: vi.fn().mockReturnThis(),
      terminate: vi.fn(async () => 0),
    };
    const projector = createTransactionEvidenceProjector(() => worker as never);

    await expect(projector.project(input)).rejects.toThrow('cannot accept work');
    await projector.close();
  });

  it('rejects work after an explicit projector close', async () => {
    workerMock.dispatch = () => undefined;
    const projector = createTransactionEvidenceProjector();

    await projector.close();

    await expect(projector.project(input)).rejects.toThrow('projector is closed');
  });

  it.each([new Error('post failed'), 'non-error post failure'])(
    'closes after synchronous postMessage failure %#',
    async (thrown) => {
      const listeners = new Map<string, (value: unknown) => void>();
      const worker = {
        on: vi.fn((event: string, listener: (value: unknown) => void) => {
          listeners.set(event, listener);
          return worker;
        }),
        once: vi.fn().mockReturnThis(),
        off: vi.fn().mockReturnThis(),
        postMessage: vi.fn(() => { throw thrown; }),
        terminate: vi.fn(async () => 0),
      };
      const projector = createTransactionEvidenceProjector(() => worker as never);

      await expect(projector.project(input)).rejects.toThrow(String(
        thrown instanceof Error ? thrown.message : thrown,
      ));
      await projector.close();
      expect(worker.terminate).toHaveBeenCalledOnce();
    },
  );

  it('surfaces teardown failure without leaving an unhandled rejection', async () => {
    workerMock.dispatch = () => undefined;
    const projector = createTransactionEvidenceProjector();
    const worker = workerMock.created.at(-1)?.worker as {
      terminate: ReturnType<typeof vi.fn>;
    };
    worker.terminate.mockRejectedValueOnce(new Error('terminate failed'));

    await expect(projector.close()).rejects.toThrow('terminate failed');
  });

  it('keeps cancellation primary when teardown also fails', async () => {
    workerMock.dispatch = () => undefined;
    const controller = new AbortController();
    const projector = createTransactionEvidenceProjector();
    const worker = workerMock.created.at(-1)?.worker as {
      terminate: ReturnType<typeof vi.fn>;
    };
    worker.terminate.mockRejectedValueOnce(new Error('terminate failed'));
    const pending = projector.project(input, controller.signal);

    controller.abort(new Error('budget expired'));

    await expect(pending).rejects.toThrow('budget expired');
    await expect(projector.close()).rejects.toThrow('terminate failed');
  });

  it('contains teardown rejection after an active worker failure', async () => {
    workerMock.dispatch = worker => worker.emit('error', new Error('worker failed'));
    const projector = createTransactionEvidenceProjector();
    const worker = workerMock.created.at(-1)?.worker as {
      terminate: ReturnType<typeof vi.fn>;
    };
    worker.terminate.mockRejectedValueOnce(new Error('terminate failed'));

    await expect(projector.project(input)).rejects.toThrow('worker failed');
    await expect(projector.close()).rejects.toThrow('terminate failed');
  });

  it('closes after a worker failure and keeps teardown idempotent', async () => {
    workerMock.dispatch = worker => worker.emit('error', new Error('persistent failure'));
    const projector = createTransactionEvidenceProjector();

    await expect(projector.project(input)).rejects.toThrow('persistent failure');
    await expect(projector.project(input)).rejects.toThrow('persistent failure');
    await projector.close();
    await projector.close();

    const worker = workerMock.created.at(-1)?.worker as { terminate: ReturnType<typeof vi.fn> };
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('closes after a persistent worker exits before replying', async () => {
    workerMock.dispatch = worker => worker.emit('exit', 7);
    const projector = createTransactionEvidenceProjector();

    await expect(projector.project(input)).rejects.toThrow('before reply (7)');
    await expect(projector.project(input)).rejects.toThrow('before reply (7)');
    await projector.close();
  });

  it('captures worker startup failure before the first projection', async () => {
    workerMock.dispatch = () => undefined;
    const projector = createTransactionEvidenceProjector();
    const worker = workerMock.created.at(-1)?.worker as {
      emit: (event: string, value: unknown) => void;
    };

    worker.emit('error', new Error('startup failure'));

    await expect(projector.project(input)).rejects.toThrow('startup failure');
    await projector.close();
  });

  it('captures an idle worker exit between projections', async () => {
    workerMock.dispatch = worker => worker.emit('message', { ok: true, value: projected });
    const projector = createTransactionEvidenceProjector();
    await expect(projector.project(input)).resolves.toBe(projected);
    const worker = workerMock.created.at(-1)?.worker as {
      emit: (event: string, value: unknown) => void;
    };

    worker.emit('exit', 4);

    await expect(projector.project(input)).rejects.toThrow('before reply (4)');
    await projector.close();
  });

  it('terminates persistent projection promptly on stage cancellation', async () => {
    workerMock.dispatch = () => undefined;
    const controller = new AbortController();
    const reason = new Error('stage budget expired');
    const projector = createTransactionEvidenceProjector();
    const pending = projector.project(input, controller.signal);

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    await projector.close();
    const worker = workerMock.created.at(-1)?.worker as { terminate: ReturnType<typeof vi.fn> };
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('handles worker exit after close has already begun', async () => {
    workerMock.dispatch = () => undefined;
    const projector = createTransactionEvidenceProjector();
    const pending = projector.project(input);
    const worker = workerMock.created.at(-1)?.worker as {
      emit: (event: string, value: unknown) => void;
      terminate: ReturnType<typeof vi.fn>;
    };

    const closing = projector.close();
    worker.emit('exit', 0);

    await expect(pending).rejects.toThrow('projector closed');
    await closing;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('uses a stable persistent cancellation error for a legacy signal without a reason', async () => {
    let abortListener!: () => void;
    const signal = {
      aborted: false,
      reason: undefined,
      throwIfAborted: vi.fn(),
      addEventListener: (_event: string, listener: () => void) => { abortListener = listener; },
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;
    workerMock.dispatch = () => abortListener();
    const projector = createTransactionEvidenceProjector();

    await expect(projector.project(input, signal))
      .rejects.toThrow('Transaction evidence projection cancelled');
    await projector.close();
  });

  it('uses the bounded source-runtime worker and resolves its authenticated projection', async () => {
    workerMock.created.length = 0;
    workerMock.dispatch = worker => worker.emit('message', { ok: true, value: projected });

    await expect(projectTransactionEvidenceOffThread(input)).resolves.toBe(projected);

    expect(workerMock.created).toHaveLength(1);
    expect(workerMock.created[0].filename).toMatch(/transactionEvidenceWorker\.ts$/);
    expect(workerMock.created[0].options).toMatchObject({
      workerData: input,
      resourceLimits: { maxOldGenerationSizeMb: 32 },
      execArgv: process.execArgv,
    });
  });

  it('resolves source and compiled worker entrypoints without filesystem I/O', () => {
    expect(resolveTransactionEvidenceWorkerEntrypoint('/app/src/transport.ts')).toEqual({
      filename: '/app/src/transactionEvidenceWorker.ts',
      execArgv: process.execArgv,
    });
    expect(resolveTransactionEvidenceWorkerEntrypoint('/app/dist/transport.js')).toEqual({
      filename: '/app/dist/transactionEvidenceWorker.js',
    });
  });

  it('restores a fail-closed evidence reason returned by the worker', async () => {
    workerMock.dispatch = worker => worker.emit('message', {
      ok: false,
      reason: 'txid_mismatch',
    });

    await expect(projectTransactionEvidenceOffThread(input)).rejects.toMatchObject({
      name: 'RawTransactionEvidenceError',
      reason: 'txid_mismatch',
    } satisfies Partial<RawTransactionEvidenceError>);
  });

  it('uses a stable error when the worker cannot classify its failure', async () => {
    workerMock.dispatch = worker => worker.emit('message', { ok: false });

    await expect(projectTransactionEvidenceOffThread(input))
      .rejects.toThrow('worker rejected the transaction');
  });

  it('propagates worker errors and premature exits', async () => {
    const workerError = new Error('worker failed');
    workerMock.dispatch = worker => worker.emit('error', workerError);
    await expect(projectTransactionEvidenceOffThread(input)).rejects.toBe(workerError);

    workerMock.dispatch = worker => worker.emit('exit', 9);
    await expect(projectTransactionEvidenceOffThread(input))
      .rejects.toThrow('exited before reply (9)');
  });

  it('ignores a second terminal worker event after the first reply settles', async () => {
    workerMock.dispatch = worker => worker.emitPair(
      { ok: true, value: projected },
      new Error('late worker error'),
    );

    await expect(projectTransactionEvidenceOffThread(input)).resolves.toBe(projected);
  });

  it('rejects before spawning when terminal cancellation already exists', async () => {
    const controller = new AbortController();
    const reason = new Error('lease lost');
    controller.abort(reason);
    workerMock.created.length = 0;

    await expect(projectTransactionEvidenceOffThread(input, controller.signal))
      .rejects.toBe(reason);
    expect(workerMock.created).toHaveLength(0);
  });

  it('terminates an active worker on terminal cancellation', async () => {
    const controller = new AbortController();
    const reason = new Error('lease lost');
    workerMock.dispatch = () => undefined;
    const pending = projectTransactionEvidenceOffThread(input, controller.signal);
    await vi.waitFor(() => expect(workerMock.created.length).toBeGreaterThan(0));

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it('uses a stable cancellation error for a legacy signal without a reason', async () => {
    let abortListener!: () => void;
    const signal = {
      aborted: false,
      reason: undefined,
      throwIfAborted: vi.fn(),
      addEventListener: (_event: string, listener: () => void) => { abortListener = listener; },
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;
    workerMock.dispatch = () => abortListener();

    await expect(projectTransactionEvidenceOffThread(input, signal))
      .rejects.toThrow('Transaction evidence projection cancelled');
  });

  it('finishes local evidence when a non-terminal budget signal aborts', async () => {
    const controller = new AbortController();
    const budget = new Error('budget expired');
    workerMock.dispatch = worker => {
      controller.abort(budget);
      worker.emit('message', { ok: true, value: projected });
    };

    await expect(projectTransactionEvidenceOffThread(
      input,
      controller.signal,
      undefined,
      () => false,
    )).resolves.toBe(projected);
  });
});
