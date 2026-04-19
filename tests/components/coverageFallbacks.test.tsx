import { render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AgentOverridesModal } from '../../components/AgentManagement/AgentOverridesModal';
import {
  formatAlertLimit,
  formatLimit,
  formatNumberLimit,
  formatWalletType,
} from '../../components/AgentManagement/formatters';
import { CreateWalletStepContent } from '../../components/CreateWallet/CreateWalletStepContent';
import { SignerCompatibilityWarning } from '../../components/CreateWallet/SignerCompatibilityWarning';
import { ImportWalletFooter } from '../../components/ImportWallet/ImportWalletFooter';
import { ImportWalletStepContent } from '../../components/ImportWallet/ImportWalletStepContent';
import { QrScannerCard } from '../../components/ImportWallet/steps/QrScanSections';
import { BundledTorContainerCard } from '../../components/NodeConfig/BundledTorContainerCard';
import { useElectrumServerControls } from '../../components/NodeConfig/useElectrumServerControls';
import { useProxyTorControls } from '../../components/NodeConfig/useProxyTorControls';
import { RBFModal } from '../../components/TransactionActions/RBFModal';
import { WalletDetailTabContent } from '../../components/WalletDetail/WalletDetailTabContent';
import {
  getDisplayReceiveAddresses,
  getPayjoinUriOptions,
  shouldFetchUnusedReceiveAddresses,
} from '../../components/WalletDetail/modals/receiveModalData';
import { getSharedUsers } from '../../components/WalletDetail/tabs/access/accessTabData';
import { WalletBalance } from '../../components/WalletList/WalletGridCardBalance';
import { useDeviceListPreferences } from '../../components/DeviceList/useDeviceListPreferences';
import { useWalletDraftNotifications } from '../../components/WalletDetail/hooks/useWalletDraftNotifications';
import * as adminApi from '../../src/api/admin';

const mockUseUser = vi.hoisted(() => vi.fn());

vi.mock('@yudiel/react-qr-scanner', () => ({
  Scanner: () => <div data-testid="qr-scanner" />,
}));

vi.mock('../../contexts/UserContext', () => ({
  useUser: mockUseUser,
}));

vi.mock('../../src/api/admin', () => ({
  getAgentFundingOverrides: vi.fn(),
}));

const agent = {
  id: 'agent-1',
  name: 'Treasury Agent',
} as any;

function createImportState(overrides: Record<string, unknown> = {}) {
  return {
    step: 1,
    isValidating: false,
    isImporting: false,
    format: null,
    importData: '',
    walletName: '',
    xpubData: null,
    qrScanned: false,
    validationResult: null,
    ...overrides,
  } as any;
}

describe('coverage fallback branches', () => {
  it('covers agent management formatter fallbacks', () => {
    expect(formatWalletType('single_sig')).toBe('Single sig');
    expect(formatWalletType('watch_only')).toBe('watch_only');
    expect(formatLimit('not-a-bigint')).toBe('not-a-bigint sats');
    expect(formatAlertLimit(null)).toBe('Off');
    expect(formatNumberLimit(null, 'minutes')).toBe('Off');
  });

  it('renders recoverable owner override load errors directly', async () => {
    vi.mocked(adminApi.getAgentFundingOverrides).mockRejectedValueOnce(new Error('override load failed'));

    render(<AgentOverridesModal agent={agent} onClose={vi.fn()} />);

    expect(await screen.findByText('override load failed')).toBeInTheDocument();
  });

  it('covers create wallet null render guards', () => {
    const { container } = render(
      <CreateWalletStepContent
        step={2}
        walletType={null}
        setWalletType={vi.fn()}
        compatibleDevices={[]}
        incompatibleDevices={[]}
        selectedDeviceIds={new Set()}
        toggleDevice={vi.fn()}
        getDisplayAccount={vi.fn()}
        walletName=""
        setWalletName={vi.fn()}
        network="mainnet"
        setNetwork={vi.fn()}
        scriptType="native_segwit"
        setScriptType={vi.fn()}
        quorumM={2}
        setQuorumM={vi.fn()}
        availableDevices={[]}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('covers signer warning empty-state guard', () => {
    const { container } = render(
      <MemoryRouter>
        <SignerCompatibilityWarning incompatibleDevices={[]} accountTypeLabel="Native SegWit" />
      </MemoryRouter>
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('covers import wallet footer and step-content fallback branches', () => {
    render(
      <ImportWalletFooter
        state={createImportState({ step: 0 })}
        onNext={vi.fn()}
        onImport={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /Next Step/i })).toBeEnabled();

    render(
      <ImportWalletFooter
        state={createImportState({ step: 2, format: 'unknown' })}
        onNext={vi.fn()}
        onImport={vi.fn()}
      />
    );
    expect(screen.getAllByRole('button', { name: /Next Step/i }).at(-1)).toBeEnabled();

    const { container } = render(<ImportWalletStepContent state={createImportState({ step: 3 })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('covers device preference update fallbacks when user settings are absent', () => {
    const updatePreferences = vi.fn();
    mockUseUser.mockReturnValue({
      user: { preferences: null },
      updatePreferences,
    });

    const { result } = renderHook(() => useDeviceListPreferences());
    result.current.setViewMode('list');

    expect(updatePreferences).toHaveBeenCalledWith({
      viewSettings: {
        devices: { layout: 'list' },
      },
    });
  });

  it('covers completed QR scanner progress fallback', () => {
    render(
      <QrScannerCard
        cameraActive
        cameraError={null}
        qrScanned={false}
        urProgress={100}
        onCameraError={vi.fn()}
        onQrScan={vi.fn()}
        onStartCamera={vi.fn()}
        onStopCamera={vi.fn()}
      />
    );

    expect(screen.getByTestId('qr-scanner')).toBeInTheDocument();
    expect(screen.queryByText('Position the QR code within the frame')).not.toBeInTheDocument();
  });

  it('covers node config control fallbacks', () => {
    const { container } = render(
      <BundledTorContainerCard
        nodeConfig={{ proxyHost: '127.0.0.1' } as any}
        torContainerStatus={{ available: false } as any}
        isTorContainerLoading={false}
        torContainerMessage=""
        onProxyPreset={vi.fn()}
        onTorContainerToggle={vi.fn()}
        onRefreshTorStatus={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();

    const setAllServers = vi.fn();
    const { result: electrumResult } = renderHook(() => useElectrumServerControls({
      allServers: [{ id: 'server-1', network: 'mainnet' }],
      setAllServers,
    } as any));
    expect(electrumResult.current.getServersForNetwork('mainnet')).toEqual([
      { id: 'server-1', network: 'mainnet' },
    ]);

    const setNodeConfig = vi.fn();
    const { result: proxyResult } = renderHook(() => useProxyTorControls({
      nodeConfig: null,
      setNodeConfig,
      torContainerStatus: null,
      setTorContainerStatus: vi.fn(),
      showCustomProxy: false,
      setShowCustomProxy: vi.fn(),
    }));
    proxyResult.current.handleProxyPreset('tor');
    expect(setNodeConfig).not.toHaveBeenCalled();
  });

  it('covers RBF modal without a current fee rate', () => {
    render(
      <RBFModal
        handlers={{
          closeRBFModal: vi.fn(),
          handleRBF: vi.fn(),
          setNewFeeRate: vi.fn(),
        } as any}
        state={{
          showRBFModal: true,
          rbfStatus: { replaceable: true, minNewFeeRate: 5 },
          newFeeRate: 6,
          processing: false,
        } as any}
      />
    );

    expect(screen.getByText('Bump Transaction Fee (RBF)')).toBeInTheDocument();
    expect(screen.queryByText(/Current fee rate:/)).not.toBeInTheDocument();
  });

  it('covers wallet detail and receive-data fallback helpers', () => {
    const { container } = render(
      <WalletDetailTabContent
        visibleActiveTab={'unknown' as any}
        transactionsTabProps={{} as any}
        utxoTabProps={{} as any}
        addressesTabProps={{} as any}
        draftsTabProps={{} as any}
        statsTabProps={{} as any}
        logTabProps={{} as any}
        accessTabProps={{} as any}
        settingsTabProps={{} as any}
      />
    );
    expect(container.querySelector('.min-h-\\[400px\\]')).toBeEmptyDOMElement();

    const usedAddress = { id: 'used', address: 'bc1qused', isChange: false, used: true } as any;
    const fetchedAddress = { id: 'fresh', address: 'bc1qfresh', isChange: false, used: false } as any;
    expect(getDisplayReceiveAddresses([usedAddress], [fetchedAddress])).toEqual([fetchedAddress]);
    expect(shouldFetchUnusedReceiveAddresses([fetchedAddress], false, true)).toBe(false);
    expect(shouldFetchUnusedReceiveAddresses([usedAddress], true, true)).toBe(false);
    expect(getPayjoinUriOptions('0')).toBeUndefined();
    expect(getSharedUsers(null)).toEqual([]);
  });

  it('covers wallet draft notification and zero pending balance fallbacks', () => {
    const setDraftsCount = vi.fn();
    const addAppNotification = vi.fn();
    const removeNotificationsByType = vi.fn();
    const { result } = renderHook(() => useWalletDraftNotifications({
      walletId: undefined,
      setDraftsCount,
      addAppNotification,
      removeNotificationsByType,
    }));

    result.current(2);
    expect(setDraftsCount).toHaveBeenCalledWith(2);
    expect(addAppNotification).not.toHaveBeenCalled();
    expect(removeNotificationsByType).not.toHaveBeenCalled();

    render(
      <WalletBalance
        wallet={{ balance: 10_000 } as any}
        pendingData={{ count: 0, net: 0, hasIncoming: false, hasOutgoing: false }}
        format={(value) => `${value} sats`}
        formatFiat={(value) => `$${value}`}
        showFiat
      />
    );
    expect(screen.getByText('10000 sats')).toBeInTheDocument();
    expect(screen.queryByText('(0 sats)')).not.toBeInTheDocument();
  });
});
