import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UTXORow } from '../../../components/UTXOList/UTXORow';
import type { UTXO } from '../../../types';
import type { UtxoPrivacyInfo } from '../../../src/api/transactions';

vi.mock('../../../components/Amount', () => ({
  Amount: ({ sats }: { sats: number }) => <span data-testid="amount">{sats}</span>,
}));

vi.mock('../../../components/PrivacyBadge', () => ({
  PrivacyBadge: ({ score, onClick }: { score: number; onClick?: () => void }) => (
    <span data-testid="privacy-badge" onClick={onClick}>{score}</span>
  ),
}));

vi.mock('../../../utils/explorer', () => ({
  getAddressExplorerUrl: (addr: string) => `https://explorer.test/address/${addr}`,
  getTxExplorerUrl: (txid: string) => `https://explorer.test/tx/${txid}`,
}));

vi.mock('../../../utils/utxoAge', () => ({
  calculateUTXOAge: () => ({ displayText: '3d', category: 'fresh' }),
  getAgeCategoryColor: () => 'text-green-500',
}));

const format = (sats: number) => `${sats} sats`;

const makeUtxo = (overrides: Partial<UTXO> = {}): UTXO => ({
  txid: 'abc123def456',
  vout: 0,
  amount: 50000,
  address: 'bc1qtest123',
  confirmations: 100,
  ...overrides,
});

const defaultProps = {
  utxo: makeUtxo(),
  isSelected: false,
  selectable: true,
  onToggleSelect: vi.fn(),
  onToggleFreeze: vi.fn(),
  onShowPrivacyDetail: vi.fn(),
  showPrivacy: false,
  privacyInfo: undefined as UtxoPrivacyInfo | undefined,
  currentFeeRate: 1,
  network: 'mainnet',
  explorerUrl: 'https://explorer.test',
  format,
};

const renderRow = (overrides: Partial<typeof defaultProps> = {}) =>
  render(<UTXORow {...defaultProps} {...overrides} />);

describe('UTXORow', () => {
  it('renders amount and address', () => {
    renderRow();

    expect(screen.getByTestId('amount')).toHaveTextContent('50000');
    expect(screen.getByText('bc1qtest123')).toBeInTheDocument();
  });

  it('renders confirmation count', () => {
    renderRow();
    expect(screen.getByText('100 confs')).toBeInTheDocument();
  });

  it('renders age text', () => {
    renderRow();
    expect(screen.getByText('3d')).toBeInTheDocument();
  });

  it('renders truncated txid link', () => {
    renderRow();
    expect(screen.getByText(/txid:abc123de/)).toBeInTheDocument();
  });

  it('shows checkbox when selectable and not disabled', () => {
    const onToggleSelect = vi.fn();
    const { container } = renderRow({ onToggleSelect });

    const checkbox = container.querySelector('.cursor-pointer.w-5.h-5');
    expect(checkbox).toBeInTheDocument();
    fireEvent.click(checkbox!);
    expect(onToggleSelect).toHaveBeenCalledWith('abc123def456:0');
  });

  it('shows selected checkbox styling without requiring a selection callback', () => {
    const { container } = renderRow({ isSelected: true, onToggleSelect: undefined });

    const checkbox = container.querySelector('.cursor-pointer.w-5.h-5');
    expect(checkbox).toHaveClass('bg-sanctuary-800');
    expect(container.querySelector('.bg-zen-gold\\/10')).toBeInTheDocument();
    expect(() => fireEvent.click(checkbox!)).not.toThrow();
  });

  it('hides checkbox when not selectable', () => {
    const { container } = renderRow({ selectable: false });
    expect(container.querySelector('.w-5.h-5.rounded.border.cursor-pointer')).not.toBeInTheDocument();
  });

  it('hides checkbox when frozen', () => {
    const { container } = renderRow({ utxo: makeUtxo({ frozen: true }) });
    expect(container.querySelector('.w-5.h-5.rounded.border.cursor-pointer')).not.toBeInTheDocument();
  });

  it('renders freeze/unfreeze button', () => {
    const onToggleFreeze = vi.fn();
    renderRow({ onToggleFreeze });

    const freezeBtn = screen.getByTitle('Freeze coin to prevent spending');
    fireEvent.click(freezeBtn);
    expect(onToggleFreeze).toHaveBeenCalledWith('abc123def456', 0);
  });

  it('renders unfreeze button for frozen UTXOs', () => {
    renderRow({ utxo: makeUtxo({ frozen: true }) });
    expect(screen.getByTitle('Unfreeze coin for spending')).toBeInTheDocument();
  });

  it('shows DUST badge for dust UTXOs', () => {
    // With high fee rate, 50000 sats UTXO could be dust if fee is very high
    // native_segwit: 68 * 1000 = 68000 > 50000 = dust
    renderRow({ currentFeeRate: 1000, utxo: makeUtxo({ amount: 500 }) });
    expect(screen.getByText('DUST')).toBeInTheDocument();
    expect(screen.getByTitle('Costs 68000 sats to spend at current fees')).toBeInTheDocument();
  });

  it('does not show DUST badge for non-dust UTXOs', () => {
    renderRow({ currentFeeRate: 1 });
    expect(screen.queryByText('DUST')).not.toBeInTheDocument();
  });

  it('renders label badge when utxo has a label', () => {
    renderRow({ utxo: makeUtxo({ label: 'Exchange deposit' }) });
    expect(screen.getByText('Exchange deposit')).toBeInTheDocument();
  });

  it('renders locked badge for draft-locked UTXOs', () => {
    renderRow({ utxo: makeUtxo({ lockedByDraftId: 'draft-1', lockedByDraftLabel: 'My Draft' }) });
    expect(screen.getByText('My Draft')).toBeInTheDocument();
  });

  it('renders default locked label when draft label is empty', () => {
    renderRow({ utxo: makeUtxo({ lockedByDraftId: 'draft-1' }) });
    expect(screen.getByText('Pending Draft')).toBeInTheDocument();
  });

  it('renders privacy badge when showPrivacy is true and privacyInfo exists', () => {
    renderRow({
      showPrivacy: true,
      privacyInfo: { score: { score: 75, grade: 'good' as any }, flags: [] } as any,
    });
    expect(screen.getByTestId('privacy-badge')).toBeInTheDocument();
  });

  it('does not render privacy badge when showPrivacy is false', () => {
    renderRow({
      showPrivacy: false,
      privacyInfo: { score: { score: 75, grade: 'good' as any }, flags: [] } as any,
    });
    expect(screen.queryByTestId('privacy-badge')).not.toBeInTheDocument();
  });

  it('does not render privacy badge when privacy info is missing', () => {
    renderRow({ showPrivacy: true, privacyInfo: undefined });
    expect(screen.queryByTestId('privacy-badge')).not.toBeInTheDocument();
  });

  it('calls onShowPrivacyDetail when privacy badge is clicked', () => {
    const onShowPrivacyDetail = vi.fn();
    renderRow({
      showPrivacy: true,
      privacyInfo: { score: { score: 75, grade: 'good' as any }, flags: [] } as any,
      onShowPrivacyDetail,
    });

    fireEvent.click(screen.getByTestId('privacy-badge'));
    expect(onShowPrivacyDetail).toHaveBeenCalledWith('abc123def456:0');
  });

  it('keeps frozen styling priority while still showing locked draft context', () => {
    const { container } = renderRow({
      utxo: makeUtxo({
        frozen: true,
        lockedByDraftId: 'draft-1',
        lockedByDraftLabel: 'My Draft',
      }),
    });

    expect(container.querySelector('.bg-zen-vermilion\\/5')).toBeInTheDocument();
    expect(screen.getByText('My Draft')).toBeInTheDocument();
  });
});
