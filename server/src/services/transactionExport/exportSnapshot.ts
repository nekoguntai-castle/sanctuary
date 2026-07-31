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
import { createLogger } from '../../utils/logger';

const log = createLogger('TX:EXPORT_SNAPSHOT');
export const EXPORT_SNAPSHOT_PREFIX = '.sanctuary-transaction-export-';
export const EXPORT_SNAPSHOT_SUFFIX = '.ids.tmp';
const DEFAULT_MEMORY_THRESHOLD = 2_000;
const STALE_SNAPSHOT_AGE_MS = 24 * 60 * 60 * 1000;

interface ExportIdSnapshotOptions {
  directory?: string;
  memoryThreshold?: number;
}

export interface OrphanCleanupOptions {
  directory?: string;
  maxAgeMs?: number;
  now?: number;
}

/**
 * Immutable export-membership snapshot with lifecycle:
 * append IDs, seal, iterate pages, then cleanup. Small snapshots stay in memory;
 * larger ones spill to an owner-only temporary file.
 */
export class ExportIdSnapshot {
  private readonly memoryIds: string[] = [];
  private file: FileHandle | null = null;
  private reader: ReadStream | null = null;
  private sealed = false;
  private readonly pendingMutations = new Set<Promise<void>>();
  filepath: string | null = null;

  constructor(
    private readonly directory: string,
    private readonly memoryThreshold: number,
  ) {}

  append(ids: string[], signal?: AbortSignal): Promise<void> {
    return this.trackMutation(this.appendIds(ids, signal));
  }

  private async appendIds(ids: string[], signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.sealed) throw new Error('Export ID snapshot is sealed');
    if (ids.length === 0) return;

    if (!this.file && this.memoryIds.length + ids.length <= this.memoryThreshold) {
      this.memoryIds.push(...ids);
      return;
    }

    await this.ensureFile(signal);
    signal?.throwIfAborted();
    await this.writeIds(ids, signal);
    signal?.throwIfAborted();
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

  async *pages(pageSize: number): AsyncGenerator<string[]> {
    if (!this.sealed) throw new Error('Export ID snapshot must be sealed before reading');
    if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Page size must be positive');

    if (!this.filepath) {
      for (let offset = 0; offset < this.memoryIds.length; offset += pageSize) {
        yield this.memoryIds.slice(offset, offset + pageSize);
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
      let page: string[] = [];
      for await (const line of lines) {
        if (!line) continue;
        page.push(line);
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
    await this.writeIds(this.memoryIds, signal);
    this.memoryIds.length = 0;
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

  private async writeIds(ids: string[], signal?: AbortSignal): Promise<void> {
    if (!this.file || ids.length === 0) return;
    await this.file.writeFile(`${ids.join('\n')}\n`, { encoding: 'utf8', signal });
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

export async function createExportIdSnapshot(
  options: ExportIdSnapshotOptions = {},
): Promise<ExportIdSnapshot> {
  const threshold = options.memoryThreshold ?? DEFAULT_MEMORY_THRESHOLD;
  if (!Number.isInteger(threshold) || threshold < 0) {
    throw new Error('Export snapshot memory threshold must be a nonnegative integer');
  }
  return new ExportIdSnapshot(options.directory ?? tmpdir(), threshold);
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
