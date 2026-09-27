import React, { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { WalletType } from '../../../src/types';
import { useCreateWalletController } from '../../../src/components/CreateWallet/useCreateWalletController';
import { CreateWallet } from '../../../src/components/CreateWallet/CreateWallet';
import { ActiveNetworkProvider, useActiveNetwork } from '../../../src/contexts/ActiveNetworkContext';
import { SidebarNetworkSelector } from '../../../src/components/Layout/SidebarContent/SidebarNetworkSelector';
import * as walletsApi from '../../../src/api/wallets';
import * as devicesApi from '../../../src/api/devices';
import { walletKeys } from '../../../src/hooks/queries/useWallets';

const { handleError, logError } = vi.hoisted(() => ({ handleError: vi.fn(), logError: vi.fn() }));
vi.mock('../../../src/api/devices', () => ({ getDevices: vi.fn() }));
vi.mock('../../../src/api/wallets', async importOriginal => ({ ...await importOriginal<typeof import('../../../src/api/wallets')>(), createWallet: vi.fn() }));
vi.mock('../../../src/hooks/useUserPreference', () => ({ useUserPreference: (_key: string, initial: string) => React.useState(initial) }));
vi.mock('../../../src/hooks/useErrorHandler', () => ({ useErrorHandler: () => ({ handleError }) }));
vi.mock('../../../src/utils/logger', () => ({ createLogger: () => ({ error: logError }) }));

type Wallet = Awaited<ReturnType<typeof walletsApi.createWallet>>;
const created = { id: 'new-wallet', name: 'Pending Wallet' } as Wallet;
function deferred() {
  let resolve!: (wallet: Wallet) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Wallet>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function NetworkControls() {
  const network = useActiveNetwork();
  return <SidebarNetworkSelector selectedNetwork={network.selectedNetwork} onNetworkChange={network.setSelectedNetwork}
    networkAvailability={{ mainnet: true, testnet3: true, testnet4: true, signet: true }} />;
}
function renderWizard(strict = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidations = vi.spyOn(client, 'invalidateQueries');
  const router = createMemoryRouter([
    { path: '/wallets/create', element: <CreateWallet /> },
    { path: '/wallets', element: <div>Chosen wallet list</div> },
    { path: '/wallets/new-wallet', element: <div>Created wallet</div> },
  ], { initialEntries: ['/wallets', '/wallets/create'], initialIndex: 1 });
  const content = <QueryClientProvider client={client}><ActiveNetworkProvider><NetworkControls /><RouterProvider router={router} /></ActiveNetworkProvider></QueryClientProvider>;
  const view = render(strict ? <StrictMode>{content}</StrictMode> : content);
  return { ...view, router, client, invalidations, user: userEvent.setup() };
}
async function reachReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Single Signature/ }));
  await user.click(screen.getByRole('button', { name: /Next Step/ }));
  await user.click(await screen.findByText('Test Ledger'));
  await user.click(screen.getByRole('button', { name: /Next Step/ }));
  await user.type(screen.getByPlaceholderText('e.g., My ColdCard Wallet'), 'Pending Wallet');
  await user.click(screen.getByRole('button', { name: /Next Step/ }));
}
async function submit(user: ReturnType<typeof userEvent.setup>, calls = 1) {
  await user.click(screen.getByRole('button', { name: /Construct Wallet/ }));
  await waitFor(() => expect(walletsApi.createWallet).toHaveBeenCalledTimes(calls));
}
async function settle(pending: ReturnType<typeof deferred>, outcome: 'success' | 'error') {
  await act(async () => {
    if (outcome === 'success') pending.resolve(created);
    else pending.reject(new Error('creation failed'));
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(devicesApi.getDevices).mockResolvedValue([{
    id: 'device-1', label: 'Test Ledger', type: 'ledger', xpub: 'xpub123', masterFingerprint: 'abc12345',
    derivationPath: "m/84'/0'/0'", accounts: [{ id: 'acc-1', purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'" }],
  }] as never);
  vi.mocked(walletsApi.createWallet).mockResolvedValue(created);
});

it.each(['success', 'error'] as const)('retires %s after actual wizard Back and Cancel', async outcome => {
  const pending = deferred();
  vi.mocked(walletsApi.createWallet).mockReturnValueOnce(pending.promise);
  const { user, router, invalidations } = renderWizard();
  await reachReview(user);
  await submit(user);
  for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: 'Back' }));
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(router.state.location.pathname).toBe('/wallets');
  await settle(pending, outcome);
  expect(router.state.location.pathname).toBe('/wallets');
  expect(handleError).not.toHaveBeenCalled();
  expect(logError).not.toHaveBeenCalled();
  if (outcome === 'success') expect(invalidations).toHaveBeenCalledWith({ queryKey: walletKeys.lists() });
  else expect(invalidations).not.toHaveBeenCalled();
});

it.each(['success', 'error'] as const)('retires %s on browser Back without wizard cancellation', async outcome => {
  const pending = deferred();
  vi.mocked(walletsApi.createWallet).mockReturnValueOnce(pending.promise);
  const { user, router, invalidations } = renderWizard();
  await reachReview(user);
  await submit(user);
  await act(async () => { await router.navigate(-1); });
  expect(screen.queryByRole('button', { name: /Construct Wallet/ })).not.toBeInTheDocument();
  await settle(pending, outcome);
  expect(router.state.location.pathname).toBe('/wallets');
  expect(handleError).not.toHaveBeenCalled();
  expect(logError).not.toHaveBeenCalled();
  if (outcome === 'success') expect(invalidations).toHaveBeenCalledWith({ queryKey: walletKeys.lists() });
});

it.each(['success', 'error'] as const)('keeps earlier wizard step after retired %s', async outcome => {
  const pending = deferred();
  vi.mocked(walletsApi.createWallet).mockReturnValueOnce(pending.promise);
  const { user, router } = renderWizard();
  await reachReview(user);
  await submit(user);
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await settle(pending, outcome);
  expect(router.state.location.pathname).toBe('/wallets/create');
  expect(screen.getByPlaceholderText('e.g., My ColdCard Wallet')).toHaveValue('Pending Wallet');
  expect(handleError).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: /Next Step/ }));
  expect(screen.getByRole('button', { name: /Construct Wallet/ })).not.toBeDisabled();
});

it.each(['success', 'error'] as const)('old %s cannot clear a newer submission busy state', async outcome => {
  const old = deferred();
  const current = deferred();
  vi.mocked(walletsApi.createWallet).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const { user, router } = renderWizard();
  await reachReview(user);
  await submit(user);
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await user.click(screen.getByRole('button', { name: /Next Step/ }));
  await submit(user, 2);
  await settle(old, outcome);
  expect(router.state.location.pathname).toBe('/wallets/create');
  expect(screen.getByRole('button', { name: /Construct Wallet/ })).toBeDisabled();
  expect(handleError).not.toHaveBeenCalled();
  await settle(current, 'success');
  expect(router.state.location.pathname).toBe('/wallets/new-wallet');
});

it.each(['success', 'error'] as const)('network A-B-A retires %s without reviving old review', async outcome => {
  const pending = deferred();
  vi.mocked(walletsApi.createWallet).mockReturnValueOnce(pending.promise);
  const { user, router, invalidations } = renderWizard();
  await reachReview(user);
  await submit(user);
  await user.click(screen.getByRole('tab', { name: /Testnet.*3/i }));
  await user.click(screen.getByRole('tab', { name: /Mainnet/i }));
  await settle(pending, outcome);
  expect(router.state.location.pathname).toBe('/wallets/create');
  expect(screen.getByRole('button', { name: /Next Step/ })).toBeDisabled();
  expect(handleError).not.toHaveBeenCalled();
  if (outcome === 'success') expect(invalidations).toHaveBeenCalledWith({ queryKey: walletKeys.lists() });
});

it.each([false, true])('keeps current successful creation with StrictMode=%s', async strict => {
  const { user, router, invalidations } = renderWizard(strict);
  await reachReview(user);
  await submit(user);
  await waitFor(() => expect(router.state.location.pathname).toBe('/wallets/new-wallet'));
  expect(invalidations).toHaveBeenCalledTimes(1);
});

it('keeps current failure retryable', async () => {
  vi.mocked(walletsApi.createWallet).mockRejectedValueOnce(new Error('creation failed'));
  const { user, router } = renderWizard();
  await reachReview(user);
  await submit(user);
  await waitFor(() => expect(handleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'creation failed' }), 'Failed to Create Wallet'));
  expect(screen.getByRole('button', { name: /Construct Wallet/ })).not.toBeDisabled();
  await submit(user, 2);
  await waitFor(() => expect(router.state.location.pathname).toBe('/wallets/new-wallet'));
});

// Defense coverage for retained callbacks; real user retirement is established above.
it.each(['Back', 'network ABA', 'unmount'] as const)('refuses retained submit admission after %s', async retirement => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}><ActiveNetworkProvider><NetworkControls /><MemoryRouter>{children}</MemoryRouter></ActiveNetworkProvider></QueryClientProvider>
  );
  const { result, unmount } = renderHook(useCreateWalletController, { wrapper });
  await waitFor(() => expect(result.current.availableDevices).toHaveLength(1));
  act(() => result.current.setWalletType(WalletType.SINGLE_SIG));
  const retained = result.current.handleCreate;
  if (retirement === 'Back') act(() => result.current.handleBack());
  else if (retirement === 'unmount') unmount();
  else {
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Testnet.*3/i }));
    await user.click(screen.getByRole('tab', { name: /Mainnet/i }));
  }
  await act(async () => { await retained(); });
  expect(walletsApi.createWallet).not.toHaveBeenCalled();
});
