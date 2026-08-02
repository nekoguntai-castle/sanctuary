import type { ReplayGuard } from '../../internal/workerDiagnostics/auth';

/**
 * Process-local nonce guard bounded against memory exhaustion. Capacity eviction
 * can permit reuse of the oldest nonce, but only while its independently signed
 * timestamp remains inside the short authentication freshness window; request
 * concurrency and the 1,024-entry bound make that tradeoff explicit and finite.
 */
export class BoundedReplayGuard implements ReplayGuard {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 1024,
  ) {}

  accept(nonce: string, nowMs: number): boolean {
    this.prune(nowMs);
    if (this.seen.has(nonce)) return false;

    if (this.seen.size >= this.maxEntries) {
      const oldest = this.seen.keys().next().value as string | undefined;
      if (oldest) this.seen.delete(oldest);
    }
    this.seen.set(nonce, nowMs + this.ttlMs);
    return true;
  }

  clear(): void {
    this.seen.clear();
  }

  private prune(nowMs: number): void {
    for (const [nonce, expiresAt] of this.seen) {
      if (expiresAt > nowMs) continue;
      this.seen.delete(nonce);
    }
  }
}
