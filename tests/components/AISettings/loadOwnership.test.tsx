import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { registerAISettingsTestHarness, mockGetSystemSettings, mockUpdateSystemSettings, mockGetFeatureFlags, mockListModels, enabledSettings } from './AISettingsTestHarness';
import AISettings from '../../../src/components/AISettings';
import { ApiError } from '../../../src/api/client';

beforeEach(() => vi.resetAllMocks());
registerAISettingsTestHarness();
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function expectNoControls() {
  expect(screen.queryByText('Enable AI Features')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save Configuration' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  expect(mockUpdateSystemSettings).not.toHaveBeenCalled();
}
it('gates failed/repeated/deferred reads then preserves recovered profiles through real enable/edit/save', async () => {
  const profiles = [enabledSettings.aiProviderProfiles[0], { ...enabledSettings.aiProviderProfiles[0], id: 'other-provider', name: 'Other provider' }];
  const baseline = { ...enabledSettings, aiEnabled: false, aiProviderProfiles: profiles };
  const retry = deferred<typeof baseline>();
  mockGetSystemSettings.mockRejectedValueOnce(new Error('Unavailable')).mockRejectedValueOnce(new Error('Still unavailable')).mockReturnValueOnce(retry.promise);
  let persisted = baseline;
  mockUpdateSystemSettings.mockImplementation(async update => { persisted = { ...persisted, ...update }; return persisted; });
  const user = userEvent.setup(); render(<AISettings />);
  expect(await screen.findByText(/Failed to load AI settings/)).toBeInTheDocument(); expectNoControls();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(/Still unavailable/)).toBeInTheDocument(); expectNoControls();
  await user.click(screen.getByRole('button', { name: 'Retry' })); expectNoControls();
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  await act(async () => { retry.resolve(baseline); });
  await user.click(screen.getByRole('button', { name: '' }));
  await user.click(await screen.findByRole('button', { name: 'Enable AI' }));
  await waitFor(() => expect(mockUpdateSystemSettings).toHaveBeenCalledWith({ aiEnabled: true }));
  const settings = screen.getAllByText('Settings').find(el => el.classList.contains('hidden'))!.closest('button')!;
  await waitFor(() => expect(settings).not.toBeDisabled()); await user.click(settings);
  fireEvent.change(await screen.findByPlaceholderText('http://host.docker.internal:11434'), { target: { value: 'http://localhost:11434' } });
  await user.click(screen.getByRole('button', { name: 'Save Configuration' }));
  await waitFor(() => expect(mockUpdateSystemSettings).toHaveBeenCalledTimes(2));
  // Credential status is response-only; every writable untouched profile field must survive.
  const { credentialState: _credentialState, ...untouchedProfile } = profiles[1];
  expect(persisted.aiProviderProfiles).toEqual(expect.arrayContaining([untouchedProfile, expect.objectContaining({ id: 'default-ollama', endpoint: 'http://localhost:11434' })]));
});
it('retains empty primary errors as contextual failure with Retry', async () => {
  mockGetSystemSettings.mockRejectedValue(new Error('')); render(<AISettings />);
  expect(await screen.findByText(/Failed to load AI settings/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled(); expectNoControls();
});
it.each(['enabled', 'disabled', 'forbidden', 'error'])('StrictMode retired flags %s cannot admit a GET or finish current loading', async outcome => {
  const old = deferred<{ key: string; enabled: boolean }[]>(); const current = deferred<{ key: string; enabled: boolean }[]>();
  mockGetFeatureFlags.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  render(<StrictMode><AISettings /></StrictMode>);
  await act(async () => {
    if (outcome === 'forbidden') old.reject(new ApiError('Forbidden', 403));
    else if (outcome === 'error') old.reject(new Error('Old flags unavailable'));
    else old.resolve([{ key: 'aiAssistant', enabled: outcome === 'enabled' }]);
  });
  expect(mockGetSystemSettings).not.toHaveBeenCalled(); expectNoControls();
  expect(screen.queryByText('Feature not available')).not.toBeInTheDocument();
  await act(async () => { current.resolve([{ key: 'aiAssistant', enabled: true }]); });
  expect(await screen.findByText('Enable AI Features')).toBeInTheDocument();
  expect(mockGetSystemSettings).toHaveBeenCalledTimes(1);
});
it.each(['success', 'error'])('unmounted primary %s cannot replace a remounted pending page', async outcome => {
  const old = deferred<typeof enabledSettings>(); const current = deferred<typeof enabledSettings>();
  mockGetSystemSettings.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const first = render(<AISettings />); await waitFor(() => expect(mockGetSystemSettings).toHaveBeenCalledTimes(1)); first.unmount();
  render(<AISettings />); await waitFor(() => expect(mockGetSystemSettings).toHaveBeenCalledTimes(2));
  await act(async () => { if (outcome === 'success') old.resolve(enabledSettings); else old.reject(new Error('Retired failure')); });
  expectNoControls(); expect(screen.queryByText(/Retired failure/)).not.toBeInTheDocument();
  await act(async () => { current.resolve(enabledSettings); });
  expect(await screen.findByText('Enable AI Features')).toBeInTheDocument();
});
it('keeps optional model discovery failure separate from a known baseline', async () => {
  mockGetSystemSettings.mockResolvedValue(enabledSettings); mockListModels.mockRejectedValue(new Error('Model discovery unavailable'));
  render(<AISettings />);
  expect(await screen.findByText('Enable AI Features')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  expect(mockGetSystemSettings).toHaveBeenCalledTimes(1);
});
