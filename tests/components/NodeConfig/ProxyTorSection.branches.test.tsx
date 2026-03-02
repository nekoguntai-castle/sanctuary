import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProxyTorSection } from '../../../components/NodeConfig/ProxyTorSection';

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ProxyTorSection branch coverage', () => {
  const onConfigChange = vi.fn();
  const onToggle = vi.fn();
  const onProxyPreset = vi.fn();
  const onToggleCustomProxy = vi.fn();
  const onTorContainerToggle = vi.fn();
  const onRefreshTorStatus = vi.fn();
  const onTestProxy = vi.fn();

  const baseNodeConfig = {
    proxyEnabled: true,
    proxyHost: '127.0.0.1',
    proxyPort: 9050,
    proxyUsername: undefined,
    proxyPassword: undefined,
  } as any;

  const baseProps = {
    nodeConfig: baseNodeConfig,
    onConfigChange,
    torContainerStatus: {
      available: true,
      exists: true,
      running: false,
      status: 'stopped',
    } as any,
    isTorContainerLoading: false,
    torContainerMessage: '',
    showCustomProxy: true,
    proxyTestStatus: 'idle' as const,
    proxyTestMessage: '',
    onProxyPreset,
    onToggleCustomProxy,
    onTorContainerToggle,
    onRefreshTorStatus,
    onTestProxy,
    expanded: true,
    onToggle,
    summary: 'summary',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('toggles section from keyboard Enter/Space and ignores unrelated keys', () => {
    render(<ProxyTorSection {...baseProps} />);

    const header = screen.getByText('Proxy / Tor').closest('[role="button"]');
    expect(header).toBeTruthy();
    if (!header) throw new Error('Proxy / Tor header not found');
    fireEvent.keyDown(header, { key: 'Enter' });
    fireEvent.keyDown(header, { key: ' ' });
    fireEvent.keyDown(header, { key: 'Escape' });

    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('covers tor status text and ready/success message styling branches', () => {
    const { rerender } = render(
      <ProxyTorSection
        {...baseProps}
        torContainerStatus={{
          available: true,
          exists: false,
          running: false,
          status: 'not_installed',
        } as any}
      />
    );

    expect(screen.getByText('Not installed')).toBeInTheDocument();

    rerender(
      <ProxyTorSection
        {...baseProps}
        torContainerStatus={{
          available: true,
          exists: true,
          running: true,
          status: 'running',
        } as any}
        torContainerMessage="Tor is ready with success state"
      />
    );

    const message = screen.getByText('Tor is ready with success state');
    expect(message.className).toContain('text-emerald-600');
  });

  it('covers custom proxy fallbacks and optional credential clearing branches', () => {
    render(
      <ProxyTorSection
        {...baseProps}
        nodeConfig={{
          ...baseNodeConfig,
          proxyHost: undefined,
          proxyPort: undefined,
          proxyUsername: undefined,
          proxyPassword: undefined,
        }}
      />
    );

    const hostInput = screen.getByPlaceholderText('127.0.0.1') as HTMLInputElement;
    const portInput = screen.getByPlaceholderText('9050') as HTMLInputElement;
    const userInput = screen.getByPlaceholderText('Username (optional)');
    const passInput = screen.getByPlaceholderText('Password (optional)');

    expect(hostInput.value).toBe('');
    expect(portInput.value).toBe('');

    fireEvent.change(hostInput, { target: { value: 'proxy.local' } });
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ proxyHost: 'proxy.local' }));

    fireEvent.change(portInput, { target: { value: '' } });
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ proxyPort: undefined }));

    fireEvent.change(portInput, { target: { value: '9150' } });
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ proxyPort: 9150 }));

    fireEvent.change(userInput, { target: { value: 'alice' } });
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ proxyUsername: 'alice' }));
    fireEvent.change(userInput, { target: { value: '' } });
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ proxyUsername: undefined }));

    fireEvent.change(passInput, { target: { value: 'secret' } });
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ proxyPassword: 'secret' }));
    fireEvent.change(passInput, { target: { value: '' } });
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ proxyPassword: undefined }));
  });

  it('clears populated proxy fields back to undefined values', () => {
    render(
      <ProxyTorSection
        {...baseProps}
        nodeConfig={{
          ...baseNodeConfig,
          proxyHost: 'proxy.local',
          proxyPort: 9150,
          proxyUsername: 'alice',
          proxyPassword: 'secret',
        }}
      />
    );

    const portInput = screen.getByPlaceholderText('9050') as HTMLInputElement;
    const userInput = screen.getByPlaceholderText('Username (optional)') as HTMLInputElement;
    const passInput = screen.getByPlaceholderText('Password (optional)') as HTMLInputElement;

    expect(portInput.value).toBe('9150');
    expect(userInput.value).toBe('alice');
    expect(passInput.value).toBe('secret');

    fireEvent.change(portInput, { target: { value: '' } });
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ proxyPort: undefined }));

    fireEvent.change(userInput, { target: { value: '' } });
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ proxyUsername: undefined }));

    fireEvent.change(passInput, { target: { value: '' } });
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ proxyPassword: undefined }));
  });

  it('covers tor container action/message branches and custom-proxy visibility gating', () => {
    const { rerender } = render(
      <ProxyTorSection
        {...baseProps}
        torContainerStatus={{
          available: true,
          exists: true,
          running: true,
          status: 'running',
        } as any}
        nodeConfig={{ ...baseNodeConfig, proxyHost: '127.0.0.1', proxyPort: 9050 }}
        torContainerMessage="bootstrap in progress (10-30s)"
      />
    );

    const bootstrapMessage = screen.getByText('bootstrap in progress (10-30s)');
    expect(bootstrapMessage.className).toContain('text-amber-600');
    fireEvent.click(screen.getByText('Use'));
    expect(onProxyPreset).toHaveBeenCalledWith('tor-container');

    rerender(
      <ProxyTorSection
        {...baseProps}
        torContainerStatus={{
          available: true,
          exists: true,
          running: true,
          status: 'running',
        } as any}
        nodeConfig={{ ...baseNodeConfig, proxyHost: '127.0.0.1', proxyPort: 9050 }}
        torContainerMessage="container diagnostics available"
      />
    );
    const neutralMessage = screen.getByText('container diagnostics available');
    expect(neutralMessage.className).toContain('text-sanctuary-600');

    rerender(
      <ProxyTorSection
        {...baseProps}
        torContainerStatus={{
          available: true,
          exists: true,
          running: false,
          status: 'stopped',
        } as any}
        torContainerMessage=""
      />
    );
    expect(screen.getByText('Starting Tor takes 10-30 seconds to connect to the network.')).toBeInTheDocument();

    rerender(
      <ProxyTorSection
        {...baseProps}
        torContainerStatus={{
          available: true,
          exists: true,
          running: true,
          status: 'running',
        } as any}
        nodeConfig={{ ...baseNodeConfig, proxyHost: 'tor', proxyPort: 9050 }}
        showCustomProxy={true}
      />
    );
    expect(screen.queryByText('Use custom proxy...')).not.toBeInTheDocument();
    expect(screen.queryByText('Hide custom proxy settings')).not.toBeInTheDocument();
  });

  it('covers proxy test result status styling branches', () => {
    const { rerender } = render(
      <ProxyTorSection
        {...baseProps}
        proxyTestStatus="success"
        proxyTestMessage="Proxy OK"
      />
    );

    expect(screen.getByText('Proxy OK').closest('div')?.className).toContain('text-emerald-600');

    rerender(
      <ProxyTorSection
        {...baseProps}
        proxyTestStatus="error"
        proxyTestMessage="Proxy failed"
      />
    );
    expect(screen.getByText('Proxy failed').closest('div')?.className).toContain('text-rose-600');

    rerender(
      <ProxyTorSection
        {...baseProps}
        proxyTestStatus="testing"
        proxyTestMessage="Testing proxy"
      />
    );
    expect(screen.getByText('Testing proxy').closest('div')?.className).toContain('text-blue-600');
  });
});
