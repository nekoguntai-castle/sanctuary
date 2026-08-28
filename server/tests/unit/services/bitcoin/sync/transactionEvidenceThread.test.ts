import { describe, expect, it, vi } from 'vitest';
import { RawTransactionEvidenceError } from '../../../../../src/services/bitcoin/rawTransactionEvidence';
import type { RawTransaction } from '../../../../../src/services/bitcoin/sync';

const workerMock = vi.hoisted(() => ({
  created: [] as Array<{ filename: string; options: unknown; worker: unknown }>,
  dispatch: undefined as undefined | ((worker: any) => void),
}));

vi.mock('node:worker_threads', () => ({
  Worker: class {
    private readonly listeners = new Map<string, Set<(value: any) => void>>();
    readonly terminate = vi.fn(async () => 0);

    constructor(filename: string, options: unknown) {
      workerMock.created.push({ filename, options, worker: this });
      queueMicrotask(() => workerMock.dispatch?.(this));
    }

    once(event: string, listener: (value: any) => void): this {
      const listeners = this.listeners.get(event) ?? new Set();
      listeners.add(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    off(event: string, listener: (value: any) => void): this {
      this.listeners.get(event)?.delete(listener);
      return this;
    }

    emit(event: string, value: any): void {
      const listeners = [...(this.listeners.get(event) ?? [])];
      this.listeners.delete(event);
      for (const listener of listeners) listener(value);
    }

    emitPair(message: any, error: Error): void {
      const onMessage = [...(this.listeners.get('message') ?? [])];
      const onError = [...(this.listeners.get('error') ?? [])];
      for (const listener of onMessage) listener(message);
      for (const listener of onError) listener(error);
    }
  },
}));

import {
  projectTransactionEvidenceOffThread,
  resolveTransactionEvidenceWorkerEntrypoint,
} from '../../../../../src/services/bitcoin/sync/transactionEvidenceThread';

const txid = '11'.repeat(32);
const details: RawTransaction = { txid, hex: '00', vin: [], vout: [] };
const input = {
  expectedTxid: txid,
  details,
  network: 'mainnet' as const,
  limits: { maxInputs: 25_000, maxOutputs: 25_000, maxScriptHexChars: 1024 * 1024 },
};
const projected: RawTransaction = { txid, hex: '00', vin: [], vout: [] };

describe('transaction evidence worker-thread transport', () => {
  it('uses the bounded source-runtime worker and resolves its authenticated projection', async () => {
    workerMock.created.length = 0;
    workerMock.dispatch = worker => worker.emit('message', { ok: true, value: projected });

    await expect(projectTransactionEvidenceOffThread(input)).resolves.toBe(projected);

    expect(workerMock.created).toHaveLength(1);
    expect(workerMock.created[0].filename).toMatch(/transactionEvidenceWorker\.ts$/);
    expect(workerMock.created[0].options).toMatchObject({
      workerData: input,
      resourceLimits: { maxOldGenerationSizeMb: 128 },
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
