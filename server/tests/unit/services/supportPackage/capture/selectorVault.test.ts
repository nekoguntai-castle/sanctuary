import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryOnlyCaptureSelectorVault } from '../../../../../src/services/supportPackage/capture/selectorVault';

describe('memory-only controlled-capture selectors', () => {
  afterEach(() => vi.useRealTimers());
  it('makes a selector available only inside a callback', () => {
    const vault = new MemoryOnlyCaptureSelectorVault<{ walletId: string }>();
    const selector = { walletId: 'private-wallet-id' };
    vault.set('session-a', selector, Date.now() + 1_000);

    expect(vault.use('session-a', value => value === selector)).toBe(true);
    expect(Object.keys(vault)).toEqual([]);
  });

  it('cannot be serialized and removes selectors during teardown', () => {
    const vault = new MemoryOnlyCaptureSelectorVault<string>();
    vault.set('session-a', 'private-selector', Date.now() + 1_000);

    expect(() => JSON.stringify(vault)).toThrow('capture_selectors_are_memory_only');
    expect(vault.delete('session-a')).toBe(true);
    expect(() => vault.use('session-a', value => value)).toThrow('capture_selector_unavailable');
  });

  it('rejects an empty session key and can clear every process-local selector', () => {
    const vault = new MemoryOnlyCaptureSelectorVault<string>();
    expect(() => vault.set('', 'selector', Date.now() + 1_000)).toThrow('capture_session_id_required');
    vault.set('session-a', 'selector', Date.now() + 1_000);
    vault.clear();
    expect(() => vault.use('session-a', value => value)).toThrow('capture_selector_unavailable');
    expect(() => vault.set('session-b', 'selector', Date.now()))
      .toThrow('capture_expiry_invalid');
  });

  it('erases an idle selector automatically at expiry', () => {
    vi.useFakeTimers();
    const vault = new MemoryOnlyCaptureSelectorVault<string>();
    vault.set('session-a', 'private-selector', Date.now() + 1_000);
    vi.advanceTimersByTime(1_000);
    expect(() => vault.use('session-a', value => value)).toThrow('capture_selector_unavailable');
  });

  it('cancels stale expiry timers when replacing or deleting selectors', () => {
    vi.useFakeTimers();
    const vault = new MemoryOnlyCaptureSelectorVault<string>();
    const now = Date.now();
    vault.set('session-a', 'first', now + 1_000);
    vault.set('session-a', 'second', now + 2_000);
    vi.advanceTimersByTime(1_000);
    expect(vault.use('session-a', value => value)).toBe('second');
    expect(vault.delete('session-a')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
