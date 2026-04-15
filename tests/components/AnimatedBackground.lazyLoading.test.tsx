/**
 * AnimatedBackground lazy loading edge case tests
 *
 * Covers defensive branches in the dynamic module loading logic:
 * - Missing glob entry (no matching animation file)
 * - Module that exports a non-function hook
 * - Module import failure (catch branch)
 * - Component unmount during async load (cancelled flag)
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { snowfallImportGate, useSakuraPetalsMock } = vi.hoisted(() => {
  const createGate = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });

    return { promise, resolve };
  };

  return {
    snowfallImportGate: {
      current: createGate(),
      reset() {
        this.current = createGate();
      },
    },
    useSakuraPetalsMock: vi.fn(),
  };
});

// Mock registry-backed animated detection to include a fake pattern with no matching animation file
vi.mock('../../themes/patterns', () => {
  const patterns = ['sakura-petals', 'snowfall', 'fireflies', 'test-nonexistent'] as const;
  const patternSet = new Set<string>(patterns);
  return {
    ANIMATED_PATTERNS: patterns,
    isAnimatedBackgroundPattern: (id: string) => patternSet.has(id),
  };
});

// sakuraPetals: valid mock (happy path / cancelled test)
vi.mock('../../components/animations/sakuraPetals.ts', () => ({
  useSakuraPetals: useSakuraPetalsMock,
}));

// snowfall: async factory rejects after delay, reaching .catch() handler
// The import gate allows unmount tests to set cancelled=true before the catch fires
vi.mock('../../components/animations/snowfall.ts', async () => {
  await snowfallImportGate.current.promise;
  throw new Error('Module load failed');
});

// fireflies: exports a non-function (else branch in hookCandidate check)
vi.mock('../../components/animations/fireflies.ts', () => ({
  useFireflies: 'not-a-function',
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { AnimatedBackground } from '../../components/AnimatedBackground';

/** Flush microtasks and pending React state updates */
const flushAsync = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

const settleSnowfallImport = async () => {
  snowfallImportGate.current.resolve();
  await flushAsync();
};

describe('AnimatedBackground lazy loading edge cases', () => {
  beforeEach(() => {
    snowfallImportGate.reset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders canvas but no runner when glob has no matching module', async () => {
    // 'test-nonexistent' passes animated detection but has no file in import.meta.glob
    const { container } = render(
      <AnimatedBackground pattern="test-nonexistent" darkMode={false} />
    );

    await flushAsync();

    // Canvas renders because pattern passes animated detection, but no AnimationRunner
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('handles module exporting non-function hook', async () => {
    const { container } = render(
      <AnimatedBackground pattern="fireflies" darkMode={false} />
    );

    // Wait for the dynamic import to resolve and the then-handler to evaluate
    // useFireflies is 'not-a-function' → else branch sets activeHook to null
    await flushAsync();

    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('handles module import failure gracefully', async () => {
    const { container } = render(
      <AnimatedBackground pattern="snowfall" darkMode={false} />
    );

    // Release the async mock rejection and let the catch handler run.
    await settleSnowfallImport();

    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('prevents state update after unmount (cancelled race)', async () => {
    const { unmount } = render(
      <AnimatedBackground pattern="sakura-petals" darkMode={true} />
    );

    // Unmount immediately — the cancelled flag prevents setState after unmount
    unmount();

    // Allow microtasks to settle — no "state update on unmounted component" error
    await flushAsync();
  });

  it('skips catch-branch state update when component unmounted during failing import', async () => {
    // snowfall mock rejects after 100ms delay
    const { unmount } = render(
      <AnimatedBackground pattern="snowfall" darkMode={false} />
    );

    // Let the useEffect fire (schedules the import), then unmount
    await act(async () => {});
    unmount();

    // Wait for the delayed rejection to settle; cancelled === true skips setActiveHook
    await settleSnowfallImport();
  });
});
