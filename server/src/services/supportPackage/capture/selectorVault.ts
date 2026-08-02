/**
 * Process-local selector storage. This class deliberately has no serialization,
 * iteration, or raw-value accessor; consumers can use a selector only inside a
 * callback and must clear it during session teardown.
 */
export class MemoryOnlyCaptureSelectorVault<TSelector> {
  readonly #selectors = new Map<string, TSelector>();
  readonly #expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  set(sessionId: string, selector: TSelector, expiresAtMs: number): void {
    if (!sessionId) throw new Error('capture_session_id_required');
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= Date.now()) {
      throw new Error('capture_expiry_invalid');
    }
    this.delete(sessionId);
    this.#selectors.set(sessionId, selector);
    const timer = setTimeout(() => {
      this.#selectors.delete(sessionId);
      this.#expiryTimers.delete(sessionId);
    }, Math.max(0, expiresAtMs - Date.now()));
    timer.unref?.();
    this.#expiryTimers.set(sessionId, timer);
  }

  use<TResult>(sessionId: string, operation: (selector: TSelector) => TResult): TResult {
    const selector = this.#selectors.get(sessionId);
    if (selector === undefined) throw new Error('capture_selector_unavailable');
    return operation(selector);
  }

  delete(sessionId: string): boolean {
    const timer = this.#expiryTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.#expiryTimers.delete(sessionId);
    return this.#selectors.delete(sessionId);
  }

  clear(): void {
    for (const timer of this.#expiryTimers.values()) clearTimeout(timer);
    this.#expiryTimers.clear();
    this.#selectors.clear();
  }

  toJSON(): never {
    throw new Error('capture_selectors_are_memory_only');
  }
}
