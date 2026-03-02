import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NetworkConnectionsSection } from '../../../components/NodeConfig/NetworkConnectionsSection';

vi.mock('../../../components/NetworkConnectionCard', () => ({
  NetworkConnectionCard: ({ servers, onConfigChange, onServersChange, onTestConnection }: any) => (
    <div data-testid="network-connection-card">
      <div data-testid="network-server-count">{servers.length}</div>
      <button onClick={() => onConfigChange({ mainnetPoolMin: 9 })}>update-config</button>
      <button onClick={() => onServersChange([{ id: 'updated-mainnet' }])}>update-servers</button>
      <button onClick={() => onTestConnection('host.example', 50002, true)}>test-connection</button>
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
      testnetEnabled: true,
      signetEnabled: false,
    } as any;

    const servers = [
      { id: 'm2', network: 'mainnet', priority: 2 },
      { id: 'm1', network: 'mainnet', priority: 1 },
      { id: 't1', network: 'testnet', priority: 0 },
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

    fireEvent.click(screen.getByText('update-config'));
    expect(onConfigChange).toHaveBeenCalledWith({
      ...nodeConfig,
      mainnetPoolMin: 9,
    });

    fireEvent.click(screen.getByText('update-servers'));
    expect(onServersChange).toHaveBeenCalledWith('mainnet', [{ id: 'updated-mainnet' }]);

    fireEvent.click(screen.getByText('test-connection'));
    expect(onTestConnection).toHaveBeenCalledWith('host.example', 50002, true);

    fireEvent.click(screen.getByRole('button', { name: /network connections/i }));
    expect(onToggle).toHaveBeenCalled();
  });
});
