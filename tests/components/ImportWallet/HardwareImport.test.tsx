import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import type {
  ImportNetworkOwner,
  XpubData,
} from '../../../src/components/ImportWallet/hooks/useImportState';
import {
HardwareImport,
} from '../../../src/components/ImportWallet/steps/HardwareImport';

const mockConnect = vi.fn();
const mockGetXpub = vi.fn();
const mockReleaseConnection = vi.fn();
const mockLease = {};
const mockIsSecureContext = vi.fn();
const mockLoadHardwareWalletRuntime = vi.hoisted(() => vi.fn());

vi.mock('../../../src/services/hardwareWallet/runtime', () => ({
  hardwareWalletService: {
    connect: (...args: unknown[]) => mockConnect(...args),
    connectWithLease: async (...args: unknown[]) => ({
      device: await mockConnect(...args),
      lease: mockLease,
    }),
    releaseConnection: (...args: unknown[]) => mockReleaseConnection(...args),
    getXpub: (...args: unknown[]) => mockGetXpub(...args),
    getXpubForLease: (_lease: unknown, ...args: unknown[]) => mockGetXpub(...args),
  },
  DeviceType: {},
}));

vi.mock('../../../src/services/hardwareWallet/environment', () => ({
  isSecureContext: () => mockIsSecureContext(),
}));

vi.mock('../../../src/services/hardwareWallet/loader', () => ({
  loadHardwareWalletRuntime: () => mockLoadHardwareWalletRuntime(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../src/components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

interface HardwareImportOverrides {
  hardwareDeviceType?: 'ledger' | 'trezor' | 'jade';
  network?: 'mainnet' | 'testnet3' | 'signet';
  deviceConnected?: boolean;
  deviceLabel?: string | null;
  scriptType?: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  accountIndex?: number;
  xpubData?: XpubData | null;
  isFetchingXpub?: boolean;
  isConnecting?: boolean;
  hardwareError?: string | null;
  networkOwner?: ImportNetworkOwner;
  isNetworkOwnerCurrent?: (owner: { network: string; generation: number }) => boolean;
}

function renderHardwareImport(overrides: HardwareImportOverrides = {}) {
  const props = {
    hardwareDeviceType: overrides.hardwareDeviceType ?? 'ledger',
    network: overrides.network ?? 'mainnet',
    setHardwareDeviceType: vi.fn(),
    deviceConnected: overrides.deviceConnected ?? false,
    setDeviceConnected: vi.fn(),
    deviceLabel: overrides.deviceLabel ?? null,
    setDeviceLabel: vi.fn(),
    scriptType: overrides.scriptType ?? 'native_segwit',
    setScriptType: vi.fn(),
    accountIndex: overrides.accountIndex ?? 0,
    setAccountIndex: vi.fn(),
    xpubData: overrides.xpubData ?? null,
    setXpubData: vi.fn(),
    isFetchingXpub: overrides.isFetchingXpub ?? false,
    setIsFetchingXpub: vi.fn(),
    isConnecting: overrides.isConnecting ?? false,
    setIsConnecting: vi.fn(),
    hardwareError: overrides.hardwareError ?? null,
    setHardwareError: vi.fn(),
    networkOwner: overrides.networkOwner ?? { network: overrides.network ?? 'mainnet', generation: 0 },
    isNetworkOwnerCurrent: overrides.isNetworkOwnerCurrent ?? (() => true),
  };

  const view = render(<HardwareImport {...props} />);
  return {
    ...props,
    unmount: view.unmount,
    rerenderHardwareImport(next: HardwareImportOverrides) {
      view.rerender(<HardwareImport {...props} {...next} />);
    },
  };
}

async function connectAndRerender(
  rendered: ReturnType<typeof renderHardwareImport>,
  user: ReturnType<typeof userEvent.setup>,
  overrides: HardwareImportOverrides = {},
) {
  mockConnect.mockResolvedValueOnce({ name: 'Ledger Nano S Plus' });
  await user.click(screen.getByRole('button', { name: 'Connect Device' }));
  await waitFor(() => expect(mockConnect).toHaveBeenCalled());
  rendered.rerenderHardwareImport({
    ...overrides,
    deviceConnected: true,
    deviceLabel: 'Ledger Nano S Plus',
  });
  await screen.findByRole('button', { name: 'Fetch Xpub from Device' });
}

describe('HardwareImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockReset();
    mockGetXpub.mockReset();
    mockReleaseConnection.mockReset();
    mockIsSecureContext.mockReturnValue(true);
    mockReleaseConnection.mockResolvedValue(undefined);
    mockLoadHardwareWalletRuntime.mockImplementation(
      () => import('../../../src/services/hardwareWallet/runtime'),
    );
  });

  it('disables Ledger path when secure context is unavailable', async () => {
    const user = userEvent.setup();
    mockIsSecureContext.mockReturnValue(false);
    const props = renderHardwareImport({ hardwareDeviceType: 'ledger' });

    const ledgerButton = screen.getByRole('button', { name: /Ledger/i });
    const connectButton = screen.getByRole('button', { name: 'Connect Device' });

    expect(screen.getAllByText('Requires HTTPS connection')).toHaveLength(2);
    expect(ledgerButton).toBeDisabled();
    expect(connectButton).toBeDisabled();

    await user.click(ledgerButton);
    expect(props.setHardwareDeviceType).not.toHaveBeenCalled();
  });

  it('switches to trezor and clears connection/xpub state', async () => {
    const user = userEvent.setup();
    const props = renderHardwareImport({ hardwareDeviceType: 'ledger' });

    await user.click(screen.getByRole('button', { name: /Trezor/i }));

    expect(props.setHardwareDeviceType).toHaveBeenCalledWith('trezor');
    expect(props.setDeviceConnected).toHaveBeenCalledWith(false);
    expect(props.setXpubData).toHaveBeenCalledWith(null);
  });

  it('offers first-class Jade Plus import while truthfully showing its blocked status', async () => {
    const user = userEvent.setup();
    const props = renderHardwareImport({ hardwareDeviceType: 'ledger' });

    await user.click(screen.getByRole('button', { name: /Jade Plus/i }));

    expect(screen.getByText('Unverified — safely blocked')).toBeInTheDocument();
    expect(props.setHardwareDeviceType).toHaveBeenCalledWith('jade');
    expect(props.setDeviceConnected).toHaveBeenCalledWith(false);
    expect(props.setXpubData).toHaveBeenCalledWith(null);
  });

  it('disables Jade Plus selection and connection outside a secure context', () => {
    mockIsSecureContext.mockReturnValue(false);
    renderHardwareImport({ hardwareDeviceType: 'jade' });

    expect(screen.getByRole('button', { name: /^Jade /i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Connect Device' })).toBeDisabled();
  });

  it('re-selects ledger and clears connection/xpub when secure context is available', async () => {
    const user = userEvent.setup();
    const props = renderHardwareImport({ hardwareDeviceType: 'trezor' });

    await user.click(screen.getByRole('button', { name: /Ledger/i }));

    expect(props.setHardwareDeviceType).toHaveBeenCalledWith('ledger');
    expect(props.setDeviceConnected).toHaveBeenCalledWith(false);
    expect(props.setXpubData).toHaveBeenCalledWith(null);
  });

  it('shows trezor notice when trezor is selected', () => {
    renderHardwareImport({ hardwareDeviceType: 'trezor' });

    expect(screen.getByText('Trezor Suite Required')).toBeInTheDocument();
    expect(
      screen.getByText(/switch between Sanctuary and Trezor Suite/i),
    ).toBeInTheDocument();
  });

  it('connects hardware device and sets fallback label when name is missing', async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValue({});
    const props = renderHardwareImport({ hardwareDeviceType: 'ledger' });

    await user.click(screen.getByRole('button', { name: 'Connect Device' }));

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledWith('ledger', {
        chainEnvironment: 'mainnet',
        expectedModel: 'Ledger Nano S Plus',
      });
    });
    expect(props.setIsConnecting).toHaveBeenNthCalledWith(1, true);
    expect(props.setHardwareError).toHaveBeenNthCalledWith(1, null);
    expect(props.setDeviceConnected).toHaveBeenCalledWith(true);
    expect(props.setDeviceLabel).toHaveBeenCalledWith('Ledger Nano S Plus');
    expect(props.setIsConnecting).toHaveBeenLastCalledWith(false);
  });

  it('suppresses stale connection resolve and finally commits after an A-B-A owner change', async () => {
    const user = userEvent.setup();
    let resolveConnect!: (device: { name: string }) => void;
    const pendingConnect = new Promise<{ name: string }>((resolve) => {
      resolveConnect = resolve;
    });
    mockConnect.mockReturnValue(pendingConnect);
    const currentOwner: ImportNetworkOwner = { network: 'mainnet', generation: 0 };
    let activeOwner = currentOwner;
    const props = renderHardwareImport({
      networkOwner: currentOwner,
      isNetworkOwnerCurrent: (owner) => owner === activeOwner,
    });

    await user.click(screen.getByRole('button', { name: 'Connect Device' }));
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    activeOwner = { network: 'mainnet', generation: 2 };
    mockReleaseConnection.mockRejectedValueOnce(new Error('stale release failed'));
    resolveConnect({ name: 'Stale Ledger' });

    await waitFor(() => expect(props.setDeviceConnected).toHaveBeenCalledWith(false));
    expect(props.setDeviceLabel).toHaveBeenCalledWith(null);
    expect(props.setHardwareError).toHaveBeenCalledTimes(1);
    expect(props.setIsConnecting).toHaveBeenCalledTimes(1);
  });

  it('does not start hardware work for a stale rendered owner', async () => {
    const user = userEvent.setup();
    const connectProps = renderHardwareImport({
      isNetworkOwnerCurrent: () => false,
    });
    await user.click(screen.getByRole('button', { name: 'Connect Device' }));
    expect(mockConnect).not.toHaveBeenCalled();
    expect(connectProps.setIsConnecting).not.toHaveBeenCalled();

    const fetchProps = renderHardwareImport({
      deviceConnected: true,
      isNetworkOwnerCurrent: () => false,
    });
    await user.click(screen.getByRole('button', { name: 'Fetch Xpub from Device' }));
    expect(mockGetXpub).not.toHaveBeenCalled();
    expect(fetchProps.setIsFetchingXpub).not.toHaveBeenCalled();
  });

  it('stops after the hardware runtime loads if ownership changed', async () => {
    const user = userEvent.setup();
    let checks = 0;
    const props = renderHardwareImport({
      isNetworkOwnerCurrent: () => ++checks < 3,
    });

    await user.click(screen.getByRole('button', { name: 'Connect Device' }));

    await waitFor(() => expect(props.setIsConnecting).toHaveBeenCalledWith(true));
    expect(mockConnect).not.toHaveBeenCalled();
    expect(props.setIsConnecting).toHaveBeenCalledTimes(1);
  });

  it('stops connect work when ownership changes while prior release settles', async () => {
    const user = userEvent.setup();
    let checks = 0;
    const props = renderHardwareImport({
      isNetworkOwnerCurrent: () => ++checks === 1,
    });

    await user.click(screen.getByRole('button', { name: 'Connect Device' }));

    await waitFor(() => expect(props.setIsConnecting).toHaveBeenCalledWith(true));
    expect(mockConnect).not.toHaveBeenCalled();
    expect(props.setIsConnecting).toHaveBeenCalledTimes(1);
  });

  it('lets the latest same-owner connect win while an earlier runtime load is pending', async () => {
    const user = userEvent.setup();
    const runtime = await import('../../../src/services/hardwareWallet/runtime');
    let resolveRuntime!: (value: typeof runtime) => void;
    mockLoadHardwareWalletRuntime
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRuntime = resolve;
      }))
      .mockResolvedValue(runtime);
    mockConnect.mockResolvedValue({ name: 'Current Ledger' });
    const props = renderHardwareImport();

    await user.click(screen.getByRole('button', { name: 'Connect Device' }));
    await waitFor(() => expect(mockLoadHardwareWalletRuntime).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Connect Device' }));
    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1));
    resolveRuntime(runtime);

    await waitFor(() => expect(props.setDeviceLabel).toHaveBeenCalledWith('Current Ledger'));
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(props.setIsConnecting.mock.calls.filter(([value]) => value === false)).toHaveLength(1);
  });

  it('suppresses a late same-owner connect rejection after a newer connect succeeds', async () => {
    const user = userEvent.setup();
    let rejectFirst!: (error: Error) => void;
    mockConnect
      .mockImplementationOnce(() => new Promise((_, reject) => {
        rejectFirst = reject;
      }))
      .mockResolvedValueOnce({ name: 'Current Ledger' });
    const props = renderHardwareImport();

    await user.click(screen.getByRole('button', { name: 'Connect Device' }));
    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Connect Device' }));
    await waitFor(() => expect(props.setDeviceLabel).toHaveBeenCalledWith('Current Ledger'));
    rejectFirst(new Error('late stale connect'));

    await waitFor(() => {
      expect(props.setHardwareError).not.toHaveBeenCalledWith('late stale connect');
    });
    expect(props.setIsConnecting.mock.calls.filter(([value]) => value === false)).toHaveLength(1);
  });

  it('clears pending connection state when the selected model changes', async () => {
    const user = userEvent.setup();
    let resolveConnect!: (device: { name: string }) => void;
    mockConnect.mockReturnValue(new Promise((resolve) => {
      resolveConnect = resolve;
    }));
    const props = renderHardwareImport();

    await user.click(screen.getByRole('button', { name: 'Connect Device' }));
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Hardware model' }),
      'Ledger Nano X',
    );
    resolveConnect({ name: 'Stale Ledger' });

    await waitFor(() => expect(props.setIsConnecting).toHaveBeenLastCalledWith(false));
    expect(props.setDeviceConnected).not.toHaveBeenCalledWith(true);
  });

  it('clears pending connection state when the device type changes', async () => {
    const user = userEvent.setup();
    let resolveConnect!: (device: { name: string }) => void;
    mockConnect.mockReturnValue(new Promise((resolve) => {
      resolveConnect = resolve;
    }));
    const props = renderHardwareImport();

    await user.click(screen.getByRole('button', { name: 'Connect Device' }));
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: /Trezor/i }));
    resolveConnect({ name: 'Stale Ledger' });

    await waitFor(() => expect(props.setIsConnecting).toHaveBeenLastCalledWith(false));
    expect(props.setDeviceConnected).not.toHaveBeenCalledWith(true);
  });

  it('does not start xpub work for a stale rendered network owner', async () => {
    const user = userEvent.setup();
    let current = true;
    const props = renderHardwareImport({
      isNetworkOwnerCurrent: () => current,
    });
    await connectAndRerender(props, user, {
      isNetworkOwnerCurrent: () => current,
    });
    props.setIsFetchingXpub.mockClear();
    current = false;

    await user.click(screen.getByRole('button', { name: 'Fetch Xpub from Device' }));

    expect(mockGetXpub).not.toHaveBeenCalled();
    expect(props.setIsFetchingXpub).not.toHaveBeenCalled();
  });

  it('releases the connected lease when the network owner changes', async () => {
    const user = userEvent.setup();
    const props = renderHardwareImport();
    await connectAndRerender(props, user);
    mockReleaseConnection.mockClear();

    props.rerenderHardwareImport({
      deviceConnected: true,
      deviceLabel: 'Ledger Nano S Plus',
      network: 'testnet3',
      networkOwner: { network: 'testnet3', generation: 1 },
    });

    await waitFor(() => expect(mockReleaseConnection).toHaveBeenCalledWith(mockLease));
  });

  it('suppresses a stale hardware connection rejection and finally commit', async () => {
    const user = userEvent.setup();
    let rejectConnect!: (error: Error) => void;
    mockConnect.mockReturnValue(new Promise((_, reject) => {
      rejectConnect = reject;
    }));
    let current = true;
    const props = renderHardwareImport({
      isNetworkOwnerCurrent: () => current,
    });

    await user.click(screen.getByRole('button', { name: 'Connect Device' }));
    await waitFor(() => expect(mockConnect).toHaveBeenCalled());
    current = false;
    rejectConnect(new Error('stale connect failure'));

    await waitFor(() => expect(props.setHardwareError).toHaveBeenCalledTimes(1));
    expect(props.setIsConnecting).toHaveBeenCalledTimes(1);
  });

  it('suppresses stale xpub rejection and finally commits after unmount ownership loss', async () => {
    const user = userEvent.setup();
    let rejectXpub!: (error: Error) => void;
    mockGetXpub.mockReturnValue(new Promise((_, reject) => {
      rejectXpub = reject;
    }));
    let mounted = true;
    const props = renderHardwareImport({
      isNetworkOwnerCurrent: () => mounted,
    });
    await connectAndRerender(props, user);
    props.setXpubData.mockClear();
    props.setHardwareError.mockClear();
    props.setIsFetchingXpub.mockClear();

    await user.click(screen.getByRole('button', { name: 'Fetch Xpub from Device' }));
    await waitFor(() => expect(mockGetXpub).toHaveBeenCalled());
    mounted = false;
    rejectXpub(new Error('stale failure'));

    await waitFor(() => expect(props.setXpubData).not.toHaveBeenCalled());
    expect(props.setHardwareError).toHaveBeenCalledTimes(1);
    expect(props.setIsFetchingXpub).toHaveBeenCalledTimes(1);
  });

  it('suppresses a stale xpub resolve after the device request begins', async () => {
    const user = userEvent.setup();
    let resolveXpub!: (result: { xpub: string; fingerprint: string }) => void;
    mockGetXpub.mockReturnValue(new Promise((resolve) => {
      resolveXpub = resolve;
    }));
    let current = true;
    const props = renderHardwareImport({
      isNetworkOwnerCurrent: () => current,
    });
    await connectAndRerender(props, user);
    props.setXpubData.mockClear();
    props.setIsFetchingXpub.mockClear();

    await user.click(screen.getByRole('button', { name: 'Fetch Xpub from Device' }));
    await waitFor(() => expect(mockGetXpub).toHaveBeenCalled());
    current = false;
    resolveXpub({ xpub: 'stale', fingerprint: 'stale' });

    await waitFor(() => expect(props.setXpubData).not.toHaveBeenCalled());
    expect(props.setIsFetchingXpub).toHaveBeenCalledTimes(1);
  });

  it('lets the latest same-owner xpub fetch win and suppresses the earlier rejection', async () => {
    const user = userEvent.setup();
    let rejectFirst!: (error: Error) => void;
    mockGetXpub
      .mockImplementationOnce(() => new Promise((_, reject) => {
        rejectFirst = reject;
      }))
      .mockResolvedValueOnce({ xpub: 'current-xpub', fingerprint: 'a1b2c3d4' });
    const props = renderHardwareImport();
    await connectAndRerender(props, user);
    props.setXpubData.mockClear();
    props.setHardwareError.mockClear();
    props.setIsFetchingXpub.mockClear();

    await user.click(screen.getByRole('button', { name: 'Fetch Xpub from Device' }));
    await waitFor(() => expect(mockGetXpub).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Fetch Xpub from Device' }));
    await waitFor(() => expect(props.setXpubData).toHaveBeenCalledWith(expect.objectContaining({
      xpub: 'current-xpub',
    })));
    rejectFirst(new Error('late stale xpub'));

    await waitFor(() => {
      expect(props.setHardwareError).not.toHaveBeenCalledWith('late stale xpub');
    });
    expect(props.setIsFetchingXpub.mock.calls.filter(([value]) => value === false)).toHaveLength(1);
  });

  it('clears and invalidates a pending xpub fetch when reconnect starts', async () => {
    const user = userEvent.setup();
    let resolveXpub!: (result: { xpub: string; fingerprint: string }) => void;
    mockGetXpub.mockReturnValue(new Promise((resolve) => {
      resolveXpub = resolve;
    }));
    const props = renderHardwareImport();
    await connectAndRerender(props, user);
    props.setXpubData.mockClear();
    props.setIsFetchingXpub.mockClear();

    await user.click(screen.getByRole('button', { name: 'Fetch Xpub from Device' }));
    await waitFor(() => expect(mockGetXpub).toHaveBeenCalled());
    props.rerenderHardwareImport({ deviceConnected: false, deviceLabel: null });
    mockConnect.mockResolvedValueOnce({ name: 'Reconnected Ledger' });
    await user.click(screen.getByRole('button', { name: 'Connect Device' }));
    resolveXpub({ xpub: 'stale-before-reconnect', fingerprint: 'a1b2c3d4' });

    await waitFor(() => expect(props.setIsFetchingXpub).toHaveBeenLastCalledWith(false));
    expect(props.setXpubData).not.toHaveBeenCalledWith(expect.objectContaining({
      xpub: 'stale-before-reconnect',
    }));
  });

  it('invalidates a pending xpub fetch when the derivation script changes', async () => {
    const user = userEvent.setup();
    let resolveXpub!: (result: { xpub: string; fingerprint: string }) => void;
    mockGetXpub.mockReturnValue(new Promise((resolve) => {
      resolveXpub = resolve;
    }));
    const props = renderHardwareImport();
    await connectAndRerender(props, user);
    props.setXpubData.mockClear();
    props.setIsFetchingXpub.mockClear();

    await user.click(screen.getByRole('button', { name: 'Fetch Xpub from Device' }));
    await waitFor(() => expect(mockGetXpub).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: /Taproot/i }));
    resolveXpub({ xpub: 'old-script-xpub', fingerprint: 'a1b2c3d4' });

    await waitFor(() => expect(props.setScriptType).toHaveBeenCalledWith('taproot'));
    expect(props.setXpubData).not.toHaveBeenCalledWith(expect.objectContaining({
      xpub: 'old-script-xpub',
    }));
    expect(props.setIsFetchingXpub).toHaveBeenLastCalledWith(false);
  });

  it('suppresses a pending xpub error when the account index changes', async () => {
    const user = userEvent.setup();
    let rejectXpub!: (error: Error) => void;
    mockGetXpub.mockReturnValue(new Promise((_, reject) => {
      rejectXpub = reject;
    }));
    const props = renderHardwareImport();
    await connectAndRerender(props, user);
    props.setHardwareError.mockClear();
    props.setIsFetchingXpub.mockClear();

    await user.click(screen.getByRole('button', { name: 'Fetch Xpub from Device' }));
    await waitFor(() => expect(mockGetXpub).toHaveBeenCalled());
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } });
    rejectXpub(new Error('old-account failure'));

    await waitFor(() => expect(props.setAccountIndex).toHaveBeenCalledWith(2));
    expect(props.setHardwareError).not.toHaveBeenCalledWith('old-account failure');
    expect(props.setIsFetchingXpub).toHaveBeenLastCalledWith(false);
  });

  it('releases model A lease and suppresses its xpub after selecting model B', async () => {
    const user = userEvent.setup();
    let resolveXpub!: (result: { xpub: string; fingerprint: string }) => void;
    mockGetXpub.mockReturnValue(new Promise((resolve) => {
      resolveXpub = resolve;
    }));
    const props = renderHardwareImport();
    await connectAndRerender(props, user);
    props.setXpubData.mockClear();

    await user.click(screen.getByRole('button', { name: 'Fetch Xpub from Device' }));
    await waitFor(() => expect(mockGetXpub).toHaveBeenCalled());
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Hardware model' }),
      'Ledger Nano X',
    );
    await waitFor(() => expect(mockReleaseConnection).toHaveBeenCalledWith(mockLease));

    resolveXpub({ xpub: 'model-a-xpub', fingerprint: 'a1b2c3d4' });
    await waitFor(() => expect(props.setDeviceConnected).toHaveBeenCalledWith(false));
    expect(props.setXpubData).not.toHaveBeenCalledWith(expect.objectContaining({
      xpub: 'model-a-xpub',
    }));
  });

  it('can connect model B after releasing model A fails', async () => {
    const user = userEvent.setup();
    const props = renderHardwareImport();
    await connectAndRerender(props, user);
    mockReleaseConnection.mockRejectedValueOnce(new Error('release A failed'));

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Hardware model' }),
      'Ledger Nano X',
    );
    await waitFor(() => expect(mockReleaseConnection).toHaveBeenCalledWith(mockLease));
    props.rerenderHardwareImport({ deviceConnected: false, deviceLabel: null });

    mockConnect.mockResolvedValueOnce({ name: 'Ledger Nano X' });
    await user.click(screen.getByRole('button', { name: 'Connect Device' }));

    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(2));
    expect(props.setDeviceConnected).toHaveBeenLastCalledWith(true);
    expect(props.setDeviceLabel).toHaveBeenLastCalledWith('Ledger Nano X');
  });

  it('uses trezor fallback label when connected device has no name', async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValue({});
    const props = renderHardwareImport({ hardwareDeviceType: 'trezor' });

    await user.click(screen.getByRole('button', { name: 'Connect Device' }));

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledWith('trezor', {
        chainEnvironment: 'mainnet',
        expectedModel: 'Trezor Model One',
      });
    });
    expect(props.setDeviceLabel).toHaveBeenCalledWith('Trezor Model One');
  });

  it('uses connected device name when provided', async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValue({ name: 'Trezor Safe 5' });
    const props = renderHardwareImport({ hardwareDeviceType: 'trezor' });

    await user.click(screen.getByRole('button', { name: 'Connect Device' }));

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledWith('trezor', {
        chainEnvironment: 'mainnet',
        expectedModel: 'Trezor Model One',
      });
    });
    expect(props.setDeviceLabel).toHaveBeenCalledWith('Trezor Safe 5');
  });

  it('binds a Jade Plus connection attempt to the selected chain and model', async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValue({});
    const props = renderHardwareImport({ hardwareDeviceType: 'jade', network: 'signet' });

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Hardware model' }),
      'Blockstream Jade Plus',
    );

    await user.click(screen.getByRole('button', { name: 'Connect Device' }));

    await waitFor(() => {
      expect(mockConnect).toHaveBeenCalledWith('jade', {
        chainEnvironment: 'signet',
        expectedModel: 'Blockstream Jade Plus',
      });
    });
    expect(props.setDeviceLabel).toHaveBeenCalledWith('Blockstream Jade Plus');
  });

  it('passes the exact user-selected catalog model for each hardware vendor', async () => {
    const user = userEvent.setup();
    mockConnect.mockResolvedValue({});
    renderHardwareImport({ hardwareDeviceType: 'ledger' });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Hardware model' }), 'Ledger Nano X');
    await user.click(screen.getByRole('button', { name: 'Connect Device' }));

    await waitFor(() => expect(mockConnect).toHaveBeenCalledWith('ledger', {
      chainEnvironment: 'mainnet',
      expectedModel: 'Ledger Nano X',
    }));
  });

  it('shows connect and fetch errors from hardware service', async () => {
    const user = userEvent.setup();
    mockConnect.mockRejectedValueOnce(new Error('Device not found'));
    const connectProps = renderHardwareImport({ hardwareDeviceType: 'trezor' });

    await user.click(screen.getByRole('button', { name: 'Connect Device' }));
    await waitFor(() => {
      expect(connectProps.setHardwareError).toHaveBeenCalledWith('Device not found');
    });
    connectProps.unmount();

    mockGetXpub.mockRejectedValueOnce('boom');
    const fetchProps = renderHardwareImport();
    await connectAndRerender(fetchProps, user);
    await user.click(screen.getByRole('button', { name: 'Fetch Xpub from Device' }));
    await waitFor(() => {
      expect(fetchProps.setHardwareError).toHaveBeenCalledWith('Failed to fetch xpub');
    });
  });

  it('handles non-Error connect failures with fallback message', async () => {
    const user = userEvent.setup();
    mockConnect.mockRejectedValueOnce('nope');
    const props = renderHardwareImport({ hardwareDeviceType: 'ledger' });

    await user.click(screen.getByRole('button', { name: 'Connect Device' }));

    await waitFor(() => {
      expect(props.setHardwareError).toHaveBeenCalledWith('Failed to connect device');
    });
  });

  it('handles Error-based xpub fetch failures by surfacing error message', async () => {
    const user = userEvent.setup();
    mockGetXpub.mockRejectedValueOnce(new Error('xpub fetch failed'));
    const props = renderHardwareImport();
    await connectAndRerender(props, user);

    await user.click(screen.getByRole('button', { name: 'Fetch Xpub from Device' }));

    await waitFor(() => {
      expect(props.setHardwareError).toHaveBeenCalledWith('xpub fetch failed');
    });
  });

  it('supports connected-state controls and account index normalization', async () => {
    const user = userEvent.setup();
    const props = renderHardwareImport({
      deviceConnected: true,
      deviceLabel: 'My Trezor',
      scriptType: 'native_segwit',
      accountIndex: 1,
    });

    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText("m/84'/0'/1'")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Taproot/i }));
    expect(props.setScriptType).toHaveBeenCalledWith('taproot');
    expect(props.setXpubData).toHaveBeenCalledWith(null);

    const accountInput = screen.getByRole('spinbutton');
    fireEvent.change(accountInput, { target: { value: '-5' } });
    expect(props.setAccountIndex).toHaveBeenCalledWith(0);

    fireEvent.change(accountInput, { target: { value: '' } });
    expect(props.setAccountIndex).toHaveBeenCalledWith(0);
  });

  it('fetches xpub and stores parsed data when device returns valid payload', async () => {
    const user = userEvent.setup();
    mockGetXpub.mockResolvedValue({
      xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKpQf4mN6r4Qx',
      fingerprint: 'a1b2c3d4',
    });
    const props = renderHardwareImport({
      scriptType: 'taproot',
      accountIndex: 2,
    });
    await connectAndRerender(props, user, { scriptType: 'taproot', accountIndex: 2 });
    props.setIsFetchingXpub.mockClear();

    await user.click(screen.getByRole('button', { name: 'Fetch Xpub from Device' }));

    await waitFor(() => {
      expect(mockGetXpub).toHaveBeenCalledWith("m/86'/0'/2'");
    });
    expect(props.setIsFetchingXpub).toHaveBeenNthCalledWith(1, true);
    expect(props.setHardwareError).toHaveBeenNthCalledWith(1, null);
    expect(props.setXpubData).toHaveBeenCalledWith({
      xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKpQf4mN6r4Qx',
      fingerprint: 'a1b2c3d4',
      path: "m/86'/0'/2'",
    });
    expect(props.setIsFetchingXpub).toHaveBeenLastCalledWith(false);
  });

  it('shows retrieve error when xpub response is incomplete', async () => {
    const user = userEvent.setup();
    mockGetXpub.mockResolvedValue({ xpub: '', fingerprint: '' });
    const props = renderHardwareImport();
    await connectAndRerender(props, user);

    await user.click(screen.getByRole('button', { name: 'Fetch Xpub from Device' }));

    await waitFor(() => {
      expect(props.setHardwareError).toHaveBeenCalledWith(
        'Failed to retrieve xpub from device',
      );
    });
  });

  it('requires an owned hardware lease even if rendered state says connected', async () => {
    const user = userEvent.setup();
    const props = renderHardwareImport({ deviceConnected: true });

    await user.click(screen.getByRole('button', { name: 'Fetch Xpub from Device' }));

    await waitFor(() => expect(props.setHardwareError).toHaveBeenCalledWith(
      'Connect a hardware device before fetching its xpub',
    ));
    expect(mockGetXpub).not.toHaveBeenCalled();
    expect(props.setIsFetchingXpub).toHaveBeenLastCalledWith(false);
  });

  it('renders fetched xpub summary, fetch-again state, and inline error', () => {
    const longXpub = `xpub${'A'.repeat(64)}`;
    renderHardwareImport({
      deviceConnected: true,
      xpubData: {
        xpub: longXpub,
        fingerprint: 'ffffeeee',
        path: "m/84'/0'/0'",
      },
      hardwareError: 'Hardware unavailable',
    });

    expect(screen.getByText('Xpub Retrieved Successfully')).toBeInTheDocument();
    expect(screen.getByText('ffffeeee')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fetch Again' })).toBeInTheDocument();
    expect(screen.getByText('Hardware unavailable')).toBeInTheDocument();
  });

  it('shows fetching state label while xpub retrieval is in progress', () => {
    renderHardwareImport({
      deviceConnected: true,
      isFetchingXpub: true,
    });

    expect(screen.getByRole('button', { name: /fetching from device/i })).toBeDisabled();
  });

  it('shows connecting state label while device connection is in progress', () => {
    renderHardwareImport({
      isConnecting: true,
    });

    expect(screen.getByRole('button', { name: /connecting/i })).toBeDisabled();
  });

  it('renders unsupported ledger style branch when trezor is selected in insecure context', () => {
    mockIsSecureContext.mockReturnValue(false);
    renderHardwareImport({ hardwareDeviceType: 'trezor' });

    const ledgerButton = screen.getByRole('button', { name: /Ledger/i });
    expect(ledgerButton).toHaveClass('opacity-50');
    expect(ledgerButton).toHaveClass('cursor-not-allowed');
  });

  it('guards against ledger selection when forced click bypasses disabled state', () => {
    mockIsSecureContext.mockReturnValue(false);
    const props = renderHardwareImport({ hardwareDeviceType: 'trezor' });

    const ledgerButton = screen.getByRole('button', { name: /Ledger/i });
    expect(ledgerButton).toBeDisabled();

    // Exercise the internal no-op branch when insecure context blocks ledger selection.
    ledgerButton.removeAttribute('disabled');
    fireEvent.click(ledgerButton);

    expect(props.setHardwareDeviceType).not.toHaveBeenCalled();
    expect(props.setDeviceConnected).not.toHaveBeenCalled();
    expect(props.setXpubData).not.toHaveBeenCalled();
  });
});
