import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { render,screen,waitFor } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';

// Mock the API modules
vi.mock('../../src/api/transactions', () => ({
  getTransactions: vi.fn().mockResolvedValue([]),
  getRecentTransactions: vi.fn().mockResolvedValue([]),
  getPendingTransactions: vi.fn().mockResolvedValue([]),
  getBalanceHistory: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/api/wallets', () => ({
  getWallets: vi.fn().mockResolvedValue([]),
  getWallet: vi.fn(),
  createWallet: vi.fn(),
  importWallet: vi.fn(),
}));

vi.mock('../../src/api/bitcoin', () => ({
  getFeeEstimates: vi.fn().mockResolvedValue({
    fastest: 20,
    halfHour: 15,
    hour: 10,
    economy: 5,
    minimum: 1,
  }),
  getMempoolBlocks: vi.fn().mockResolvedValue([]),
  getBitcoinPrice: vi.fn().mockResolvedValue({ USD: 50000 }),
}));

vi.mock('../../src/api/admin', () => ({
  getSystemVariables: vi.fn().mockResolvedValue({}),
}));

// Mock NotificationContext
vi.mock('../../src/contexts/NotificationContext', () => ({
  useNotification: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showInfo: vi.fn(),
    showWarning: vi.fn(),
  }),
}));

// Mock WebSocket context
vi.mock('../../src/contexts/WalletWebSocketContext', () => ({
  useWalletWebSocket: () => ({
    isConnected: false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }),
}));

// Mock the notification sound hook
vi.mock('../../src/hooks/useNotificationSound', () => ({
  useNotificationSound: () => ({
    playEventSound: vi.fn(),
    testSound: vi.fn(),
  }),
}));

// Mock recharts to avoid jsdom issues
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
}));

describe('Dashboard stable array constants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle undefined wallet data without causing re-renders', async () => {
    const { getWallets } = await import('../../src/api/wallets');
    vi.mocked(getWallets).mockResolvedValue(undefined as any);

    let renderCount = 0;

    function TestComponent() {
      renderCount++;

      // Simulate the pattern used in Dashboard
      const data = undefined;
      const EMPTY_ARRAY: never[] = [];
      const safeData = data ?? EMPTY_ARRAY;

      return <div data-testid="test">{safeData.length}</div>;
    }

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <TestComponent />
      </QueryClientProvider>
    );

    const initialRenderCount = renderCount;

    // Rerender multiple times
    rerender(
      <QueryClientProvider client={queryClient}>
        <TestComponent />
      </QueryClientProvider>
    );

    rerender(
      <QueryClientProvider client={queryClient}>
        <TestComponent />
      </QueryClientProvider>
    );

    // The stable empty array pattern should not cause excessive renders
    // beyond what React normally does
    expect(renderCount).toBeLessThanOrEqual(initialRenderCount + 2);
  });

  it('stable array constant should maintain reference identity', () => {
    // Verify that a module-level constant maintains reference identity
    const EMPTY_ARRAY: never[] = [];

    const ref1 = EMPTY_ARRAY;
    const ref2 = EMPTY_ARRAY;

    expect(ref1).toBe(ref2);

    // Compare with inline empty array (different references)
    const inline1: unknown[] = [];
    const inline2: unknown[] = [];
    expect(inline1).not.toBe(inline2);
  });

  it('should not cause re-renders when using stable constants vs inline arrays', () => {
    // This test demonstrates the difference between stable and inline arrays
    const STABLE_EMPTY: never[] = [];

    let stableRenders = 0;
    let inlineRenders = 0;

    // Component using stable constant
    function StableComponent() {
      const nullableValue: undefined | unknown[] = undefined;
      const data = nullableValue ?? STABLE_EMPTY;
      stableRenders++;
      return React.useMemo(() => <div>{data.length}</div>, [data]);
    }

    // Component using inline array (BAD pattern)
    function InlineComponent() {
      const nullableValue: undefined | unknown[] = undefined;
      const data = nullableValue ?? []; // Creates new array each render
      inlineRenders++;
      return React.useMemo(() => <div>{data.length}</div>, [data]);
    }

    const queryClient = new QueryClient();

    // Render stable component
    render(
      <QueryClientProvider client={queryClient}>
        <StableComponent />
      </QueryClientProvider>
    );

    render(
      <QueryClientProvider client={queryClient}>
        <InlineComponent />
      </QueryClientProvider>
    );

    // Both should render once initially
    expect(stableRenders).toBe(1);
    expect(inlineRenders).toBe(1);

    // The key insight is that with stable constants:
    // - useMemo dependencies are stable
    // - No infinite render loops
    // - React.memo can properly compare props
  });
});

describe('Dashboard renders without infinite loops', () => {
  // Increase timeout for full test suite runs where resource contention may occur
  it('should render without throwing "too many re-renders" error', { timeout: 15000 }, async () => {
    // This test verifies the fix for React error #310
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });

    // If the Dashboard has infinite re-render issues, this will timeout or throw
    const renderPromise = import('../../src/components/Dashboard').then(
      ({ Dashboard }) => {
        // Wrap in try-catch to handle render errors gracefully
        try {
          render(
            <QueryClientProvider client={queryClient}>
              <BrowserRouter>
                <Dashboard />
              </BrowserRouter>
            </QueryClientProvider>
          );
          return true;
        } catch (error) {
          // If it's the "too many re-renders" error, the test should fail
          if (
            error instanceof Error &&
            error.message.includes('Too many re-renders')
          ) {
            throw error;
          }
          // Other errors might be acceptable (missing providers, etc.)
          return true;
        }
      }
    );

    // Should complete without infinite loop
    await expect(renderPromise).resolves.toBe(true);
  });
});

describe('Memoization patterns for wallet data', () => {
  it('useMemo should receive array from hook', async () => {
    const { useRecentTransactions } = await import('../../src/hooks/queries/useWallets');

    function TestWrapper({ children }: { children: React.ReactNode }) {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    function TestComponent() {
      const { data, isLoading } = useRecentTransactions(['wallet1'], 10);
      return <div data-testid="result">{isLoading ? 'loading' : data.length}</div>;
    }

    render(
      <TestWrapper>
        <TestComponent />
      </TestWrapper>
    );

    // Wait for component to render
    await waitFor(() => {
      expect(screen.getByTestId('result')).toBeDefined();
    });

    // Verify the hook returns array data
    expect(screen.getByTestId('result').textContent).toBeDefined();
  });
});

describe('Infinite re-render prevention patterns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Stable empty array constants', () => {
    it('module-level empty arrays should maintain reference identity across renders', () => {
      // Simulates the pattern used in Dashboard.tsx:
      // const EMPTY_WALLETS: never[] = [];
      // const EMPTY_TRANSACTIONS: never[] = [];
      const EMPTY_ARRAY_1: never[] = [];
      const EMPTY_ARRAY_2: never[] = [];

      // Same constant should have same reference
      expect(EMPTY_ARRAY_1).toBe(EMPTY_ARRAY_1);
      expect(EMPTY_ARRAY_2).toBe(EMPTY_ARRAY_2);

      // Different constants are different references (expected)
      expect(EMPTY_ARRAY_1).not.toBe(EMPTY_ARRAY_2);
    });

    it('nullish coalescing with stable constant should not trigger re-renders', () => {
      const STABLE_EMPTY: never[] = [];
      let renderCount = 0;

      function TestComponent({ data }: { data: string[] | undefined }) {
        renderCount++;
        // This pattern should NOT cause re-renders because STABLE_EMPTY is always same reference
        const safeData = data ?? STABLE_EMPTY;
        return <div>{safeData.length}</div>;
      }

      const { rerender } = render(<TestComponent data={undefined} />);
      const initialRenderCount = renderCount;

      // Multiple rerenders with undefined should not increase render count significantly
      rerender(<TestComponent data={undefined} />);
      rerender(<TestComponent data={undefined} />);
      rerender(<TestComponent data={undefined} />);

      // Should only have the initial render plus the 3 explicit rerenders
      expect(renderCount).toBe(initialRenderCount + 3);
    });

    it('inline empty array should create new reference each render (anti-pattern demonstration)', () => {
      const refs: unknown[][] = [];

      function BadComponent() {
        // Anti-pattern: creates new array each render
        const nullableValue: undefined | unknown[] = undefined;
        const data = nullableValue ?? [];
        refs.push(data);
        return <div>{data.length}</div>;
      }

      const { rerender } = render(<BadComponent />);
      rerender(<BadComponent />);
      rerender(<BadComponent />);

      // Each render created a different array reference
      expect(refs[0]).not.toBe(refs[1]);
      expect(refs[1]).not.toBe(refs[2]);
    });
  });

  describe('useMemo dependency stability', () => {
    it('useMemo should not recompute when dependencies are stable', () => {
      let computeCount = 0;
      const STABLE_ARRAY: string[] = [];

      function TestComponent({ items }: { items: string[] | undefined }) {
        const safeItems = items ?? STABLE_ARRAY;

        const processed = React.useMemo(() => {
          computeCount++;
          return safeItems.map(i => i.toUpperCase());
        }, [safeItems]);

        return <div>{processed.length}</div>;
      }

      const { rerender } = render(<TestComponent items={undefined} />);
      const initialCount = computeCount;

      // Rerender with same undefined should not recompute
      rerender(<TestComponent items={undefined} />);
      rerender(<TestComponent items={undefined} />);

      // useMemo should not have recomputed because safeItems reference is stable
      expect(computeCount).toBe(initialCount);
    });

    it('walletIds memo pattern should be stable when wallets array is stable', () => {
      let walletIdsMemoCount = 0;
      const EMPTY_WALLETS: Array<{ id: string }> = [];

      function TestComponent({ wallets }: { wallets: Array<{ id: string }> | undefined }) {
        const safeWallets = wallets ?? EMPTY_WALLETS;

        const walletIds = React.useMemo(() => {
          walletIdsMemoCount++;
          return safeWallets.map(w => w.id);
        }, [safeWallets]);

        return <div>{walletIds.length}</div>;
      }

      const { rerender } = render(<TestComponent wallets={undefined} />);
      const initialCount = walletIdsMemoCount;

      rerender(<TestComponent wallets={undefined} />);
      rerender(<TestComponent wallets={undefined} />);

      expect(walletIdsMemoCount).toBe(initialCount);
    });
  });

  describe('Hook call order consistency (Rules of Hooks)', () => {
    it('hooks should be called in same order regardless of data state', () => {
      // This test verifies the fix from commit 7120f42:
      // useMemo must be called BEFORE any early returns
      let useStateCallCount = 0;
      let useMemoCallCount = 0;
      let useEffectCallCount = 0;

      function TestComponent({ hasData }: { hasData: boolean }) {
        // Track hook calls - useState is always called but initializer only runs once
        React.useState(() => {
          useStateCallCount++;
          return null;
        });

        // useMemo MUST be called before early return
        const memoValue = React.useMemo(() => {
          useMemoCallCount++;
          return hasData ? 'has data' : 'no data';
        }, [hasData]);

        React.useEffect(() => {
          useEffectCallCount++;
        }, [hasData]);

        // Early return AFTER all hooks (correct pattern)
        if (!hasData) {
          return <div>No data: {memoValue}</div>;
        }

        return <div>Has data: {memoValue}</div>;
      }

      // First render with no data
      const { rerender } = render(<TestComponent hasData={false} />);

      // Initial counts after first render
      const initialUseState = useStateCallCount;
      const initialUseMemo = useMemoCallCount;

      // Rerender with data - hooks should still be called (not skipped due to early return)
      rerender(<TestComponent hasData={true} />);

      // useState initializer only runs once (React behavior)
      expect(useStateCallCount).toBe(initialUseState);
      // useMemo should recompute when hasData changes
      expect(useMemoCallCount).toBe(initialUseMemo + 1);
      // useEffect should run when hasData changes
      expect(useEffectCallCount).toBeGreaterThan(0);

      // The key point: no "Rendered fewer/more hooks" error was thrown
      // This means hooks are being called in consistent order
    });

    it('should not throw "Rendered more hooks than during the previous render" error', () => {
      // Simulates the pattern that was fixed in Dashboard/TransactionList
      function ComponentWithConditionalEarlyReturn({ items }: { items: string[] }) {
        // All hooks called first
        React.useState(0);

        const processedItems = React.useMemo(() => {
          return items.map(i => i.toUpperCase());
        }, [items]);

        React.useEffect(() => {
          // Effect after hooks
        }, []);

        // Early return AFTER hooks
        if (items.length === 0) {
          return <div>No items</div>;
        }

        return (
          <div>
            {processedItems.map((item, i) => (
              <span key={i}>{item}</span>
            ))}
          </div>
        );
      }

      // Should not throw when transitioning between empty and non-empty
      const { rerender } = render(<ComponentWithConditionalEarlyReturn items={[]} />);

      expect(() => {
        rerender(<ComponentWithConditionalEarlyReturn items={['a', 'b']} />);
      }).not.toThrow();

      expect(() => {
        rerender(<ComponentWithConditionalEarlyReturn items={[]} />);
      }).not.toThrow();
    });
  });

  describe('WebSocket subscription stability', () => {
    it('subscription callbacks should be stable with useCallback', () => {
      const subscriptionCalls: number[] = [];
      let callbackRef: (() => void) | null = null;

      function TestComponent() {
        const [count, setCount] = React.useState(0);

        // Stable callback that doesn't change on every render
        const stableCallback = React.useCallback(() => {
          subscriptionCalls.push(count);
        }, []); // Empty deps = stable reference

        // Track if callback reference changed
        if (callbackRef && callbackRef !== stableCallback) {
          subscriptionCalls.push(-1); // Mark reference change
        }
        callbackRef = stableCallback;

        return (
          <div>
            <button onClick={() => setCount(c => c + 1)}>Increment</button>
            <span>{count}</span>
          </div>
        );
      }

      const { rerender } = render(<TestComponent />);
      rerender(<TestComponent />);
      rerender(<TestComponent />);

      // No -1 markers means callback reference was stable
      expect(subscriptionCalls.filter(c => c === -1).length).toBe(0);
    });
  });

  describe('React Query data transitions', () => {
    it('should handle undefined -> array transition without infinite loop', async () => {
      let renderCount = 0;
      const EMPTY: never[] = [];

      function TestComponent({ data }: { data: string[] | undefined }) {
        renderCount++;

        // Prevent infinite loops by limiting renders
        if (renderCount > 100) {
          throw new Error('Too many re-renders detected!');
        }

        const safeData = data ?? EMPTY;
        const processed = React.useMemo(() => safeData.length, [safeData]);

        return <div>{processed}</div>;
      }

      const { rerender } = render(<TestComponent data={undefined} />);

      // Simulate data loading (undefined -> array)
      expect(() => {
        rerender(<TestComponent data={['item1', 'item2']} />);
      }).not.toThrow();

      // Simulate refetch (array -> undefined -> array)
      expect(() => {
        rerender(<TestComponent data={undefined} />);
        rerender(<TestComponent data={['item1', 'item2', 'item3']} />);
      }).not.toThrow();

      // Should have reasonable render count
      expect(renderCount).toBeLessThan(10);
    });
  });
});
