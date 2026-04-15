import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { UTXOList } from '../../components/UTXOList';
import * as currencyContext from '../../contexts/CurrencyContext';
import * as bitcoinHooks from '../../hooks/queries/useBitcoin';
import * as bitcoinApi from '../../src/api/bitcoin';

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: vi.fn(),
}));

vi.mock('../../hooks/queries/useBitcoin', () => ({
  useFeeEstimates: vi.fn(),
}));

vi.mock('../../src/api/bitcoin', () => ({
  getStatus: vi.fn(),
}));

vi.mock('../../components/Amount', () => ({
  Amount: ({ sats }: { sats: number }) => <span>{sats}</span>,
}));

vi.mock('../../components/PrivacyBadge', () => ({
  PrivacyBadge: ({
    score,
    onClick,
  }: {
    score: number;
    onClick?: () => void;
  }) => (
    <button data-testid={`privacy-badge-${score}`} onClick={onClick}>
      privacy-{score}
    </button>
  ),
}));

vi.mock('../../components/PrivacyDetailPanel', () => ({
  PrivacyDetailPanel: ({
    utxo,
    onClose,
  }: {
    utxo: { txid: string; vout: number };
    onClose?: () => void;
  }) => (
    <div data-testid="privacy-detail">
      {utxo.txid}:{utxo.vout}
      <button onClick={onClose}>close-privacy</button>
    </div>
  ),
}));

describe('UTXOList branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(currencyContext.useCurrency).mockReturnValue({
      format: (sats: number) => `${sats} sats`,
      unit: 'sats',
    } as any);
    vi.mocked(bitcoinHooks.useFeeEstimates).mockReturnValue({ data: { hour: 10 } } as any);
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({ explorerUrl: 'https://mempool.space' } as any);
  });

  it('uses fallback fee/explorer branches and displays totalCount subset', async () => {
    vi.mocked(bitcoinHooks.useFeeEstimates).mockReturnValue({ data: undefined } as any);
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({} as any);
    const onToggleSelect = vi.fn();

    render(
      <UTXOList
        utxos={[
          {
            txid: 'dust',
            vout: 0,
            address: 'bc1qdust',
            amount: 10,
            confirmations: 2,
            frozen: false,
            spent: false,
            scriptType: 'unknown_script' as any,
          },
        ]}
        totalCount={3}
        onToggleFreeze={vi.fn()}
        selectable
        selectedUtxos={new Set()}
        onToggleSelect={onToggleSelect}
      />
    );

    expect(screen.getByText('1 of 3 UTXOs')).toBeInTheDocument();
    expect(screen.getByText(/1 dust UTXO/)).toBeInTheDocument();
    expect(screen.getByText(/1\.0 sat\/vB/)).toBeInTheDocument();

    const addressLink = screen.getByRole('link', { name: /bc1qdust/i });
    expect(addressLink.getAttribute('href')).toContain('https://mempool.space/address/');

    const clickableDot = document.querySelector('div[title*="No Label"]');
    expect(clickableDot).not.toBeNull();
    fireEvent.click(clickableDot!);
    expect(onToggleSelect).toHaveBeenCalledWith('dust:0');

    await waitFor(() => {
      expect(bitcoinApi.getStatus).toHaveBeenCalledTimes(1);
    });
  });

  it('invokes address and tx explorer link click handlers without toggling selection', () => {
    const onToggleSelect = vi.fn();

    render(
      <UTXOList
        utxos={[
          {
            txid: 'tx-link',
            vout: 1,
            address: 'bc1qlink',
            amount: 10000,
            confirmations: 12,
            frozen: false,
            spent: false,
            scriptType: 'native_segwit' as any,
          },
        ] as any}
        onToggleFreeze={vi.fn()}
        selectable
        selectedUtxos={new Set()}
        onToggleSelect={onToggleSelect}
      />
    );

    fireEvent.click(screen.getByRole('link', { name: /bc1qlink/i }));
    fireEvent.click(screen.getByRole('link', { name: /txid:tx-link/i }));
    expect(onToggleSelect).not.toHaveBeenCalled();
  });

  it('covers age color buckets, plural dust banner, and disabled select guards', () => {
    const now = Date.now();
    const onToggleSelect = vi.fn();
    const { container } = render(
      <UTXOList
        utxos={[
          {
            txid: 'fresh',
            vout: 0,
            address: 'bc1qfresh',
            amount: 10000,
            confirmations: 1,
            frozen: false,
            spent: false,
            date: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
          },
          {
            txid: 'month',
            vout: 0,
            address: 'bc1qmonth',
            amount: 10000,
            confirmations: 100,
            frozen: false,
            spent: false,
            date: now - 10 * 24 * 60 * 60 * 1000,
          },
          {
            txid: 'year',
            vout: 0,
            address: 'bc1qyear',
            amount: 10000,
            confirmations: 1000,
            frozen: false,
            spent: false,
            date: new Date(now - 200 * 24 * 60 * 60 * 1000).toISOString(),
          },
          {
            txid: 'ancient',
            vout: 0,
            address: 'bc1qancient',
            amount: 10000,
            confirmations: 4000,
            frozen: false,
            spent: false,
            date: now - 500 * 24 * 60 * 60 * 1000,
          },
          {
            txid: 'dust-a',
            vout: 1,
            address: 'bc1qdusta',
            amount: 10,
            confirmations: 2,
            frozen: false,
            spent: false,
            date: new Date().toISOString(),
          },
          {
            txid: 'dust-b',
            vout: 2,
            address: 'bc1qdustb',
            amount: 20,
            confirmations: 2,
            frozen: false,
            spent: false,
            date: new Date().toISOString(),
          },
          {
            txid: 'frozen',
            vout: 0,
            address: 'bc1qfrozen',
            amount: 10000,
            confirmations: 12,
            frozen: true,
            spent: false,
            date: new Date().toISOString(),
          },
          {
            txid: 'locked',
            vout: 0,
            address: 'bc1qlocked',
            amount: 10000,
            confirmations: 12,
            frozen: false,
            spent: false,
            lockedByDraftId: 'd1',
            lockedByDraftLabel: 'Draft One',
            date: new Date().toISOString(),
          },
        ] as any}
        onToggleFreeze={vi.fn()}
        selectable
        selectedUtxos={new Set()}
        onToggleSelect={onToggleSelect}
      />
    );

    expect(screen.getByText(/2 dust UTXOs/)).toBeInTheDocument();
    expect(container.querySelector('.bg-zen-matcha')).toBeInTheDocument();
    expect(container.querySelector('.bg-zen-indigo')).toBeInTheDocument();
    expect(container.querySelector('.bg-zen-gold')).toBeInTheDocument();
    expect(container.querySelector('.bg-sanctuary-700')).toBeInTheDocument();

    const frozenDot = container.querySelector('div[title*="(Frozen)"]');
    const lockedDot = container.querySelector('div[title*="(Locked: Draft One)"]');
    expect(frozenDot).not.toBeNull();
    expect(lockedDot).not.toBeNull();
    fireEvent.click(frozenDot!);
    fireEvent.click(lockedDot!);
    expect(onToggleSelect).not.toHaveBeenCalledWith('frozen:0');
    expect(onToggleSelect).not.toHaveBeenCalledWith('locked:0');
  });

  it('covers privacy summary grade branches and privacy detail panel fallback', () => {
    const utxos = [
      {
        txid: 'with-privacy',
        vout: 0,
        address: 'bc1qprivacy',
        amount: 90000,
        confirmations: 30,
        frozen: false,
        spent: false,
        date: new Date().toISOString(),
      },
    ];
    const { rerender } = render(
      <UTXOList
        utxos={utxos as any}
        onToggleFreeze={vi.fn()}
        showPrivacy
        privacyData={[
          {
            txid: 'with-privacy',
            vout: 0,
            score: { score: 61, grade: 'good' },
          },
        ] as any}
        privacySummary={{
          averageScore: 61,
          grade: 'good',
          recommendations: ['Use coin control'],
        } as any}
      />
    );

    fireEvent.click(screen.getByTestId('privacy-badge-61'));
    expect(screen.getByTestId('privacy-detail')).toHaveTextContent('with-privacy:0');
    fireEvent.click(screen.getByText('close-privacy'));
    expect(screen.queryByTestId('privacy-detail')).not.toBeInTheDocument();

    rerender(
      <UTXOList
        utxos={utxos as any}
        onToggleFreeze={vi.fn()}
        showPrivacy
        privacyData={[
          {
            txid: 'with-privacy',
            vout: 0,
            score: { score: 61, grade: 'good' },
          },
        ] as any}
      />
    );
    fireEvent.click(screen.getByTestId('privacy-badge-61'));
    expect(screen.getByTestId('privacy-detail')).toHaveTextContent('with-privacy:0');

    rerender(
      <UTXOList
        utxos={[] as any}
        onToggleFreeze={vi.fn()}
        showPrivacy
        privacyData={[
          {
            txid: 'with-privacy',
            vout: 0,
            score: { score: 61, grade: 'good' },
          },
        ] as any}
      />
    );
    expect(screen.queryByTestId('privacy-detail')).not.toBeInTheDocument();

    rerender(
      <UTXOList
        utxos={utxos as any}
        onToggleFreeze={vi.fn()}
        showPrivacy
        privacyData={undefined}
        privacySummary={{
          averageScore: 44,
          grade: 'fair',
          recommendations: [],
        } as any}
      />
    );
    expect(screen.queryByTestId('privacy-detail')).not.toBeInTheDocument();

    rerender(
      <UTXOList
        utxos={utxos as any}
        onToggleFreeze={vi.fn()}
        showPrivacy
        privacySummary={{
          averageScore: 22,
          grade: 'poor',
          recommendations: ['Avoid merging UTXOs'],
        } as any}
      />
    );
    expect(screen.getByText('Avoid merging UTXOs')).toBeInTheDocument();

    rerender(
      <UTXOList
        utxos={utxos as any}
        onToggleFreeze={vi.fn()}
        showPrivacy
        privacySummary={{
          averageScore: 93,
          grade: 'excellent',
          recommendations: [],
        } as any}
      />
    );
    expect(screen.getByText(/Wallet Privacy Score: 93/)).toBeInTheDocument();
    expect(screen.getByText('excellent')).toBeInTheDocument();
  });

  it('covers explorer URL fetch failure path', async () => {
    vi.mocked(bitcoinApi.getStatus).mockRejectedValueOnce(new Error('status failed'));

    render(
      <UTXOList
        utxos={[
          {
            txid: 'status-fail',
            vout: 0,
            address: 'bc1qstatus',
            amount: 1000,
            confirmations: 1,
            frozen: false,
            spent: false,
          },
        ] as any}
        onToggleFreeze={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(bitcoinApi.getStatus).toHaveBeenCalled();
    });
  });
});
