const DEFAULT_EXPORT_CONCURRENCY = 2;

export type ExportPermitRelease = () => void;

/**
 * Small process-local guard that bounds export database/file work. The default
 * of two leaves connection-pool capacity available for unrelated requests.
 */
export class ExportPermitPool {
  private activeCount = 0;

  constructor(private readonly limit = DEFAULT_EXPORT_CONCURRENCY) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('Export permit limit must be a positive integer');
    }
  }

  get active(): number {
    return this.activeCount;
  }

  tryAcquire(): ExportPermitRelease | null {
    if (this.activeCount >= this.limit) return null;

    this.activeCount += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCount -= 1;
    };
  }
}

export const transactionExportPermits = new ExportPermitPool();
