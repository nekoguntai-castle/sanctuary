import { render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { StatsTab } from '../../../../src/components/WalletDetail/tabs/StatsTab';

const mockRefs = vi.hoisted(() => ({
  walletStatsProps: null as any,
}));

vi.mock('../../../../src/components/WalletStats', () => ({
  WalletStats: (props: any) => {
    mockRefs.walletStatsProps = props;
    return <div data-testid="wallet-stats" />;
  },
}));

describe('StatsTab', () => {
  it('passes UTXOs, balance, and transactions to WalletStats', () => {
    const utxos = [{ id: 'u1', txid: 'abc', amount: 1000 } as any];
    const transactions = [{ id: 't1', txid: 'def', amount: -200 } as any];

    render(<StatsTab utxos={utxos} balance={50000} transactions={transactions} />);

    expect(screen.getByTestId('wallet-stats')).toBeInTheDocument();
    expect(mockRefs.walletStatsProps.utxos).toBe(utxos);
    expect(mockRefs.walletStatsProps.balance).toBe(50000);
    expect(mockRefs.walletStatsProps.transactions).toBe(transactions);
  });
});
