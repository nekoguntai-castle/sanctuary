/**
 * WalletStats Component Tests
 *
 * Tests for the wallet statistics display component including
 * balance, UTXO stats, age distribution, and accumulation history.
 */

import { render,screen } from '@testing-library/react';
import React from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { WalletStats } from '../../components/WalletStats';
import { useCurrency } from '../../contexts/CurrencyContext';
import type { Transaction,UTXO } from '../../types';

// Mock the CurrencyContext
vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: vi.fn(() => ({
    getFiatValue: vi.fn((sats: number) => sats / 100_000),
    btcPrice: 50000,
    currencySymbol: '$',
    fiatCurrency: 'USD',
    showFiat: true,
    format: vi.fn((sats: number) => {
      const btc = sats / 100_000_000;
      return `${btc.toFixed(8)} BTC`;
    }),
  })),
}));

// Mock useDelayedRender to return true immediately
vi.mock('../../hooks/useDelayedRender', () => ({
  useDelayedRender: vi.fn(() => true),
}));

// Mock recharts components to avoid rendering issues
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <svg data-testid="area-chart">{children}</svg>
  ),
  Area: () => <div data-testid="area" />,
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <svg data-testid="bar-chart">{children}</svg>
  ),
  Bar: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar">{children}</div>
  ),
  Cell: () => <div data-testid="cell" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  Tooltip: ({ formatter }: { formatter?: (value: number) => unknown }) => {
    if (typeof formatter === 'function') {
      formatter(123456789);
    }
    return <div data-testid="tooltip" />;
  },
}));

describe('WalletStats', () => {
  const createCurrencyContext = (
    overrides: Partial<ReturnType<typeof useCurrency>> = {}
  ): ReturnType<typeof useCurrency> => ({
    showFiat: true,
    toggleShowFiat: vi.fn(),
    fiatCurrency: 'USD',
    setFiatCurrency: vi.fn(),
    unit: 'btc',
    setUnit: vi.fn(),
    btcPrice: 50000,
    priceChange24h: null,
    currencySymbol: '$',
    format: vi.fn((sats: number) => {
      const btc = sats / 100_000_000;
      return `${btc.toFixed(8)} BTC`;
    }),
    formatFiat: vi.fn((sats: number) => `$${(sats / 100_000).toLocaleString()}`),
    getFiatValue: vi.fn((sats: number) => sats / 100_000),
    formatFiatPrice: vi.fn((price: number | null) => (price === null ? '-----' : `$${price.toLocaleString()}`)),
    priceLoading: false,
    priceError: null,
    lastPriceUpdate: new Date(),
    refreshPrice: vi.fn(async () => {}),
    priceProvider: 'auto',
    setPriceProvider: vi.fn(),
    availableProviders: ['auto'],
    ...overrides,
  });

  const makeTransaction = (
    overrides: Partial<Transaction> & Pick<Transaction, 'txid' | 'amount' | 'confirmations'>
  ): Transaction => ({
    id: `tx-${overrides.txid}`,
    walletId: 'wallet-1',
    type: 'receive',
    fee: 0,
    timestamp: Date.now(),
    ...overrides,
  });

  const mockUtxos: UTXO[] = [
    {
      txid: 'tx1',
      vout: 0,
      amount: 50000000, // 0.5 BTC
      date: Date.now() - 10 * 24 * 60 * 60 * 1000, // 10 days ago
      address: 'bc1q...',
      scriptPubKey: '',
      confirmations: 100,
    },
    {
      txid: 'tx2',
      vout: 1,
      amount: 30000000, // 0.3 BTC
      date: Date.now() - 100 * 24 * 60 * 60 * 1000, // 100 days ago
      address: 'bc1q...',
      scriptPubKey: '',
      confirmations: 500,
    },
    {
      txid: 'tx3',
      vout: 0,
      amount: 20000000, // 0.2 BTC
      date: Date.now() - 400 * 24 * 60 * 60 * 1000, // 400 days ago
      address: 'bc1q...',
      scriptPubKey: '',
      confirmations: 2000,
    },
  ];

  const mockTransactions: Transaction[] = [
    makeTransaction({
      txid: 'tx1',
      amount: 50000000,
      fee: 0,
      timestamp: Date.now() - 10 * 24 * 60 * 60 * 1000,
      confirmations: 100,
      balanceAfter: 100000000,
    }),
    makeTransaction({
      txid: 'tx2',
      amount: 30000000,
      fee: 0,
      timestamp: Date.now() - 100 * 24 * 60 * 60 * 1000,
      confirmations: 500,
      balanceAfter: 50000000,
    }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCurrency).mockReturnValue(createCurrencyContext());
  });

  describe('rendering', () => {
    it('should render stats cards', () => {
      render(
        <WalletStats
          utxos={mockUtxos}
          balance={100000000}
          transactions={mockTransactions}
        />
      );

      expect(screen.getByText('USD Value')).toBeInTheDocument();
      expect(screen.getByText('UTXO Count')).toBeInTheDocument();
      expect(screen.getByText('Avg UTXO Age')).toBeInTheDocument();
      expect(screen.getByText('First Activity')).toBeInTheDocument();
    });

    it('should render charts', () => {
      render(
        <WalletStats
          utxos={mockUtxos}
          balance={100000000}
          transactions={mockTransactions}
        />
      );

      expect(screen.getByText('Accumulation History')).toBeInTheDocument();
      expect(screen.getByText('UTXO Age Distribution')).toBeInTheDocument();
      expect(screen.getByTestId('area-chart')).toBeInTheDocument();
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });
  });

  describe('balance display', () => {
    it('should display fiat balance when showFiat is true', () => {
      render(
        <WalletStats
          utxos={mockUtxos}
          balance={100000000}
          transactions={[]}
        />
      );

      // Balance of 100000000 sats = $1000 (with mock rate of 1 sat = $0.00001)
      expect(screen.getByText('$1,000')).toBeInTheDocument();
    });

    it('should display BTC price info', () => {
      render(
        <WalletStats
          utxos={mockUtxos}
          balance={100000000}
          transactions={[]}
        />
      );

      expect(screen.getByText('@ $50,000/BTC')).toBeInTheDocument();
    });
  });

  describe('UTXO count', () => {
    it('should display correct UTXO count', () => {
      render(
        <WalletStats
          utxos={mockUtxos}
          balance={100000000}
          transactions={[]}
        />
      );

      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('Unspent Outputs')).toBeInTheDocument();
    });

    it('should display 0 for empty UTXO set', () => {
      render(
        <WalletStats
          utxos={[]}
          balance={0}
          transactions={[]}
        />
      );

      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });

  describe('average UTXO age', () => {
    it('should display average age in days for recent UTXOs', () => {
      const recentUtxos: UTXO[] = [
        {
          txid: 'tx1',
          vout: 0,
          amount: 50000000,
          date: Date.now() - 5 * 24 * 60 * 60 * 1000, // 5 days ago
          address: 'bc1q...',
          scriptPubKey: '',
          confirmations: 50,
        },
        {
          txid: 'tx2',
          vout: 0,
          amount: 50000000,
          date: Date.now() - 15 * 24 * 60 * 60 * 1000, // 15 days ago
          address: 'bc1q...',
          scriptPubKey: '',
          confirmations: 150,
        },
      ];

      render(
        <WalletStats
          utxos={recentUtxos}
          balance={100000000}
          transactions={[]}
        />
      );

      // Average: (5 + 15) / 2 = 10 days
      expect(screen.getByText('10')).toBeInTheDocument();
      expect(screen.getByText('days')).toBeInTheDocument();
    });

    it('should display "No UTXOs" when empty', () => {
      render(
        <WalletStats
          utxos={[]}
          balance={0}
          transactions={[]}
        />
      );

      expect(screen.getByText('No UTXOs')).toBeInTheDocument();
    });

    it('should display age in months for older UTXOs', () => {
      const olderUtxos: UTXO[] = [
        {
          txid: 'tx1',
          vout: 0,
          amount: 50000000,
          date: Date.now() - 90 * 24 * 60 * 60 * 1000, // 90 days ago
          address: 'bc1q...',
          scriptPubKey: '',
          confirmations: 500,
        },
      ];

      render(
        <WalletStats
          utxos={olderUtxos}
          balance={50000000}
          transactions={[]}
        />
      );

      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('months')).toBeInTheDocument();
    });

    it('should display age in years for very old UTXOs', () => {
      const veryOldUtxos: UTXO[] = [
        {
          txid: 'tx1',
          vout: 0,
          amount: 50000000,
          date: Date.now() - 800 * 24 * 60 * 60 * 1000, // ~2.2 years ago
          address: 'bc1q...',
          scriptPubKey: '',
          confirmations: 5000,
        },
      ];

      render(
        <WalletStats
          utxos={veryOldUtxos}
          balance={50000000}
          transactions={[]}
        />
      );

      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('years')).toBeInTheDocument();
    });

    it('should display fractional years for UTXOs between one and two years old', () => {
      const somewhatOldUtxos: UTXO[] = [
        {
          txid: 'tx1',
          vout: 0,
          amount: 50000000,
          date: Date.now() - 500 * 24 * 60 * 60 * 1000, // ~1.4 years ago
          address: 'bc1q...',
          scriptPubKey: '',
          confirmations: 3000,
        },
      ];

      render(
        <WalletStats
          utxos={somewhatOldUtxos}
          balance={50000000}
          transactions={[]}
        />
      );

      expect(screen.getByText('1.4')).toBeInTheDocument();
      expect(screen.getByText('years')).toBeInTheDocument();
    });
  });

  describe('first activity', () => {
    it('should display first activity date', () => {
      const oldestTimestamp = Date.now() - 100 * 24 * 60 * 60 * 1000;
      const transactions: Transaction[] = [
        makeTransaction({
          txid: 'tx1',
          amount: 50000000,
          fee: 0,
          timestamp: oldestTimestamp,
          confirmations: 500,
        }),
        makeTransaction({
          txid: 'tx2',
          amount: 30000000,
          fee: 0,
          timestamp: Date.now() - 10 * 24 * 60 * 60 * 1000,
          confirmations: 100,
        }),
      ];

      render(
        <WalletStats
          utxos={mockUtxos}
          balance={100000000}
          transactions={transactions}
        />
      );

      const expectedDate = new Date(oldestTimestamp);
      const expectedText = expectedDate.toLocaleDateString(undefined, {
        month: 'short',
        year: 'numeric',
      });

      expect(screen.getByText(expectedText)).toBeInTheDocument();
    });

    it('should display "No transactions" when empty', () => {
      render(
        <WalletStats
          utxos={[]}
          balance={0}
          transactions={[]}
        />
      );

      expect(screen.getByText('No transactions')).toBeInTheDocument();
    });
  });

  describe('with empty data', () => {
    it('should handle empty UTXOs and transactions gracefully', () => {
      render(
        <WalletStats
          utxos={[]}
          balance={0}
          transactions={[]}
        />
      );

      expect(screen.getByText('$0')).toBeInTheDocument();
      expect(screen.getByText('0')).toBeInTheDocument();
      expect(screen.getByText('No UTXOs')).toBeInTheDocument();
      expect(screen.getByText('No transactions')).toBeInTheDocument();
    });
  });

  describe('UTXO age distribution', () => {
    it('should categorize UTXOs by age', () => {
      // This tests the internal age categorization logic
      // < 1 month, 1-6 months, 6-12 months, > 1 year
      const diverseUtxos: UTXO[] = [
        {
          txid: 'recent',
          vout: 0,
          amount: 10000000,
          date: Date.now() - 15 * 24 * 60 * 60 * 1000, // 15 days (< 1m)
          address: 'bc1q...',
          scriptPubKey: '',
          confirmations: 100,
        },
        {
          txid: 'medium1',
          vout: 0,
          amount: 20000000,
          date: Date.now() - 90 * 24 * 60 * 60 * 1000, // 90 days (1-6m)
          address: 'bc1q...',
          scriptPubKey: '',
          confirmations: 500,
        },
        {
          txid: 'medium2',
          vout: 0,
          amount: 30000000,
          date: Date.now() - 270 * 24 * 60 * 60 * 1000, // 270 days (6-12m)
          address: 'bc1q...',
          scriptPubKey: '',
          confirmations: 1500,
        },
        {
          txid: 'old',
          vout: 0,
          amount: 40000000,
          date: Date.now() - 500 * 24 * 60 * 60 * 1000, // 500 days (> 1y)
          address: 'bc1q...',
          scriptPubKey: '',
          confirmations: 3000,
        },
      ];

      render(
        <WalletStats
          utxos={diverseUtxos}
          balance={100000000}
          transactions={[]}
        />
      );

      // Charts should be rendered
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });
  });

  describe('date handling', () => {
    it('should handle string dates', () => {
      const utxosWithStringDates: UTXO[] = [
        {
          txid: 'tx1',
          vout: 0,
          amount: 50000000,
          date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() as any,
          address: 'bc1q...',
          scriptPubKey: '',
          confirmations: 100,
        },
      ];

      render(
        <WalletStats
          utxos={utxosWithStringDates}
          balance={50000000}
          transactions={[]}
        />
      );

      expect(screen.getByText('10')).toBeInTheDocument();
      expect(screen.getByText('days')).toBeInTheDocument();
    });

    it('should handle missing dates', () => {
      const utxosWithMissingDates: UTXO[] = [
        {
          txid: 'tx1',
          vout: 0,
          amount: 50000000,
          date: undefined as any,
          address: 'bc1q...',
          scriptPubKey: '',
          confirmations: 100,
        },
      ];

      render(
        <WalletStats
          utxos={utxosWithMissingDates}
          balance={50000000}
          transactions={[]}
        />
      );

      // Should fall back to current time, so 0 days
      expect(screen.getByText('0')).toBeInTheDocument();
      expect(screen.getByText('days')).toBeInTheDocument();
    });
  });

  describe('fiat and accumulation variants', () => {
    const createTransactions = (oldestDaysAgo: number): Transaction[] => [
      makeTransaction({
        txid: 'oldest',
        amount: 10000000,
        fee: 0,
        timestamp: Date.now() - oldestDaysAgo * 24 * 60 * 60 * 1000,
        confirmations: 100,
        balanceAfter: 10000000,
      }),
      makeTransaction({
        txid: 'latest',
        amount: 5000000,
        fee: 0,
        timestamp: Date.now() - 1 * 24 * 60 * 60 * 1000,
        confirmations: 10,
        balanceAfter: 15000000,
      }),
    ];

    it('should render BTC-only mode when fiat display is disabled', () => {
      vi.mocked(useCurrency).mockReturnValue(
        createCurrencyContext({
          showFiat: false,
          format: vi.fn(() => '1.00000000 BTC (formatted)'),
        })
      );

      render(
        <WalletStats
          utxos={mockUtxos}
          balance={100000000}
          transactions={[]}
        />
      );

      expect(screen.getByText('BTC Value')).toBeInTheDocument();
      expect(screen.getByText('1.00000000 BTC')).toBeInTheDocument();
      expect(screen.getByText('Current Holdings')).toBeInTheDocument();
    });

    it('should fall back to 0 when getFiatValue returns null', () => {
      vi.mocked(useCurrency).mockReturnValue(
        createCurrencyContext({
          getFiatValue: vi.fn(() => null),
        })
      );

      render(
        <WalletStats
          utxos={mockUtxos}
          balance={100000000}
          transactions={[]}
        />
      );

      // fiatBalance should be 0 when getFiatValue returns null
      expect(screen.getByText('$0')).toBeInTheDocument();
    });

    it('should show loading text when fiat mode has no BTC price yet', () => {
      vi.mocked(useCurrency).mockReturnValue(
        createCurrencyContext({
          btcPrice: null,
        })
      );

      render(
        <WalletStats
          utxos={mockUtxos}
          balance={100000000}
          transactions={[]}
        />
      );

      expect(screen.getByText('Loading price...')).toBeInTheDocument();
    });

    it('should build accumulation labels for short history spans', () => {
      render(
        <WalletStats
          utxos={mockUtxos}
          balance={15000000}
          transactions={createTransactions(7)}
        />
      );

      expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    });

    it('should build accumulation labels for medium history spans', () => {
      render(
        <WalletStats
          utxos={mockUtxos}
          balance={15000000}
          transactions={createTransactions(400)}
        />
      );

      expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    });

    it('should build accumulation labels for long history spans', () => {
      render(
        <WalletStats
          utxos={mockUtxos}
          balance={15000000}
          transactions={createTransactions(900)}
        />
      );

      expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    });
  });
});
