import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WalletDetailController } from '../../../src/components/WalletDetail/useWalletDetailController';
import { WalletDetailLoadedView } from '../../../src/components/WalletDetail/WalletDetailLoadedView';

const captured = vi.hoisted(() => ({
  transactionsTabProps: null as null | { ownershipKey: string; walletId: string },
  settingsTabProps: null as null | { onRemediationApplied: () => void },
  onSend: null as null | (() => void),
}));

vi.mock('../../../src/components/WalletDetail/WalletHeader', () => ({
  WalletHeader: (props: { onSend: () => void }) => {
    captured.onSend = props.onSend;
    return null;
  },
}));
vi.mock('../../../src/components/WalletDetail/TabBar', () => ({
  TabBar: () => null,
}));
vi.mock('../../../src/components/WalletDetail/WalletDetailModals', () => ({
  WalletDetailModals: () => null,
}));
vi.mock('../../../src/components/WalletDetail/WalletDetailTabContent', () => ({
  WalletDetailTabContent: (props: {
    transactionsTabProps: { ownershipKey: string; walletId: string };
    settingsTabProps: { onRemediationApplied: () => void };
  }) => {
    captured.transactionsTabProps = props.transactionsTabProps;
    captured.settingsTabProps = props.settingsTabProps;
    return null;
  },
}));

const noop = vi.fn();
const modalState = new Proxy({}, { get: () => noop });
const controller = new Proxy({
  id: 'wallet-route',
  ownershipKey: 'wallet-route:user-7:signet',
  visibleActiveTab: 'tx',
  modalState,
  transactions: [],
  filteredTransactions: [],
  walletAddressStrings: [],
  utxoStats: [],
  utxos: [],
  addresses: [],
  groups: [],
  walletAgentLinks: [],
  selectedUtxos: new Set(),
  pendingFreezeIds: new Set(),
  txFilters: {},
}, {
  get: (target, property) => property in target
    ? target[property as keyof typeof target]
    : noop,
}) as unknown as WalletDetailController;

describe('WalletDetailLoadedView AI ownership', () => {
  it('passes the controller route/user/network owner with the rendered wallet id', () => {
    render(
      <WalletDetailLoadedView
        controller={controller}
        wallet={{
          id: 'wallet-route',
          name: 'Wallet',
          type: 'single_sig',
          balance: 0,
          network: 'signet',
        } as NonNullable<WalletDetailController['wallet']>}
      />
    );

    expect(captured.transactionsTabProps).toMatchObject({
      walletId: 'wallet-route',
      ownershipKey: 'wallet-route:user-7:signet',
    });
    captured.settingsTabProps?.onRemediationApplied();
    expect(controller.fetchData).toHaveBeenCalledWith(true);
    captured.onSend?.();
    expect(controller.navigate).toHaveBeenCalledWith('/wallets/wallet-route/send');
  });
});
