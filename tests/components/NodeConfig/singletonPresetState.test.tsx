import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeConfig } from '../../../src/components/NodeConfig';
import * as adminApi from '../../../src/api/admin';
import * as bitcoinApi from '../../../src/api/bitcoin';
import { buildNodeConfig } from './nodeConfigFixture';

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../src/api/admin', () => ({
  getNodeConfig: vi.fn(), updateNodeConfig: vi.fn(), getElectrumServers: vi.fn(),
  testElectrumConnection: vi.fn(), testProxy: vi.fn(), getTorContainerStatus: vi.fn(),
  startTorContainer: vi.fn(), stopTorContainer: vi.fn(),
}));
vi.mock('../../../src/api/bitcoin', () => ({ getStatus: vi.fn() }));

const config = buildNodeConfig();

describe('singleton presets (real chain)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getNodeConfig).mockResolvedValue(config);
    vi.mocked(adminApi.getElectrumServers).mockResolvedValue([]);
    vi.mocked(adminApi.getTorContainerStatus).mockResolvedValue(null as any);
    vi.mocked(adminApi.updateNodeConfig).mockResolvedValue(config);
    vi.mocked(bitcoinApi.getStatus).mockRejectedValue(new Error('down'));
  });

  it('applies every field of a singleton preset', async () => {
    render(<NodeConfig />);
    fireEvent.click(await screen.findByText('Network Connections'));
    fireEvent.click(await screen.findByText('Blockstream (TCP)'));
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('50001');
    expect(screen.getByRole('button', { name: 'TCP' }).className).toContain('bg-mainnet');
    fireEvent.click(screen.getByText('BlueWallet (TCP)'));
    expect((screen.getByPlaceholderText('electrum.example.com') as HTMLInputElement).value).toBe('electrum1.bluewallet.io');
  });

  it("saves the preset's host, port and protocol", async () => {
    render(<NodeConfig />);
    fireEvent.click(await screen.findByText('Network Connections'));
    fireEvent.click(await screen.findByText('Blockstream (TCP)'));
    fireEvent.click(screen.getByText('BlueWallet (TCP)'));
    fireEvent.click(screen.getByText('Save All Settings'));
    await waitFor(() => expect(adminApi.updateNodeConfig).toHaveBeenCalledWith(expect.objectContaining({
      mainnetSingletonHost: 'electrum1.bluewallet.io', mainnetSingletonPort: 50001, mainnetSingletonSsl: false,
    })));
  });
});
