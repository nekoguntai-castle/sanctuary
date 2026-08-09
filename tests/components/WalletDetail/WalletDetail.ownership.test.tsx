import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WalletDetail } from '../../../src/components/WalletDetail/WalletDetail';

const state = vi.hoisted(() => ({
  controller: {
    id: 'wallet-A',
    wallet: { id: 'wallet-A', name: 'Wallet A' },
    loading: false,
    error: null,
    setError: vi.fn(),
    fetchData: vi.fn(),
  } as any,
}));

vi.mock('../../../src/components/WalletDetail/useWalletDetailController', () => ({
  useWalletDetailController: () => state.controller,
}));
vi.mock('../../../src/components/WalletDetail/WalletDetailLoadedView', () => ({
  WalletDetailLoadedView: ({ wallet }: { wallet: { id: string } }) => (
    <div data-testid="loaded-wallet">{wallet.id}</div>
  ),
}));

describe('WalletDetail render ownership', () => {
  it('withholds wallet A immediately when the route changes to wallet B', () => {
    const view = render(<WalletDetail />);
    expect(screen.getByTestId('loaded-wallet')).toHaveTextContent('wallet-A');

    state.controller = { ...state.controller, id: 'wallet-B' };
    view.rerender(<WalletDetail />);

    expect(screen.queryByTestId('loaded-wallet')).not.toBeInTheDocument();
    expect(screen.getByText('Loading wallet...')).toBeInTheDocument();
  });
});
