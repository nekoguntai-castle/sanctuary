import { StrictMode } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { NodeConfig } from '../../../src/components/NodeConfig';
import { useNodeConfigData } from '../../../src/components/NodeConfig/useNodeConfigData';
import { DEFAULT_NODE_CONFIG } from '../../../src/components/NodeConfig/nodeConfigData';
import type { NodeConfig as NodeConfigType } from '../../../src/types';
import * as adminApi from '../../../src/api/admin';
import * as bitcoinApi from '../../../src/api/bitcoin';

vi.mock('../../../src/api/admin', () => ({ getNodeConfig: vi.fn(), getElectrumServers: vi.fn(), getTorContainerStatus: vi.fn(), updateNodeConfig: vi.fn() }));
vi.mock('../../../src/api/bitcoin', () => ({ getStatus: vi.fn() }));
const baseline: NodeConfigType = { ...DEFAULT_NODE_CONFIG, mainnetMode: 'singleton', mainnetSingletonHost: 'private-node', testnet3Enabled: true, signetEnabled: true, explorerUrl: 'https://explorer.example', proxyEnabled: true, proxyHost: 'private-proxy', proxyPort: 9050 };
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(adminApi.getNodeConfig).mockResolvedValue(baseline);
  vi.mocked(adminApi.getElectrumServers).mockResolvedValue([]);
  vi.mocked(adminApi.getTorContainerStatus).mockResolvedValue(null as never);
  vi.mocked(adminApi.updateNodeConfig).mockResolvedValue(baseline);
  vi.mocked(bitcoinApi.getStatus).mockResolvedValue({} as never);
});
function expectNoForm() {
  expect(screen.queryByRole('button', { name: 'Save All Settings' })).not.toBeInTheDocument();
  expect(screen.queryByText('External Services')).not.toBeInTheDocument();
  expect(adminApi.updateNodeConfig).not.toHaveBeenCalled();
}
it('keeps failures and pending Retry noneditable, then preserves recovered hidden settings on save', async () => {
  const retry = deferred<NodeConfigType>();
  vi.mocked(adminApi.getNodeConfig).mockRejectedValueOnce(new Error('Unavailable')).mockRejectedValueOnce(new Error('Still unavailable')).mockReturnValueOnce(retry.promise);
  const user = userEvent.setup(); render(<NodeConfig />);
  expect(await screen.findByText(/Failed to load node configuration/)).toBeInTheDocument(); expectNoForm();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(/Still unavailable/)).toBeInTheDocument(); expectNoForm();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(screen.getByText('Loading node configuration...')).toBeInTheDocument(); expectNoForm();
  await act(async () => { retry.resolve(baseline); });
  await user.click(screen.getByText('External Services'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Mainnet block explorer URL' }), { target: { value: 'https://new-explorer.example' } });
  await user.click(screen.getByRole('button', { name: 'Save All Settings' }));
  await waitFor(() => expect(adminApi.updateNodeConfig).toHaveBeenCalledWith({ ...baseline, explorerUrl: 'https://new-explorer.example' }));
  expect(adminApi.getNodeConfig).toHaveBeenCalledTimes(3);
});
it('retains empty errors as contextual failures with Retry', async () => {
  vi.mocked(adminApi.getNodeConfig).mockRejectedValue(new Error(''));
  render(<NodeConfig />);
  expect(await screen.findByText(/Failed to load node configuration/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled(); expectNoForm();
});
it('keeps successful first-setup defaults editable', async () => {
  vi.mocked(adminApi.getNodeConfig).mockResolvedValue(DEFAULT_NODE_CONFIG);
  const user = userEvent.setup(); render(<NodeConfig />);
  await user.click(await screen.findByRole('button', { name: 'Save All Settings' }));
  expect(adminApi.updateNodeConfig).toHaveBeenCalledWith(DEFAULT_NODE_CONFIG);
});
it('tolerates auxiliary Electrum, Tor and pool failures after a successful baseline', async () => {
  vi.mocked(adminApi.getElectrumServers).mockRejectedValue(new Error('Servers unavailable'));
  vi.mocked(adminApi.getTorContainerStatus).mockRejectedValue(new Error('Tor unavailable'));
  vi.mocked(bitcoinApi.getStatus).mockRejectedValue(new Error('Pool unavailable'));
  render(<NodeConfig />);
  expect(await screen.findByRole('button', { name: 'Save All Settings' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});
it.each(['success', 'error'])('StrictMode old %s cannot clear current loading or start pool work', async outcome => {
  const old = deferred<NodeConfigType>(); const current = deferred<NodeConfigType>();
  vi.mocked(adminApi.getNodeConfig).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  render(<StrictMode><NodeConfig /></StrictMode>);
  await act(async () => { if (outcome === 'success') old.resolve(DEFAULT_NODE_CONFIG); else old.reject(new Error('Old failure')); });
  expect(screen.getByText('Loading node configuration...')).toBeInTheDocument(); expectNoForm();
  expect(bitcoinApi.getStatus).not.toHaveBeenCalled();
  await act(async () => { current.resolve(baseline); });
  expect(screen.getByRole('button', { name: 'Save All Settings' })).toBeEnabled();
});
it.each(['success', 'error'])('StrictMode old %s cannot replace a current baseline', async outcome => {
  const old = deferred<NodeConfigType>(); const current = deferred<NodeConfigType>();
  vi.mocked(adminApi.getNodeConfig).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const user = userEvent.setup(); render(<StrictMode><NodeConfig /></StrictMode>);
  await act(async () => { current.resolve(baseline); });
  await act(async () => { if (outcome === 'success') old.resolve(DEFAULT_NODE_CONFIG); else old.reject(new Error('Old failure')); });
  await user.click(screen.getByRole('button', { name: 'Save All Settings' }));
  expect(adminApi.updateNodeConfig).toHaveBeenCalledWith(baseline);
});
it('StrictMode old success cannot conceal a current failure', async () => {
  const old = deferred<NodeConfigType>(); const current = deferred<NodeConfigType>();
  vi.mocked(adminApi.getNodeConfig).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  render(<StrictMode><NodeConfig /></StrictMode>);
  await act(async () => { current.reject(new Error('Current failure')); });
  await act(async () => { old.resolve(DEFAULT_NODE_CONFIG); });
  expect(screen.getByText(/Current failure/)).toBeInTheDocument(); expectNoForm();
});
it.each(['success', 'error'])('unmount retires pending %s without publishing baseline state', async outcome => {
  const request = deferred<NodeConfigType>(); vi.mocked(adminApi.getNodeConfig).mockReturnValue(request.promise);
  const { result, unmount } = renderHook(useNodeConfigData); const retired = result.current; unmount();
  await act(async () => { if (outcome === 'success') request.resolve(baseline); else request.reject(new Error('Retired failure')); });
  expect(result.current).toBe(retired); expect(bitcoinApi.getStatus).not.toHaveBeenCalled();
});
