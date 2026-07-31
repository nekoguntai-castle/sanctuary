import { EventEmitter } from 'node:events';
import { appendFile, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ExportPermitPool,
} from '../../../src/services/transactionExport/exportPermit';
import {
  cleanupOrphanedExportSnapshots,
  createExportRowSnapshot,
  EXPORT_SNAPSHOT_PREFIX,
  EXPORT_SNAPSHOT_SUFFIX,
} from '../../../src/services/transactionExport/exportSnapshot';
import {
  ExportOperationOwnership,
  ExportStreamClosedError,
  observeExportStream,
  raceExportAbort,
  writeExportChunk,
} from '../../../src/services/transactionExport/streamLifecycle';
import { toCsvRow, type ExportRow } from '../../../src/services/transactionExport/serialization';

const cleanupPaths: string[] = [];

function exportRow(txid: string, overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    date: '2026-01-01T00:00:00.000Z',
    txid,
    type: 'received',
    amountBtc: 0.00000001,
    amountSats: 1,
    balanceAfterBtc: 0.00000001,
    balanceAfterSats: 1,
    feeSats: null,
    confirmations: 1,
    label: '',
    memo: '',
    counterpartyAddress: '',
    blockHeight: 1,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map(async path => {
    const { rm } = await import('node:fs/promises');
    await rm(path, { force: true, recursive: true });
  }));
});

describe('transaction export permits', () => {
  it('rejects invalid pool sizes', () => {
    expect(() => new ExportPermitPool(0)).toThrow('positive integer');
    expect(() => new ExportPermitPool(1.5)).toThrow('positive integer');
  });

  it('rejects saturation and makes a released permit reusable exactly once', () => {
    const permits = new ExportPermitPool(1);
    const release = permits.tryAcquire();

    expect(release).toBeTypeOf('function');
    expect(permits.tryAcquire()).toBeNull();
    release?.();
    release?.();
    expect(permits.active).toBe(0);
    expect(permits.tryAcquire()).toBeTypeOf('function');
  });
});

describe('transaction export snapshots', () => {
  it('validates configuration and snapshot read state', async () => {
    await expect(createExportRowSnapshot({ memoryThresholdBytes: -1 })).rejects.toThrow(
      'nonnegative integer',
    );
    const snapshot = await createExportRowSnapshot({ memoryThresholdBytes: 256 });
    await expect(async () => {
      for await (const _page of snapshot.pages(1)) void _page;
    }).rejects.toThrow('must be sealed');
    await snapshot.seal();
    await snapshot.seal();
    await expect(async () => {
      for await (const _page of snapshot.pages(0)) void _page;
    }).rejects.toThrow('positive');
  });

  it('keeps small captures in memory and refuses appends after sealing', async () => {
    const snapshot = await createExportRowSnapshot({ memoryThresholdBytes: 10_000 });
    await snapshot.append([]);
    const rows = [exportRow('id-1'), exportRow('id-2'), exportRow('id-3')];
    await snapshot.append(rows);
    await snapshot.seal();

    expect(snapshot.filepath).toBeNull();
    const pages: ExportRow[][] = [];
    for await (const page of snapshot.pages(2)) pages.push(page);
    expect(pages).toEqual([rows.slice(0, 2), rows.slice(2)]);
    await expect(snapshot.append([exportRow('id-4')])).rejects.toThrow('sealed');
    await snapshot.cleanup();
  });

  it('refuses snapshot writes after capture cancellation', async () => {
    const snapshot = await createExportRowSnapshot({ memoryThresholdBytes: 0 });
    const controller = new AbortController();
    controller.abort(new Error('capture timed out'));
    await expect(snapshot.append([exportRow('id-1')], controller.signal)).rejects.toThrow('capture timed out');
    expect(snapshot.filepath).toBeNull();
  });

  it('spills past the memory threshold to an owner-only file and preserves pages', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'export-snapshot-test-'));
    cleanupPaths.push(directory);
    const snapshot = await createExportRowSnapshot({ directory, memoryThresholdBytes: 1 });

    const rows = [exportRow('id-1'), exportRow('id-2'), exportRow('id-3'), exportRow('id-4')];
    await snapshot.append(rows.slice(0, 2));
    await snapshot.append(rows.slice(2, 3));
    await snapshot.append(rows.slice(3));
    await snapshot.seal();

    expect(snapshot.filepath).toBeTypeOf('string');
    expect((await stat(snapshot.filepath!)).mode & 0o777).toBe(0o600);
    const pages: ExportRow[][] = [];
    for await (const page of snapshot.pages(2)) pages.push(page);
    expect(pages).toEqual([rows.slice(0, 2), rows.slice(2)]);
    await snapshot.cleanup();
    await expect(stat(snapshot.filepath!)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('spills a single row larger than the serialized byte budget and round-trips unicode', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'export-snapshot-large-row-'));
    cleanupPaths.push(directory);
    const snapshot = await createExportRowSnapshot({ directory, memoryThresholdBytes: 32 });
    const row = exportRow('large-row', { memo: '猫'.repeat(128) });

    await snapshot.append([row]);
    await snapshot.seal();

    expect(snapshot.filepath).toBeTypeOf('string');
    const pages: ExportRow[][] = [];
    for await (const page of snapshot.pages(1)) pages.push(page);
    expect(pages).toEqual([[row]]);
    await snapshot.cleanup();
  });

  it('fails closed when a spilled NDJSON row is malformed or truncated', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'export-snapshot-invalid-'));
    cleanupPaths.push(directory);
    const snapshot = await createExportRowSnapshot({ directory, memoryThresholdBytes: 0 });
    await snapshot.append([exportRow('valid-row')]);
    await snapshot.seal();
    await appendFile(snapshot.filepath!, '{"txid":"truncated"');

    await expect(async () => {
      for await (const _page of snapshot.pages(10)) void _page;
    }).rejects.toThrow('invalid row');
    await snapshot.cleanup();
  });

  it('cleans up a partial spill after a file write failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'export-snapshot-write-failure-'));
    cleanupPaths.push(directory);
    const snapshot = await createExportRowSnapshot({ directory, memoryThresholdBytes: 0 });
    await snapshot.append([exportRow('first-row')]);
    const filepath = snapshot.filepath!;
    const file = Reflect.get(snapshot, 'file') as import('node:fs/promises').FileHandle;
    vi.spyOn(file, 'writeFile').mockRejectedValueOnce(new Error('disk full'));

    await expect(snapshot.append([exportRow('failed-row')])).rejects.toThrow('disk full');
    await snapshot.cleanup();

    await expect(stat(filepath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('closes a spilled snapshot reader before early iterator return settles', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'export-snapshot-reader-'));
    cleanupPaths.push(directory);
    const snapshot = await createExportRowSnapshot({ directory, memoryThresholdBytes: 0 });
    await snapshot.append(Array.from({ length: 100 }, (_, index) => exportRow(`id-${index}`)));
    await snapshot.seal();

    const pages = snapshot.pages(1);
    await expect(pages.next()).resolves.toEqual({ value: [exportRow('id-0')], done: false });
    const reader = Reflect.get(snapshot, 'reader') as import('node:fs').ReadStream;
    expect(reader.closed).toBe(false);

    await pages.return(undefined);

    expect(reader.destroyed).toBe(true);
    expect(reader.closed).toBe(true);
    expect(Reflect.get(snapshot, 'reader')).toBeNull();
    await Reflect.apply(Reflect.get(Object.getPrototypeOf(snapshot), 'closeReader'), snapshot, [reader]);
    await snapshot.cleanup();
  });

  it('removes only stale owned regular snapshot files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'export-orphan-test-'));
    cleanupPaths.push(directory);
    const stale = join(directory, `${EXPORT_SNAPSHOT_PREFIX}stale${EXPORT_SNAPSHOT_SUFFIX}`);
    const unrelated = join(directory, 'unrelated.tmp');
    await writeFile(stale, 'id-1\n', { mode: 0o600 });
    await writeFile(unrelated, 'keep');
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const { utimes } = await import('node:fs/promises');
    await utimes(stale, old, old);

    expect(await cleanupOrphanedExportSnapshots({ directory })).toBe(1);
    await expect(stat(stale)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(unrelated, 'utf8')).toBe('keep');
  });

  it('leaves recent snapshots and files owned by another uid alone', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'export-orphan-guards-'));
    cleanupPaths.push(directory);
    const recent = join(directory, `${EXPORT_SNAPSHOT_PREFIX}recent${EXPORT_SNAPSHOT_SUFFIX}`);
    await writeFile(recent, 'id-1\n', { mode: 0o600 });
    expect(await cleanupOrphanedExportSnapshots({ directory })).toBe(0);

    const getuid = process.getuid;
    if (getuid) {
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const { utimes } = await import('node:fs/promises');
      await utimes(recent, old, old);
      vi.spyOn(process, 'getuid').mockReturnValue(getuid() + 1);
      expect(await cleanupOrphanedExportSnapshots({ directory })).toBe(0);
      vi.restoreAllMocks();
    }
    expect(await readFile(recent, 'utf8')).toBe('id-1\n');
  });

  it('uses the system temp directory safely when cleanup options omit it', async () => {
    await expect(cleanupOrphanedExportSnapshots({
      maxAgeMs: Number.MAX_SAFE_INTEGER,
    })).resolves.toBe(0);
  });

  it('cleans up an unsealed spill file and tolerates repeated cleanup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'export-snapshot-cleanup-'));
    cleanupPaths.push(directory);
    const snapshot = await createExportRowSnapshot({ directory, memoryThresholdBytes: 0 });
    await snapshot.append([exportRow('id-1')]);
    const filepath = snapshot.filepath!;
    await snapshot.cleanup();
    await snapshot.cleanup();
    await expect(stat(filepath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('ends a timed-out seal promptly but defers cleanup until close settles', async () => {
    const snapshot = await createExportRowSnapshot({ memoryThresholdBytes: 0 });
    let finishClose!: () => void;
    const close = vi.fn(() => new Promise<void>(resolve => {
      finishClose = resolve;
    }));
    Reflect.set(snapshot, 'file', { close, sync: vi.fn().mockResolvedValue(undefined) });
    const controller = new AbortController();
    const sealing = snapshot.seal(controller.signal);
    const raced = raceExportAbort(controller.signal, sealing);
    controller.abort(new Error('capture deadline'));
    await expect(raced).rejects.toThrow('capture deadline');

    let cleaned = false;
    const cleanup = snapshot.cleanup().then(() => {
      cleaned = true;
    });
    await Promise.resolve();
    expect(cleaned).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
    finishClose();
    await expect(sealing).rejects.toThrow('capture deadline');
    await cleanup;
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('transaction export stream lifecycle', () => {
  it('retains concurrency ownership until abandoned work settles', async () => {
    const ownership = new ExportOperationOwnership();
    let settle!: () => void;
    const operation = new Promise<void>(resolve => {
      settle = resolve;
    });
    ownership.hold(operation);
    const release = vi.fn();

    ownership.releaseWhenSettled(release);
    await Promise.resolve();
    expect(release).not.toHaveBeenCalled();
    settle();
    await expect.poll(() => release).toHaveBeenCalledTimes(1);
  });

  it('races pending export work against abort and removes its listener on every outcome', async () => {
    const completed = new AbortController();
    await expect(raceExportAbort(completed.signal, Promise.resolve('done'))).resolves.toBe('done');

    const failed = new AbortController();
    const error = new Error('query failed');
    await expect(raceExportAbort(failed.signal, Promise.reject(error))).rejects.toBe(error);

    const aborted = new AbortController();
    const pending = new Promise<string>(() => undefined);
    const raced = raceExportAbort(aborted.signal, pending);
    aborted.abort(new ExportStreamClosedError());
    await expect(raced).rejects.toBeInstanceOf(ExportStreamClosedError);

    const alreadyAborted = new AbortController();
    alreadyAborted.abort(new ExportStreamClosedError());
    await expect(raceExportAbort(alreadyAborted.signal, pending)).rejects.toBeInstanceOf(
      ExportStreamClosedError,
    );
  });

  it('tracks request aborts and response errors and disposes every listener', () => {
    const req = Object.assign(new EventEmitter(), { destroyed: false });
    const res = Object.assign(new EventEmitter(), { destroyed: false });
    const aborted = observeExportStream(req as never, res as never);
    req.emit('aborted');
    expect(aborted.signal.aborted).toBe(true);
    expect(aborted.signal.reason).toBeInstanceOf(ExportStreamClosedError);
    aborted.dispose();
    expect(req.listenerCount('aborted')).toBe(0);

    const errored = observeExportStream(req as never, res as never);
    const error = new Error('socket failed');
    res.emit('error', error);
    expect(errored.signal.reason).toBe(error);
    errored.dispose();
    expect(res.listenerCount('close')).toBe(0);
    expect(res.listenerCount('error')).toBe(0);
  });

  it('observes an already-aborted request signal with a normalized lifecycle error', () => {
    const requestAbort = new AbortController();
    requestAbort.abort('timeout');
    const req = Object.assign(new EventEmitter(), {
      destroyed: false,
      requestAbortSignal: requestAbort.signal,
    });
    const res = Object.assign(new EventEmitter(), { destroyed: false });

    const lifecycle = observeExportStream(req as never, res as never);

    expect(lifecycle.signal.aborted).toBe(true);
    expect(lifecycle.signal.reason).toBeInstanceOf(ExportStreamClosedError);
    lifecycle.dispose();
  });

  it('writes immediately when there is no backpressure and rejects destroyed streams', async () => {
    const req = Object.assign(new EventEmitter(), { destroyed: false });
    const res = Object.assign(new EventEmitter(), {
      destroyed: false,
      write: vi.fn(() => true),
    });
    await expect(writeExportChunk(req as never, res as never, 'chunk')).resolves.toBeUndefined();
    expect(res.write).toHaveBeenCalledWith('chunk');
    req.destroyed = true;
    await expect(writeExportChunk(req as never, res as never, 'chunk')).rejects.toBeInstanceOf(
      ExportStreamClosedError,
    );
  });

  it('does not miss cancellation triggered synchronously by a backpressured write', async () => {
    const controller = new AbortController();
    const error = new Error('request timeout');
    const req = Object.assign(new EventEmitter(), { destroyed: false });
    const res = Object.assign(new EventEmitter(), {
      destroyed: false,
      write: vi.fn(() => {
        controller.abort(error);
        return false;
      }),
    });

    await expect(writeExportChunk(
      req as never,
      res as never,
      'chunk',
      controller.signal,
    )).rejects.toBe(error);
  });

  it('removes listeners after drain and rejects promptly on response close', async () => {
    const req = Object.assign(new EventEmitter(), { destroyed: false });
    const res = Object.assign(new EventEmitter(), {
      destroyed: false,
      write: vi.fn(() => false),
    });
    const drained = writeExportChunk(req as never, res as never, 'chunk');
    res.emit('drain');
    await drained;
    expect(req.listenerCount('aborted')).toBe(0);
    expect(res.listenerCount('close')).toBe(0);
    expect(res.listenerCount('error')).toBe(0);

    const closed = writeExportChunk(req as never, res as never, 'chunk');
    res.emit('close');
    await expect(closed).rejects.toBeInstanceOf(ExportStreamClosedError);
    expect(res.listenerCount('drain')).toBe(0);
  });

  it('rejects backpressure waits on request abort and preserves response errors', async () => {
    const makeStreams = () => {
      const req = Object.assign(new EventEmitter(), { destroyed: false });
      const res = Object.assign(new EventEmitter(), {
        destroyed: false,
        write: vi.fn(() => false),
      });
      return { req, res };
    };
    const aborted = makeStreams();
    const abortWrite = writeExportChunk(aborted.req as never, aborted.res as never, 'chunk');
    aborted.req.emit('aborted');
    await expect(abortWrite).rejects.toBeInstanceOf(ExportStreamClosedError);

    const errored = makeStreams();
    const errorWrite = writeExportChunk(errored.req as never, errored.res as never, 'chunk');
    const error = new Error('write failed');
    errored.res.emit('error', error);
    await expect(errorWrite).rejects.toBe(error);

    const signalled = makeStreams();
    const controller = new AbortController();
    const signalWrite = writeExportChunk(
      signalled.req as never,
      signalled.res as never,
      'chunk',
      controller.signal,
    );
    controller.abort('timeout');
    await expect(signalWrite).rejects.toBeInstanceOf(ExportStreamClosedError);
  });
});

describe('transaction export CSV safety', () => {
  it.each(['=', '+', '-', '@', '\t', '\r'])(
    'neutralizes %j formula prefixes before RFC quoting',
    (prefix) => {
      const row = toCsvRow({
        date: '2026-01-01', txid: 'tx', type: 'sent', amountBtc: 0, amountSats: 0,
        balanceAfterBtc: null, balanceAfterSats: null, feeSats: null, confirmations: 0,
        label: `${prefix}formula`, memo: '', counterpartyAddress: '', blockHeight: null,
      });
      expect(row).toContain(`'${prefix}formula`);
    },
  );

  it('quotes carriage returns as record-structural characters', () => {
    const row = toCsvRow({
      date: '2026-01-01', txid: 'tx', type: 'received', amountBtc: 0, amountSats: 0,
      balanceAfterBtc: null, balanceAfterSats: null, feeSats: null, confirmations: 0,
      label: '', memo: 'line\rbreak', counterpartyAddress: '', blockHeight: null,
    });
    expect(row).toContain('"line\rbreak"');
  });
});
