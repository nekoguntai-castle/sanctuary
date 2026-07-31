import { randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import {
  open,
  readdir,
  stat,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { createLogger } from '../../utils/logger';
import { safeJsonParse } from '../../utils/safeJson';
import type { ExportRow } from './serialization';

const log = createLogger('TX:EXPORT_SNAPSHOT');
export const EXPORT_SNAPSHOT_PREFIX = '.sanctuary-transaction-export-';
export const EXPORT_SNAPSHOT_SUFFIX = '.ids.tmp';
const DEFAULT_MEMORY_THRESHOLD_BYTES = 1024 * 1024;
const STALE_SNAPSHOT_AGE_MS = 24 * 60 * 60 * 1000;

interface ExportRowSnapshotOptions {
  directory?: string;
  memoryThresholdBytes?: number;
}

export interface OrphanCleanupOptions {
  directory?: string;
  maxAgeMs?: number;
  now?: number;
}

/**
 * Immutable normalized export-row snapshot with lifecycle: append, seal, iterate,
 * then cleanup. Small snapshots stay in memory; larger ones spill to an owner-only
 * temporary file. The legacy suffix remains so startup cleanup also finds older spills.
 */
const ExportRowSchema = z.object({
  date: z.string(),
  txid: z.string(),
  type: z.string(),
  amountBtc: z.number(),
  amountSats: z.number(),
  balanceAfterBtc: z.number().nullable(),
  balanceAfterSats: z.number().nullable(),
  feeSats: z.number().nullable(),
  confirmations: z.number(),
  label: z.string(),
  memo: z.string(),
  counterpartyAddress: z.string(),
  blockHeight: z.number().nullable(),
}).strict();

/** A byte-bounded immutable snapshot of normalized export rows. */
export class ExportRowSnapshot {
  private readonly memoryLines: string[] = [];
  private memoryBytes = 0;
  private file: FileHandle | null = null;
  private reader: ReadStream | null = null;
  private sealed = false;
  private readonly pendingMutations = new Set<Promise<void>>();
  filepath: string | null = null;

  constructor(
    private readonly directory: string,
    private readonly memoryThresholdBytes: number,
  ) {}

  append(rows: ExportRow[], signal?: AbortSignal): Promise<void> {
    return this.trackMutation(this.appendRows(rows, signal));
  }

  private async appendRows(rows: ExportRow[], signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.sealed) throw new Error('Export row snapshot is sealed');

    const lines = rows.map(row => JSON.stringify(row));
    let spillOffset = lines.length;
    for (let offset = 0; offset < lines.length; offset += 1) {
      signal?.throwIfAborted();
      const line = lines[offset];
      const lineBytes = Buffer.byteLength(`${line}\n`, 'utf8');
      if (!this.file && this.memoryBytes + lineBytes <= this.memoryThresholdBytes) {
        this.memoryLines.push(line);
        this.memoryBytes += lineBytes;
        continue;
      }
      spillOffset = offset;
      break;
    }
    if (spillOffset < lines.length) {
      await this.ensureFile(signal);
      signal?.throwIfAborted();
      await this.writeLines(lines.slice(spillOffset), signal);
    }
  }

  seal(signal?: AbortSignal): Promise<void> {
    return this.trackMutation(this.sealFile(signal));
  }

  private async sealFile(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.sealed) return;
    this.sealed = true;
    const file = this.file;
    await file?.close();
    this.file = null;
    signal?.throwIfAborted();
  }

  async *pages(pageSize: number): AsyncGenerator<ExportRow[]> {
    if (!this.sealed) throw new Error('Export ID snapshot must be sealed before reading');
    if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Page size must be positive');

    if (!this.filepath) {
      for (let offset = 0; offset < this.memoryLines.length; offset += pageSize) {
        yield this.memoryLines.slice(offset, offset + pageSize).map(parseExportRow);
      }
      return;
    }

    const input = createReadStream(this.filepath, { encoding: 'utf8' });
    this.reader = input;
    const lines = createInterface({
      input,
      crlfDelay: Infinity,
    });
    try {
      let page: ExportRow[] = [];
      for await (const line of lines) {
        page.push(parseExportRow(line));
        if (page.length === pageSize) {
          yield page;
          page = [];
        }
      }
      /* v8 ignore next -- exact-page exhaustion is covered above; V8 attributes generator completion here */
      if (page.length > 0) yield page;
    } finally {
      lines.close();
      await this.closeReader(input);
    }
  }

  async cleanup(): Promise<void> {
    await this.waitForPendingMutations();
    await this.closeReader(this.reader);
    if (this.file) await Promise.allSettled([this.file.close()]);
    this.file = null;
    if (this.filepath) await Promise.allSettled([unlink(this.filepath)]);
  }

  private async ensureFile(signal?: AbortSignal): Promise<void> {
    if (this.file) return;
    this.filepath = join(
      this.directory,
      `${EXPORT_SNAPSHOT_PREFIX}${process.pid}-${randomUUID()}${EXPORT_SNAPSHOT_SUFFIX}`,
    );
    this.file = await open(this.filepath, 'wx', 0o600);
    signal?.throwIfAborted();
    await this.writeLines(this.memoryLines, signal);
    this.memoryLines.length = 0;
    this.memoryBytes = 0;
  }

  private trackMutation(operation: Promise<void>): Promise<void> {
    this.pendingMutations.add(operation);
    void operation.then(
      () => this.pendingMutations.delete(operation),
      () => this.pendingMutations.delete(operation),
    );
    return operation;
  }

  private async waitForPendingMutations(): Promise<void> {
    while (this.pendingMutations.size > 0) {
      await Promise.allSettled([...this.pendingMutations]);
    }
  }

  private async writeLines(lines: string[], signal?: AbortSignal): Promise<void> {
    if (!this.file || lines.length === 0) return;
    await this.file.writeFile(`${lines.join('\n')}\n`, { encoding: 'utf8', signal });
  }

  private async closeReader(reader: ReadStream | null): Promise<void> {
    if (!reader) return;
    if (!reader.closed) {
      const closed = new Promise<void>(resolve => reader.once('close', resolve));
      if (!reader.destroyed) reader.destroy();
      await closed;
    }
    if (this.reader === reader) this.reader = null;
  }
}

function parseExportRow(line: string): ExportRow {
  const row = safeJsonParse<ExportRow | null>(
    line,
    ExportRowSchema.nullable(),
    null,
    'transaction export snapshot row',
  );
  if (row === null) throw new Error('Transaction export snapshot contains an invalid row');
  return row;
}

export async function createExportRowSnapshot(
  options: ExportRowSnapshotOptions = {},
): Promise<ExportRowSnapshot> {
  const threshold = options.memoryThresholdBytes ?? DEFAULT_MEMORY_THRESHOLD_BYTES;
  if (!Number.isInteger(threshold) || threshold < 0) {
    throw new Error('Export snapshot memory byte threshold must be a nonnegative integer');
  }
  return new ExportRowSnapshot(options.directory ?? tmpdir(), threshold);
}

function isSnapshotFilename(filename: string): boolean {
  return filename.startsWith(EXPORT_SNAPSHOT_PREFIX) && filename.endsWith(EXPORT_SNAPSHOT_SUFFIX);
}

function isOwned(stats: Awaited<ReturnType<typeof stat>>): boolean {
  const uid = process.getuid?.();
  return uid === undefined || stats.uid === uid;
}

export async function cleanupOrphanedExportSnapshots(
  options: OrphanCleanupOptions = {},
): Promise<number> {
  const directory = options.directory ?? tmpdir();
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? STALE_SNAPSHOT_AGE_MS;
  let removed = 0;

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !isSnapshotFilename(entry.name)) continue;
    const filepath = join(directory, entry.name);
    try {
      const details = await stat(filepath);
      if (!details.isFile() || !isOwned(details) || now - details.mtimeMs < maxAgeMs) continue;
      await unlink(filepath);
      removed += 1;
    } catch (error) {
      /* v8 ignore next -- a file disappearing between readdir/stat is an OS race */
      log.warn('Could not inspect stale transaction export snapshot', { filepath, error });
    }
  }

  if (removed > 0) log.info('Removed stale transaction export snapshots', { removed });
  return removed;
}
