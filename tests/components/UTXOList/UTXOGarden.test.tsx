import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UTXOGarden } from '../../../components/UTXOList/UTXOGarden';
import type { UTXO } from '../../../types';

vi.mock('../../../utils/utxoAge', () => ({
  calculateUTXOAge: () => ({ displayText: '5d', category: 'fresh' }),
}));

const format = (sats: number) => `${sats} sats`;

const makeUtxo = (overrides: Partial<UTXO> = {}): UTXO => ({
  txid: 'abc123',
  vout: 0,
  amount: 50000,
  address: 'bc1qtest',
  confirmations: 100,
  date: Date.now() - 86400000 * 5,
  ...overrides,
});

describe('UTXOGarden', () => {
  it('renders circles for each UTXO', () => {
    const utxos = [
      makeUtxo({ txid: 'tx1', vout: 0 }),
      makeUtxo({ txid: 'tx2', vout: 1 }),
    ];

    const { container } = render(
      <UTXOGarden
        utxos={utxos}
        selectedUtxos={new Set()}
        currentFeeRate={1}
        showPrivacy={false}
        format={format}
      />,
    );

    const circles = container.querySelectorAll('.rounded-full');
    // Each UTXO renders a circle + legend circles
    expect(circles.length).toBeGreaterThanOrEqual(2);
  });

  it('renders legend items', () => {
    render(
      <UTXOGarden
        utxos={[makeUtxo()]}
        selectedUtxos={new Set()}
        currentFeeRate={1}
        showPrivacy={false}
        format={format}
      />,
    );

    expect(screen.getByText('Fresh')).toBeInTheDocument();
    expect(screen.getByText('<1mo')).toBeInTheDocument();
    expect(screen.getByText('<1yr')).toBeInTheDocument();
    expect(screen.getByText('Ancient')).toBeInTheDocument();
    expect(screen.getByText('Dust')).toBeInTheDocument();
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Frozen')).toBeInTheDocument();
  });

  it('shows Privacy legend item when showPrivacy is true', () => {
    render(
      <UTXOGarden
        utxos={[makeUtxo()]}
        selectedUtxos={new Set()}
        currentFeeRate={1}
        showPrivacy={true}
        format={format}
      />,
    );

    expect(screen.getByText('Privacy')).toBeInTheDocument();
  });

  it('hides Privacy legend item when showPrivacy is false', () => {
    render(
      <UTXOGarden
        utxos={[makeUtxo()]}
        selectedUtxos={new Set()}
        currentFeeRate={1}
        showPrivacy={false}
        format={format}
      />,
    );

    expect(screen.queryByText('Privacy')).not.toBeInTheDocument();
  });

  it('calls onToggleSelect when a UTXO is clicked', () => {
    const onToggleSelect = vi.fn();
    const utxo = makeUtxo({ txid: 'tx1', vout: 0 });

    const { container } = render(
      <UTXOGarden
        utxos={[utxo]}
        selectedUtxos={new Set()}
        onToggleSelect={onToggleSelect}
        currentFeeRate={1}
        showPrivacy={false}
        format={format}
      />,
    );

    // Click the first UTXO circle (not legend circles)
    const utxoCircles = container.querySelectorAll('.flex-wrap > div');
    fireEvent.click(utxoCircles[0]);
    expect(onToggleSelect).toHaveBeenCalledWith('tx1:0');
  });

  it('does not call onToggleSelect for frozen UTXOs', () => {
    const onToggleSelect = vi.fn();
    const utxo = makeUtxo({ frozen: true });

    const { container } = render(
      <UTXOGarden
        utxos={[utxo]}
        selectedUtxos={new Set()}
        onToggleSelect={onToggleSelect}
        currentFeeRate={1}
        showPrivacy={false}
        format={format}
      />,
    );

    const utxoCircles = container.querySelectorAll('.flex-wrap > div');
    fireEvent.click(utxoCircles[0]);
    expect(onToggleSelect).not.toHaveBeenCalled();
  });

  it('does not call onToggleSelect for locked UTXOs', () => {
    const onToggleSelect = vi.fn();
    const utxo = makeUtxo({ lockedByDraftId: 'draft-1' });

    const { container } = render(
      <UTXOGarden
        utxos={[utxo]}
        selectedUtxos={new Set()}
        onToggleSelect={onToggleSelect}
        currentFeeRate={1}
        showPrivacy={false}
        format={format}
      />,
    );

    const utxoCircles = container.querySelectorAll('.flex-wrap > div');
    fireEvent.click(utxoCircles[0]);
    expect(onToggleSelect).not.toHaveBeenCalled();
  });

  it('includes amount in title attribute', () => {
    const utxo = makeUtxo({ amount: 10000, label: 'Test Label' });

    const { container } = render(
      <UTXOGarden
        utxos={[utxo]}
        selectedUtxos={new Set()}
        currentFeeRate={1}
        showPrivacy={false}
        format={format}
      />,
    );

    const utxoCircles = container.querySelectorAll('.flex-wrap > div');
    expect(utxoCircles[0].getAttribute('title')).toContain('10000 sats');
    expect(utxoCircles[0].getAttribute('title')).toContain('Test Label');
  });

  it('shows Frozen status in title for frozen UTXOs', () => {
    const utxo = makeUtxo({ frozen: true });

    const { container } = render(
      <UTXOGarden
        utxos={[utxo]}
        selectedUtxos={new Set()}
        currentFeeRate={1}
        showPrivacy={false}
        format={format}
      />,
    );

    const utxoCircles = container.querySelectorAll('.flex-wrap > div');
    expect(utxoCircles[0].getAttribute('title')).toContain('(Frozen)');
  });

  it('shows Locked status in title for locked UTXOs', () => {
    const utxo = makeUtxo({ lockedByDraftId: 'draft-1', lockedByDraftLabel: 'My Draft' });

    const { container } = render(
      <UTXOGarden
        utxos={[utxo]}
        selectedUtxos={new Set()}
        currentFeeRate={1}
        showPrivacy={false}
        format={format}
      />,
    );

    const utxoCircles = container.querySelectorAll('.flex-wrap > div');
    expect(utxoCircles[0].getAttribute('title')).toContain('(Locked: My Draft)');
  });
});
