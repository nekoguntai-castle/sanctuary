import { StrictMode } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { Variables } from '../../../src/components/Variables';
import { useVariablesController } from '../../../src/components/Variables/useVariablesController';
import * as adminApi from '../../../src/api/admin';

vi.mock('../../../src/api/admin', () => ({
  getSystemSettings: vi.fn(), updateSystemSettings: vi.fn(),
}));
const baseline = { registrationEnabled: false, confirmationThreshold: 6, deepConfirmationThreshold: 12, dustThreshold: 600 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(adminApi.getSystemSettings).mockResolvedValue(baseline);
  vi.mocked(adminApi.updateSystemSettings).mockResolvedValue(baseline);
});
function expectNoForm() {
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
  expect(adminApi.updateSystemSettings).not.toHaveBeenCalled();
}
it('keeps failed and deferred retries noneditable, then saves the recovered server baseline', async () => {
  const retry = deferred<typeof baseline>();
  vi.mocked(adminApi.getSystemSettings).mockRejectedValueOnce(new Error('Settings unavailable'))
    .mockRejectedValueOnce(new Error('Still unavailable')).mockReturnValueOnce(retry.promise);
  const user = userEvent.setup();
  render(<Variables />);
  expect(await screen.findByText(/Failed to load system variables/)).toBeInTheDocument();
  expect(screen.getByText(/Settings unavailable/)).toBeInTheDocument();
  expectNoForm();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(/Still unavailable/)).toBeInTheDocument();
  expectNoForm();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(screen.getByText('Loading variables...')).toBeInTheDocument();
  expectNoForm();
  await act(async () => { retry.resolve(baseline); });
  const inputs = screen.getAllByRole('spinbutton');
  expect(inputs[0]).toHaveValue(6); expect(inputs[1]).toHaveValue(12);
  fireEvent.change(inputs[2], { target: { value: '700' } });
  await user.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(adminApi.updateSystemSettings).toHaveBeenCalledWith({ confirmationThreshold: 6, deepConfirmationThreshold: 12, dustThreshold: 700 }));
});
it.each([undefined, null])('keeps successful missing/null defaults writable (%s)', async value => {
  vi.mocked(adminApi.getSystemSettings).mockResolvedValue({ registrationEnabled: false, confirmationThreshold: value, deepConfirmationThreshold: value, dustThreshold: value } as unknown as adminApi.SystemSettings);
  const user = userEvent.setup(); render(<Variables />);
  await user.click(await screen.findByRole('button', { name: 'Save Changes' }));
  expect(adminApi.updateSystemSettings).toHaveBeenCalledWith({ confirmationThreshold: 1, deepConfirmationThreshold: 3, dustThreshold: 546 });
});
it.each(['success', 'error'])('StrictMode obsolete %s cannot clear the current read loading', async oldOutcome => {
  const old = deferred<typeof baseline>(); const current = deferred<typeof baseline>();
  vi.mocked(adminApi.getSystemSettings).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  render(<StrictMode><Variables /></StrictMode>);
  expect(adminApi.getSystemSettings).toHaveBeenCalledTimes(2);
  await act(async () => { if (oldOutcome === 'success') old.resolve({ ...baseline, confirmationThreshold: 2 }); else old.reject(new Error('Old failure')); });
  expect(screen.getByText('Loading variables...')).toBeInTheDocument(); expectNoForm();
  await act(async () => { current.resolve(baseline); });
  expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(6);
});
it.each(['success', 'error'])('StrictMode obsolete %s cannot replace a completed current baseline', async oldOutcome => {
  const old = deferred<typeof baseline>(); const current = deferred<typeof baseline>();
  vi.mocked(adminApi.getSystemSettings).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  render(<StrictMode><Variables /></StrictMode>);
  await act(async () => { current.resolve(baseline); });
  await act(async () => { if (oldOutcome === 'success') old.resolve({ ...baseline, confirmationThreshold: 2 }); else old.reject(new Error('Old failure')); });
  expect(screen.getAllByRole('spinbutton')[0]).toHaveValue(6);
  expect(screen.queryByText(/Old failure/)).not.toBeInTheDocument();
});
it('StrictMode obsolete success cannot replace a current failure', async () => {
  const old = deferred<typeof baseline>(); const current = deferred<typeof baseline>();
  vi.mocked(adminApi.getSystemSettings).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  render(<StrictMode><Variables /></StrictMode>);
  await act(async () => { current.reject(new Error('Current failure')); });
  await act(async () => { old.resolve(baseline); });
  expect(screen.getByText(/Current failure/)).toBeInTheDocument(); expectNoForm();
});
it.each(['success', 'error'])('unmount retires pending %s without publishing controller state', async outcome => {
  const request = deferred<typeof baseline>(); vi.mocked(adminApi.getSystemSettings).mockReturnValue(request.promise);
  const { result, unmount } = renderHook(useVariablesController); const retired = result.current;
  unmount();
  await act(async () => { if (outcome === 'success') request.resolve(baseline); else request.reject(new Error('Retired failure')); });
  expect(result.current).toBe(retired); expect(adminApi.updateSystemSettings).not.toHaveBeenCalled();
});
it('defense: direct controller Save cannot submit before a successful baseline', async () => {
  const request = deferred<typeof baseline>(); vi.mocked(adminApi.getSystemSettings).mockReturnValue(request.promise);
  const { result } = renderHook(useVariablesController);
  await act(async () => { await result.current.handleSave(); });
  expect(adminApi.updateSystemSettings).not.toHaveBeenCalled();
  await act(async () => { request.reject(new Error('No baseline')); });
  await act(async () => { await result.current.handleSave(); });
  expect(adminApi.updateSystemSettings).not.toHaveBeenCalled();
});
it('keeps an empty error message behind the contextual failure and Retry view', async () => {
  vi.mocked(adminApi.getSystemSettings).mockRejectedValue(new Error(''));
  render(<Variables />);
  expect(await screen.findByText(/Failed to load system variables/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  expectNoForm();
});
