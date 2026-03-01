import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UTXOTab } from '../../../../components/WalletDetail/tabs/UTXOTab';

const capturedProps: Array<Record<string, unknown>> = [];

vi.mock('../../../../components/UTXOList', () => ({
  UTXOList: (props: Record<string, unknown>) => {
    capturedProps.push(props);
    return <div data-testid="utxo-list" />;
  },
}));

const baseProps = {
  utxos: [{ txid: 'tx-1', vout: 0 }] as any[],
  utxoTotalCount: 20,
  onToggleFreeze: vi.fn(),
  userRole: 'editor',
  selectedUtxos: new Set<string>(),
  onToggleSelect: vi.fn(),
  onSendSelected: vi.fn(),
  privacyData: [] as any[],
  privacySummary: null,
  showPrivacy: true,
  network: 'testnet',
  hasMoreUtxos: true,
  onLoadMore: vi.fn(),
  loadingMoreUtxos: false,
};

describe('UTXOTab', () => {
  it('passes interactive props for non-viewer users and normalizes privacySummary', () => {
    render(<UTXOTab {...baseProps} />);

    const props = capturedProps.at(-1) as Record<string, unknown>;
    expect(props.selectable).toBe(true);
    expect(props.onSendSelected).toBe(baseProps.onSendSelected);
    expect(props.privacySummary).toBeUndefined();
  });

  it('disables selection actions for viewer users', () => {
    render(<UTXOTab {...baseProps} userRole="viewer" />);

    const props = capturedProps.at(-1) as Record<string, unknown>;
    expect(props.selectable).toBe(false);
    expect(props.onSendSelected).toBeUndefined();
  });

  it('shows and triggers load more button when additional UTXOs exist', () => {
    const onLoadMore = vi.fn();
    render(<UTXOTab {...baseProps} onLoadMore={onLoadMore} />);

    const button = screen.getByRole('button', { name: 'Load More (1 shown)' });
    fireEvent.click(button);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('shows loading state for load more action', () => {
    render(<UTXOTab {...baseProps} loadingMoreUtxos />);

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('hides load more button when no more results or no utxos are present', () => {
    const { rerender } = render(<UTXOTab {...baseProps} hasMoreUtxos={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(<UTXOTab {...baseProps} utxos={[]} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
