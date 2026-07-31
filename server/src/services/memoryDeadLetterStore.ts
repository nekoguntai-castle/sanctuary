import type {
  DeadLetterCategory,
  DeadLetterClaimResult,
  DeadLetterEntry,
  DeadLetterStore,
} from './deadLetterQueueTypes';

const MAX_ENTRIES = 1_000;
const ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

interface MemoryClaim {
  token: string;
  expiresAt: number;
}

function cloneEntry(entry: DeadLetterEntry): DeadLetterEntry {
  return {
    ...entry,
    firstFailedAt: new Date(entry.firstFailedAt),
    lastFailedAt: new Date(entry.lastFailedAt),
  };
}

export class MemoryDeadLetterStore implements DeadLetterStore {
  private readonly entries = new Map<string, DeadLetterEntry>();
  private readonly claims = new Map<string, MemoryClaim>();
  private readonly tombstones = new Map<string, number>();

  async upsert(entry: DeadLetterEntry): Promise<string> {
    await this.cleanup();
    if (this.tombstones.has(entry.id)) return entry.id;
    const existing = this.entries.get(entry.id);
    // Match Redis idempotency: repair sweeps do not refresh failure age.
    if (existing?.job && entry.job) return entry.id;
    this.entries.set(entry.id, {
      ...cloneEntry(entry),
      firstFailedAt: existing?.firstFailedAt ?? entry.firstFailedAt,
    });
    this.evictOverflow();
    return entry.id;
  }

  async get(id: string): Promise<DeadLetterEntry | null> {
    await this.cleanup();
    const entry = this.entries.get(id);
    return entry ? cloneEntry(entry) : null;
  }

  async list(options: {
    category?: DeadLetterCategory;
    limit?: number;
  } = {}): Promise<DeadLetterEntry[]> {
    await this.cleanup();
    const limit = Math.max(0, Math.min(options.limit ?? MAX_ENTRIES, MAX_ENTRIES));
    return [...this.entries.values()]
      .filter(
        (entry) => !options.category || entry.category === options.category,
      )
      .sort((left, right) =>
        right.lastFailedAt.getTime() - left.lastFailedAt.getTime()
      )
      .slice(0, limit)
      .map(cloneEntry);
  }

  async remove(id: string): Promise<boolean> {
    this.claims.delete(id);
    const removed = this.entries.delete(id);
    if (removed) this.tombstones.set(id, Date.now() + ENTRY_TTL_MS);
    return removed;
  }

  async clearCategory(category: DeadLetterCategory): Promise<number> {
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (entry.category !== category) continue;
      this.entries.delete(id);
      this.claims.delete(id);
      this.tombstones.set(id, Date.now() + ENTRY_TTL_MS);
      removed += 1;
    }
    return removed;
  }

  async claim(
    id: string,
    token: string,
    leaseMs: number,
  ): Promise<DeadLetterClaimResult> {
    await this.cleanup();
    const entry = this.entries.get(id);
    if (!entry) return { status: 'missing' };
    const now = Date.now();
    const current = this.claims.get(id);
    if (current && current.expiresAt > now) return { status: 'busy' };
    const expiresAt = now + leaseMs;
    this.claims.set(id, { token, expiresAt });
    return {
      status: 'claimed',
      claim: {
        entry: cloneEntry(entry),
        token,
        expiresAt: new Date(expiresAt),
      },
    };
  }

  async release(id: string, token: string): Promise<boolean> {
    const claim = this.claims.get(id);
    if (!claim || claim.token !== token) return false;
    this.claims.delete(id);
    return true;
  }

  async acknowledge(id: string, token: string): Promise<boolean> {
    const claim = this.claims.get(id);
    if (!claim || claim.token !== token) return false;
    this.claims.delete(id);
    const removed = this.entries.delete(id);
    if (removed) this.tombstones.set(id, Date.now() + ENTRY_TTL_MS);
    return removed;
  }

  async cleanup(): Promise<number> {
    const cutoff = Date.now() - ENTRY_TTL_MS;
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (entry.lastFailedAt.getTime() > cutoff) continue;
      this.entries.delete(id);
      this.claims.delete(id);
      removed += 1;
    }
    for (const [id, claim] of this.claims) {
      if (claim.expiresAt <= Date.now()) this.claims.delete(id);
    }
    for (const [id, expiresAt] of this.tombstones) {
      if (expiresAt <= Date.now()) this.tombstones.delete(id);
    }
    return removed;
  }

  private evictOverflow(): void {
    const overflow = this.entries.size - MAX_ENTRIES;
    if (overflow <= 0) return;
    const oldest = [...this.entries.values()]
      .sort((left, right) =>
        left.lastFailedAt.getTime() - right.lastFailedAt.getTime()
      )
      .slice(0, overflow);
    for (const entry of oldest) {
      this.entries.delete(entry.id);
      this.claims.delete(entry.id);
      this.tombstones.set(entry.id, Date.now() + ENTRY_TTL_MS);
    }
  }
}
