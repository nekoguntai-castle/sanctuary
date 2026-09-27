import { StrictMode } from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { WalletTelegramSettings } from '../../../src/components/WalletDetail/WalletTelegramSettings';
import { useWalletTelegramSettingsController } from '../../../src/components/WalletDetail/WalletTelegramSettings/useWalletTelegramSettingsController';
import { DEFAULT_WALLET_TELEGRAM_SETTINGS } from '../../../src/components/WalletDetail/WalletTelegramSettings/settingsModel';
import * as api from '../../../src/api/wallets';
import { useUser } from '../../../src/contexts/UserContext';

vi.mock('../../../src/api/wallets', () => ({ getWalletTelegramSettings: vi.fn(), updateWalletTelegramSettings: vi.fn() }));
vi.mock('../../../src/contexts/UserContext', () => ({ useUser: vi.fn() }));
const baseline = { enabled: false, notifyReceived: false, notifySent: false, notifyConsolidation: false, notifyDraft: false };
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(useUser).mockReturnValue({ user: { id: 'u1', preferences: { telegram: { enabled: true, botToken: 'token', chatId: 'chat' } } } } as never);
  vi.mocked(api.getWalletTelegramSettings).mockResolvedValue(baseline);
  vi.mocked(api.updateWalletTelegramSettings).mockResolvedValue(undefined as never);
});
function expectNoControls() {
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(api.updateWalletTelegramSettings).not.toHaveBeenCalled();
}
it('blocks failed/repeated/deferred reads then enabling preserves all recovered false preferences', async () => {
  const retry = deferred<typeof baseline>();
  vi.mocked(api.getWalletTelegramSettings).mockRejectedValueOnce(new Error('Unavailable')).mockRejectedValueOnce(new Error('Still unavailable')).mockReturnValueOnce(retry.promise);
  const user = userEvent.setup(); render(<WalletTelegramSettings walletId="a" />);
  expect(await screen.findByText(/Failed to load Telegram settings/)).toBeInTheDocument(); expectNoControls();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(/Still unavailable/)).toBeInTheDocument(); expectNoControls();
  await user.click(screen.getByRole('button', { name: 'Retry' })); expectNoControls();
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  await act(async () => { retry.resolve(baseline); });
  await user.click(screen.getByRole('switch'));
  expect(api.updateWalletTelegramSettings).toHaveBeenCalledWith('a', { ...baseline, enabled: true });
});
it('retains empty errors behind contextual failure and Retry', async () => {
  vi.mocked(api.getWalletTelegramSettings).mockRejectedValue(new Error(''));
  render(<WalletTelegramSettings walletId="a" />);
  expect(await screen.findByText(/Failed to load Telegram settings/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled(); expectNoControls();
});
it('preserves successful new-wallet defaults', async () => {
  vi.mocked(api.getWalletTelegramSettings).mockResolvedValue(DEFAULT_WALLET_TELEGRAM_SETTINGS);
  const user = userEvent.setup(); render(<WalletTelegramSettings walletId="a" />);
  await user.click(await screen.findByRole('switch'));
  expect(api.updateWalletTelegramSettings).toHaveBeenCalledWith('a', { ...DEFAULT_WALLET_TELEGRAM_SETTINGS, enabled: true });
});
it.each([false, true])('global unavailable notice retains precedence over read failure (configured=%s)', async configured => {
  vi.mocked(useUser).mockReturnValue({ user: { preferences: { telegram: configured ? { enabled: false, botToken: 'token', chatId: 'chat' } : {} } } } as never);
  vi.mocked(api.getWalletTelegramSettings).mockRejectedValue(new Error('Unavailable'));
  render(<WalletTelegramSettings walletId="a" />);
  expect(await screen.findByText(configured ? 'Telegram notifications disabled' : 'Telegram not configured')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument(); expectNoControls();
});
it.each(['success', 'error'])('StrictMode old %s cannot finish the current pending read', async outcome => {
  const old = deferred<typeof baseline>(); const current = deferred<typeof baseline>();
  vi.mocked(api.getWalletTelegramSettings).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  render(<StrictMode><WalletTelegramSettings walletId="a" /></StrictMode>);
  await act(async () => { if (outcome === 'success') old.resolve(DEFAULT_WALLET_TELEGRAM_SETTINGS); else old.reject(new Error('Old failure')); });
  expectNoControls(); expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  await act(async () => { current.resolve(baseline); });
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
});
it.each(['success', 'error'])('wallet ABA ignores obsolete %s and preserves latest baseline', async outcome => {
  const old = deferred<typeof baseline>();
  vi.mocked(api.getWalletTelegramSettings).mockReturnValueOnce(old.promise);
  const user = userEvent.setup(); const { rerender } = render(<WalletTelegramSettings walletId="a" />);
  rerender(<WalletTelegramSettings walletId="b" />); await screen.findByRole('switch');
  rerender(<WalletTelegramSettings walletId="a" />); await screen.findByRole('switch');
  await act(async () => { if (outcome === 'success') old.resolve(DEFAULT_WALLET_TELEGRAM_SETTINGS); else old.reject(new Error('Old failure')); });
  await user.click(screen.getByRole('switch'));
  expect(api.updateWalletTelegramSettings).toHaveBeenCalledWith('a', { ...baseline, enabled: true });
});
it.each(['success', 'error'])('unmount retires pending %s', async outcome => {
  const request = deferred<typeof baseline>(); vi.mocked(api.getWalletTelegramSettings).mockReturnValue(request.promise);
  const { result, unmount } = renderHook(() => useWalletTelegramSettingsController('a')); const retired = result.current; unmount();
  await act(async () => { if (outcome === 'success') request.resolve(baseline); else request.reject(new Error('Retired')); });
  expect(result.current).toBe(retired); expect(api.updateWalletTelegramSettings).not.toHaveBeenCalled();
});
it('defense: direct controller toggle cannot save an unknown baseline', async () => {
  const request = deferred<typeof baseline>(); vi.mocked(api.getWalletTelegramSettings).mockReturnValue(request.promise);
  const { result } = renderHook(() => useWalletTelegramSettingsController('a'));
  act(() => result.current.handleToggle('enabled'));
  expect(api.updateWalletTelegramSettings).not.toHaveBeenCalled();
  await act(async () => { request.reject(new Error('Unavailable')); });
  act(() => result.current.handleToggle('enabled'));
  expect(api.updateWalletTelegramSettings).not.toHaveBeenCalled();
});
it.each(['success', 'error'])('wallet change retires a pending Retry %s', async outcome => {
  const retry = deferred<typeof baseline>(); const current = deferred<typeof baseline>();
  vi.mocked(api.getWalletTelegramSettings).mockRejectedValueOnce(new Error('Unavailable')).mockReturnValueOnce(retry.promise).mockReturnValueOnce(current.promise);
  const user = userEvent.setup(); const { rerender } = render(<WalletTelegramSettings walletId="a" />);
  await user.click(await screen.findByRole('button', { name: 'Retry' }));
  rerender(<WalletTelegramSettings walletId="b" />);
  await act(async () => { if (outcome === 'success') retry.resolve(DEFAULT_WALLET_TELEGRAM_SETTINGS); else retry.reject(new Error('Old retry failure')); });
  expectNoControls(); expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  await act(async () => { current.resolve(baseline); });
  await user.click(screen.getByRole('switch'));
  expect(api.updateWalletTelegramSettings).toHaveBeenCalledWith('b', { ...baseline, enabled: true });
});
it('defense: unmount revokes a loaded controller toggle admission', async () => {
  const { result, unmount } = renderHook(() => useWalletTelegramSettingsController('a'));
  await waitFor(() => expect(result.current.loading).toBe(false));
  const toggle = result.current.handleToggle; unmount();
  act(() => toggle('enabled'));
  expect(api.updateWalletTelegramSettings).not.toHaveBeenCalled();
});
