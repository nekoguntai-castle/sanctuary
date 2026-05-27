import { fireEvent,render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { NetworkConnectionsSection } from '../../../components/NodeConfig/NetworkConnectionsSection';

vi.mock('../../../components/NetworkConnectionCard', () => ({
  NetworkConnectionCard: ({ network, servers, onConfigChange, onServersChange, onTestConnection }: any) => (
    <div data-testid="network-connection-card">
      <div data-testid="network-server-count">{servers.length}</div>
      <button onClick={() => onConfigChange({ mainnetPoolMin: 9 })}>update-config</button>
      <button onClick={() => onServersChange([{ id: 'updated-mainnet' }])}>update-servers</button>
      <button onClick={() => onTestConnection(network, 'host.example', 50002, true)}>test-connection</button>
    </div>
  ),
}));

describe('NetworkConnectionsSection branch coverage', () => {
  it('covers config merge callback and active-network server forwarding', () => {
    const onNetworkTabChange = vi.fn();
    const onConfigChange = vi.fn();
    const onServersChange = vi.fn();
    const onTestConnection = vi.fn();
    const onToggle = vi.fn();

    const nodeConfig = {
      mainnetPoolMin: 1,
      mainnetPoolMax: 5,
      testnet3Enabled: true,
      testnet4Enabled: true,
      signetEnabled: false,
    } as any;

    const servers = [
      { id: 'm2', network: 'mainnet', priority: 2 },
      { id: 'm1', network: 'mainnet', priority: 1 },
      { id: 't3', network: 'testnet3', priority: 0 },
      { id: 't4', network: 'testnet4', priority: 0 },
    ] as any;

    render(
      <NetworkConnectionsSection
        nodeConfig={nodeConfig}
        servers={servers}
        poolStats={null}
        activeNetworkTab="mainnet"
        onNetworkTabChange={onNetworkTabChange}
        onConfigChange={onConfigChange}
        onServersChange={onServersChange}
        onTestConnection={onTestConnection}
        expanded={true}
        onToggle={onToggle}
        summary="2 mainnet servers"
      />
    );

    expect(screen.getByTestId('network-server-count')).toHaveTextContent('2');
    expect(screen.getByRole('tab', { name: /testnet3\(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /testnet4\(1\)/i })).toBeInTheDocument();

    fireEvent.click(screen.getByText('update-config'));
    expect(onConfigChange).toHaveBeenCalledWith({
      ...nodeConfig,
      mainnetPoolMin: 9,
    });

    fireEvent.click(screen.getByText('update-servers'));
    expect(onServersChange).toHaveBeenCalledWith('mainnet', [{ id: 'updated-mainnet' }]);

    fireEvent.click(screen.getByText('test-connection'));
    expect(onTestConnection).toHaveBeenCalledWith('mainnet', 'host.example', 50002, true);

    fireEvent.click(screen.getByRole('button', { name: /network connections/i }));
    expect(onToggle).toHaveBeenCalled();
  });

  it('forwards testnet4 server updates separately from testnet3', () => {
    const onServersChange = vi.fn();

    render(
      <NetworkConnectionsSection
        nodeConfig={{ testnet3Enabled: true, testnet4Enabled: true } as any}
        servers={[
          { id: 't3', network: 'testnet3', priority: 0 },
          { id: 't4', network: 'testnet4', priority: 0 },
        ] as any}
        poolStats={null}
        activeNetworkTab="testnet4"
        onNetworkTabChange={vi.fn()}
        onConfigChange={vi.fn()}
        onServersChange={onServersChange}
        onTestConnection={vi.fn()}
        expanded={true}
        onToggle={vi.fn()}
        summary="testnet4"
      />
    );

    expect(screen.getByTestId('network-server-count')).toHaveTextContent('1');

    fireEvent.click(screen.getByText('update-servers'));
    expect(onServersChange).toHaveBeenCalledWith('testnet4', [{ id: 'updated-mainnet' }]);
  });
});
