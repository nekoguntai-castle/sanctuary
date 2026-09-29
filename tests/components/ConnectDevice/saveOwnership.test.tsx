import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { ConnectDevice } from '../../../src/components/ConnectDevice/ConnectDevice';
import * as devicesApi from '../../../src/api/devices';
const { refreshSidebar, resetQr, resetUsb, logError } = vi.hoisted(() => ({
  refreshSidebar: vi.fn(), resetQr: vi.fn(), resetUsb: vi.fn(), logError: vi.fn(),
}));
vi.mock('../../../src/api/devices', () => ({
  getDeviceModels: vi.fn(), createDeviceWithConflictHandling: vi.fn(), mergeDeviceAccounts: vi.fn(),
}));
vi.mock('../../../src/services/deviceParsers', () => ({
  parseDeviceJson: vi.fn().mockReturnValue({ fingerprint: 'f00dbabe', accounts: [{
    purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'", xpub: 'xpub-imported-account',
  }] }),
}));
vi.mock('../../../src/contexts/SidebarContext', () => ({ useSidebar: () => ({ refreshSidebar }) }));
vi.mock('../../../src/hooks/qr/useQrScanner', () => ({ useQrScanner: () => ({ reset: resetQr }) }));
vi.mock('../../../src/hooks/useDeviceConnection', () => ({ useDeviceConnection: () => ({ reset: resetUsb }) }));
vi.mock('../../../src/utils/logger', () => ({ createLogger: () => ({ info: vi.fn(), error: logError }) }));

type SaveResult = Awaited<ReturnType<typeof devicesApi.createDeviceWithConflictHandling>>;
type MergeResult = Awaited<ReturnType<typeof devicesApi.mergeDeviceAccounts>>;
const conflict: SaveResult = {
  status: 'conflict',
  conflict: {
    error: 'Conflict', message: 'Device already exists',
    existingDevice: { id: 'existing', type: 'coldcard', label: 'Existing Coldcard', fingerprint: 'f00dbabe', accounts: [] },
    comparison: {
      newAccounts: [{ purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/1'", xpub: 'xpub-imported-account' }],
      matchingAccounts: [], conflictingAccounts: [],
    },
  },
};
const created = { status: 'created', device: { id: 'new' } } as SaveResult;
const merged = { device: { id: 'existing' }, added: 1 } as MergeResult;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function renderFlow(strict = false) {
  const router = createMemoryRouter([
    { path: '/devices/connect', element: <ConnectDevice /> },
    { path: '/elsewhere', element: <div>Chosen destination</div> },
    { path: '/devices', element: <div>Device list</div> },
    { path: '/devices/existing', element: <div>Existing device</div> },
  ], { initialEntries: ['/elsewhere', '/devices/connect'], initialIndex: 1 });
  const content = <QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>;
  const view = render(strict ? <StrictMode>{content}</StrictMode> : content);
  return { ...view, router, user: userEvent.setup() };
}

function renderEmbeddedFlow() {
  const onBack = vi.fn();
  const onComplete = vi.fn();
  const router = createMemoryRouter([
    { path: '/wallets/create', element: <ConnectDevice embedded onBack={onBack} onComplete={onComplete} /> },
    { path: '/devices/existing', element: <div>Existing device</div> },
  ], { initialEntries: ['/wallets/create'] });
  const view = render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router} /></QueryClientProvider>);
  return { ...view, router, user: userEvent.setup(), onBack, onComplete };
}
async function importAndSave(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText('Coldcard MK4'));
  await user.click(await screen.findByText('SD Card'));
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['{}'], 'export.json', { type: 'application/json' })] } });
  await waitFor(() => expect(screen.getByRole('button', { name: /Save Device/i })).not.toBeDisabled());
  await user.click(screen.getByRole('button', { name: /Save Device/i }));
  await waitFor(() => expect(devicesApi.createDeviceWithConflictHandling).toHaveBeenCalled());
}
async function startMerge(user: ReturnType<typeof userEvent.setup>) {
  await importAndSave(user);
  await user.click(await screen.findByRole('button', { name: /Merge/i }));
  await waitFor(() => expect(devicesApi.mergeDeviceAccounts).toHaveBeenCalled());
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(devicesApi.createDeviceWithConflictHandling).mockReset().mockResolvedValue(created);
  vi.mocked(devicesApi.mergeDeviceAccounts).mockReset().mockResolvedValue(merged);
  refreshSidebar.mockReset();
  vi.mocked(devicesApi.getDeviceModels).mockResolvedValue(['Coldcard MK4', 'Second Coldcard'].map((name, index) => ({
    id: 'model-' + index, slug: 'coldcard-mk4', name, manufacturer: 'Coinkite', connectivity: ['sd_card', 'qr_code'], airGapped: true, secureElement: true, openSource: true, supportsBitcoinOnly: true, integrationTested: true,
  })) as never);
});

it.each(['save', 'merge'] as const)('suppresses departed %s errors', async kind => {
  const pending = deferred<never>();
  if (kind === 'save') vi.mocked(devicesApi.createDeviceWithConflictHandling).mockReturnValueOnce(pending.promise);
  else {
    vi.mocked(devicesApi.createDeviceWithConflictHandling).mockResolvedValueOnce(conflict);
    vi.mocked(devicesApi.mergeDeviceAccounts).mockReturnValueOnce(pending.promise);
  }
  const { user, router } = renderFlow();
  if (kind === 'save') await importAndSave(user); else await startMerge(user);
  await act(async () => { await router.navigate(-1); });
  await act(async () => { pending.reject(new Error('obsolete failure')); });
  expect(router.state.location.pathname).toBe('/elsewhere');
  expect(logError).not.toHaveBeenCalled();
  expect(refreshSidebar).not.toHaveBeenCalled();
});

it.each(['success', 'error'] as const)('Cancel retires pending merge %s while the form stays mounted', async outcome => {
  const pending = deferred<MergeResult>();
  vi.mocked(devicesApi.createDeviceWithConflictHandling).mockResolvedValueOnce(conflict);
  vi.mocked(devicesApi.mergeDeviceAccounts).mockReturnValueOnce(pending.promise);
  const { user, router } = renderFlow();
  await startMerge(user);
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByText(/Device Already Exists/)).not.toBeInTheDocument();
  await act(async () => { if (outcome === 'success') pending.resolve(merged); else pending.reject(new Error('obsolete failure')); });
  expect(router.state.location.pathname).toBe('/devices/connect');
  expect(screen.getByRole('button', { name: /Save Device/i })).not.toBeDisabled();
  expect(logError).not.toHaveBeenCalled();
  if (outcome === 'success') expect(refreshSidebar).toHaveBeenCalledTimes(1);
});

it.each(['created', 'conflict', 'error'] as const)('model reset retires pending %s result', async outcome => {
  const pending = deferred<SaveResult>();
  vi.mocked(devicesApi.createDeviceWithConflictHandling).mockReturnValueOnce(pending.promise);
  const { user, router } = renderFlow();
  await importAndSave(user);
  await user.click(screen.getByText('Second Coldcard'));
  await act(async () => { if (outcome === 'error') pending.reject(new Error('obsolete failure')); else pending.resolve(outcome === 'created' ? created : conflict); });
  expect(router.state.location.pathname).toBe('/devices/connect');
  expect(screen.queryByText(/Device Already Exists/)).not.toBeInTheDocument();
  expect(logError).not.toHaveBeenCalled();
  if (outcome === 'created') expect(refreshSidebar).toHaveBeenCalledTimes(1);
});

it.each(['success', 'error'] as const)('old merge %s cannot clear a new save after Cancel', async outcome => {
  const old = deferred<MergeResult>();
  const current = deferred<SaveResult>();
  vi.mocked(devicesApi.createDeviceWithConflictHandling).mockResolvedValueOnce(conflict).mockReturnValueOnce(current.promise);
  vi.mocked(devicesApi.mergeDeviceAccounts).mockReturnValueOnce(old.promise);
  const { user, router } = renderFlow();
  await startMerge(user);
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await user.click(screen.getByRole('button', { name: /Save Device/i }));
  await waitFor(() => expect(devicesApi.createDeviceWithConflictHandling).toHaveBeenCalledTimes(2));
  await act(async () => { if (outcome === 'success') old.resolve(merged); else old.reject(new Error('obsolete failure')); });
  expect(router.state.location.pathname).toBe('/devices/connect');
  expect(screen.getByRole('button', { name: /Saving/i })).toBeDisabled();
  expect(logError).not.toHaveBeenCalled();
  await act(async () => { current.resolve(created); });
  expect(router.state.location.pathname).toBe('/devices');
});

it.each([false, true])('current save works with StrictMode=%s', async strict => {
  const { user, router } = renderFlow(strict);
  await importAndSave(user);
  await waitFor(() => expect(router.state.location.pathname).toBe('/devices'));
  expect(refreshSidebar).toHaveBeenCalledTimes(1);
});

it('does not navigate when sidebar refresh synchronously unmounts the owner', async () => {
  const { user, router, unmount } = renderFlow();
  refreshSidebar.mockImplementationOnce(unmount);
  await importAndSave(user);
  expect(refreshSidebar).toHaveBeenCalledTimes(1);
  expect(router.state.location.pathname).toBe('/devices/connect');
});


it.each(['created', 'merged', 'manual-merge'] as const)('does not redirect after browser Back during %s save', async outcome => {
  const pendingSave = deferred<SaveResult>();
  const pendingMerge = deferred<MergeResult>();
  if (outcome === 'manual-merge') {
    vi.mocked(devicesApi.createDeviceWithConflictHandling).mockResolvedValueOnce(conflict);
    vi.mocked(devicesApi.mergeDeviceAccounts).mockReturnValueOnce(pendingMerge.promise);
  } else vi.mocked(devicesApi.createDeviceWithConflictHandling).mockReturnValueOnce(pendingSave.promise);
  const { user, router } = renderFlow();
  if (outcome === 'manual-merge') await startMerge(user); else await importAndSave(user);
  await act(async () => { await router.navigate(-1); });
  expect(router.state.location.pathname).toBe('/elsewhere');
  expect(screen.queryByText('Connect Hardware Device')).not.toBeInTheDocument();
  await act(async () => {
    if (outcome === 'manual-merge') pendingMerge.resolve(merged);
    else pendingSave.resolve(outcome === 'created' ? created : { status: 'merged', result: merged });
  });
  expect(refreshSidebar).toHaveBeenCalledTimes(1);
  expect(router.state.location.pathname).toBe('/elsewhere');
});

it('offers Return to Signers while embedded device models load', async () => {
  vi.mocked(devicesApi.getDeviceModels).mockReturnValueOnce(new Promise(() => {}));
  const { user, onBack } = renderEmbeddedFlow();
  await user.click(screen.getByRole('button', { name: 'Return to Signers' }));
  expect(onBack).toHaveBeenCalledOnce();
});

it('uses embedded completion after saving and keeps its wallet route', async () => {
  const { user, onComplete, router, onBack } = renderEmbeddedFlow();
  expect(await screen.findByText('Creating a wallet · select signers after connecting')).toBeVisible();
  await importAndSave(user);
  await waitFor(() => expect(onComplete).toHaveBeenCalledExactlyOnceWith('new'));
  expect(router.state.location.pathname).toBe('/wallets/create');
  expect(screen.getByRole('button', { name: 'Return to Signers' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Return to Signers' }));
  expect(onBack).toHaveBeenCalledOnce();
});

it('keeps an explicit Return to Signers action in an embedded conflict', async () => {
  vi.mocked(devicesApi.createDeviceWithConflictHandling).mockResolvedValueOnce(conflict);
  const { user, onBack, router } = renderEmbeddedFlow();
  await importAndSave(user);
  expect(await screen.findByRole('heading', { name: 'Device Already Exists' })).toBeVisible();
  await user.click(screen.getAllByRole('button', { name: 'Return to Signers' }).at(-1)!);
  expect(onBack).toHaveBeenCalledOnce();
  expect(router.state.location.pathname).toBe('/wallets/create');
});
