import { act,render,screen,waitFor } from '@testing-library/react';
import { MemoryRouter,Route,Routes } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { SendTransactionPage } from '../../../components/send/SendTransactionPage';
import * as UserContext from '../../../contexts/UserContext';
import * as bitcoinApi from '../../../src/api/bitcoin';
import * as devicesApi from '../../../src/api/devices';
import * as transactionsApi from '../../../src/api/transactions';
import * as walletsApi from '../../../src/api/wallets';

const mockNavigate = vi.fn();
const showInfoMock = vi.fn();

const wizardMockHelpers = vi.hoisted(() => ({
  getLoadedDataValues(props: any) {
    return [
      ['wallet-type', props.wallet?.type ?? ''],
      ['device-count', props.devices?.length ?? 0],
      ['address-count', props.walletAddresses?.length ?? 0],
      ['min-fee', props.fees?.minimumFee ?? ''],
      ['mempool-count', props.mempoolBlocks?.length ?? 0],
      ['draft-fee', props.draftTxData?.fee ?? ''],
    ] as Array<[string, string | number]>;
  },

  getInitialStateValues(initialState: any) {
    return [
      ['tx-type', initialState?.transactionType ?? ''],
      ['selected-utxos', (initialState?.selectedUTXOs ?? []).join(',')],
      ['show-coin-control', String(!!initialState?.showCoinControl)],
      ['signed-devices', (initialState?.signedDevices ?? []).length],
      ['outputs-valid-count', (initialState?.outputsValid ?? []).length],
    ] as Array<[string, string | number]>;
  },
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../../contexts/UserContext', () => ({
  useUser: vi.fn(),
}));

vi.mock('../../../hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    showInfo: showInfoMock,
    handleError: vi.fn(),
  }),
}));

vi.mock('../../../src/api/wallets', () => ({
  getWallet: vi.fn(),
}));

vi.mock('../../../src/api/transactions', () => ({
  getUTXOs: vi.fn(),
  getAddresses: vi.fn(),
}));

vi.mock('../../../src/api/bitcoin', () => ({
  getFeeEstimates: vi.fn(),
  getMempoolData: vi.fn(),
}));

vi.mock('../../../src/api/devices', () => ({
  getDevices: vi.fn(),
}));

vi.mock('../../../components/send/SendTransactionWizard', () => ({
  SendTransactionWizard: (props: any) => {
    const values = [
      ...wizardMockHelpers.getLoadedDataValues(props),
      ...wizardMockHelpers.getInitialStateValues(props.initialState),
    ];

    return (
      <div data-testid="wizard">
        {values.map(([testId, value]) => (
          <span key={testId} data-testid={testId}>{value}</span>
        ))}
        <button onClick={props.onCancel}>cancel</button>
      </div>
    );
  },
}));

describe('SendTransactionPage branch coverage', () => {
  const baseWallet = {
    id: 'wallet-1',
    name: 'Primary',
    type: 'single_sig',
    balance: 100000,
    scriptType: 'native_segwit',
    userRole: 'owner',
    descriptor: '',
    fingerprint: 'abcd1234',
  };

  const baseUtxos = {
    utxos: [
      {
        id: 'u1',
        txid: 'tx1',
        vout: 0,
        address: 'bc1q-1',
        amount: 40000,
        confirmations: 3,
        spendable: true,
        frozen: false,
      },
      {
        id: 'u2',
        txid: 'tx2',
        vout: 1,
        address: 'bc1q-2',
        amount: 30000,
        confirmations: 8,
        spendable: true,
        frozen: false,
      },
    ],
  };

  const baseFees = {
    fastest: 35,
    hour: 20,
    economy: 10,
    minimum: 2,
  };

  const renderPage = (state?: Record<string, unknown>) =>
    render(
      <MemoryRouter initialEntries={[{ pathname: '/wallets/wallet-1/send', state }]}>
        <Routes>
          <Route path="/wallets/:id/send" element={<SendTransactionPage />} />
        </Routes>
      </MemoryRouter>
    );

  const createDeferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(UserContext.useUser).mockReturnValue({
      user: { id: 'user-1', username: 'alice' },
      isLoading: false,
    } as any);

    vi.mocked(walletsApi.getWallet).mockResolvedValue(baseWallet as any);
    vi.mocked(transactionsApi.getUTXOs).mockResolvedValue(baseUtxos as any);
    vi.mocked(bitcoinApi.getFeeEstimates).mockResolvedValue(baseFees as any);
    vi.mocked(bitcoinApi.getMempoolData).mockResolvedValue({
      mempool: [{ blockSize: 1 } as any],
      blocks: [{ blockSize: 2 } as any],
      queuedBlocksSummary: { totalTxCount: 3 } as any,
    } as any);
    vi.mocked(transactionsApi.getAddresses).mockResolvedValue([] as any);
    vi.mocked(devicesApi.getDevices).mockResolvedValue([] as any);
  });

  it('covers multisig descriptor fallback matching, address mapping, and fee fallback branches', async () => {
    vi.mocked(walletsApi.getWallet).mockResolvedValue({
      ...baseWallet,
      type: 'multi_sig',
      fingerprint: undefined,
      descriptor: "wsh(sortedmulti(2,[abcd1234/48'/0'/0'/2']xpubA,[eeee1111/48'/0'/0'/2']xpubB))",
    } as any);
    vi.mocked(transactionsApi.getAddresses).mockResolvedValue([
      { address: 'bc1q-owned', used: true, index: 0, isChange: false },
      { address: 'bc1q-change', used: false, index: 1, isChange: true },
    ] as any);
    vi.mocked(bitcoinApi.getFeeEstimates).mockResolvedValue({
      fastest: 35,
      hour: 20,
      economy: 10,
      minimum: undefined,
    } as any);
    vi.mocked(bitcoinApi.getMempoolData).mockResolvedValue(null as any);
    vi.mocked(devicesApi.getDevices).mockResolvedValue([
      { id: 'no-match', label: 'No Match', type: 'ledger', wallets: [{ wallet: { id: 'other-wallet' } }] },
      { id: 'fp-match', label: 'FP Match', type: 'coldcard', fingerprint: 'ABCD1234', wallets: undefined },
      { id: 'missing-fp', label: 'Missing FP', type: 'trezor', wallets: [] },
    ] as any);

    const draft = {
      id: 'draft-ms',
      walletId: 'wallet-1',
      userId: 'user-1',
      recipient: 'bc1q-owned',
      amount: 20000,
      feeRate: 5,
      selectedUtxoIds: [],
      enableRBF: true,
      subtractFees: false,
      sendMax: false,
      isRBF: false,
      outputs: [{ address: 'bc1q-external', amount: 20000 }],
      psbtBase64: 'unsigned',
      signedPsbtBase64: 'signed',
      fee: 500,
      totalInput: 30000,
      totalOutput: 29500,
      changeAmount: 9500,
      effectiveAmount: 20000,
      inputPaths: [],
      status: 'partial',
      signedDeviceIds: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    renderPage({ draft });

    await waitFor(() => {
      expect(screen.getByTestId('wizard')).toBeInTheDocument();
    });

    expect(screen.getByTestId('wallet-type')).toHaveTextContent('multi_sig');
    expect(screen.getByTestId('device-count')).toHaveTextContent('1');
    expect(screen.getByTestId('address-count')).toHaveTextContent('2');
    expect(screen.getByTestId('min-fee')).toHaveTextContent('1');
    expect(screen.getByTestId('tx-type')).toHaveTextContent('consolidation');
    expect(screen.getByTestId('signed-devices')).toHaveTextContent('0');
    expect(screen.getByTestId('mempool-count')).toHaveTextContent('0');
  });

  it('covers draft UTXO filtering with locked-draft fallback and unavailable-info warning', async () => {
    vi.mocked(transactionsApi.getUTXOs).mockResolvedValue({
      utxos: [
        {
          id: 'u1',
          txid: 'tx1',
          vout: 0,
          address: 'bc1q-1',
          amount: 40000,
          confirmations: 3,
          spendable: true,
          frozen: false,
        },
        {
          id: 'u2',
          txid: 'tx2',
          vout: 1,
          address: 'bc1q-2',
          amount: 30000,
          confirmations: 8,
          spendable: false,
          frozen: true,
          lockedByDraftId: 'draft-lock',
        },
      ],
    } as any);
    vi.mocked(transactionsApi.getAddresses).mockResolvedValue([{ address: 'bc1q-not-recipient' }] as any);

    const draft = {
      id: 'draft-lock',
      walletId: 'wallet-1',
      userId: 'user-1',
      recipient: 'bc1q-external',
      amount: 25000,
      feeRate: 3,
      selectedUtxoIds: ['tx1:0', 'tx2:1', 'missing:9'],
      enableRBF: true,
      subtractFees: false,
      sendMax: false,
      isRBF: false,
      psbtBase64: 'unsigned',
      fee: 400,
      totalInput: 70000,
      totalOutput: 69600,
      changeAmount: 44600,
      effectiveAmount: 25000,
      inputPaths: [],
      status: 'unsigned',
      signedDeviceIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    renderPage({ draft });

    await waitFor(() => {
      expect(screen.getByTestId('wizard')).toBeInTheDocument();
    });

    expect(screen.getByTestId('selected-utxos')).toHaveTextContent('tx1:0,tx2:1');
    expect(screen.getByTestId('show-coin-control')).toHaveTextContent('true');
    expect(screen.getByTestId('tx-type')).toHaveTextContent('standard');
    expect(showInfoMock).toHaveBeenCalledWith('1 UTXOs are no longer available');
  });

  it('covers RBF draft branch that preserves selected UTXOs without availability filtering', async () => {
    const draft = {
      id: 'draft-rbf',
      walletId: 'wallet-1',
      userId: 'user-1',
      recipient: 'bc1q-rbf',
      amount: 10000,
      feeRate: 2,
      selectedUtxoIds: ['missing:1', 'missing:2'],
      enableRBF: true,
      subtractFees: false,
      sendMax: false,
      isRBF: true,
      psbtBase64: 'unsigned',
      fee: 200,
      totalInput: 12000,
      totalOutput: 11800,
      changeAmount: 1800,
      effectiveAmount: 10000,
      inputPaths: [],
      status: 'unsigned',
      signedDeviceIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    renderPage({ draft });

    await waitFor(() => {
      expect(screen.getByTestId('wizard')).toBeInTheDocument();
    });

    expect(screen.getByTestId('selected-utxos')).toHaveTextContent('missing:1,missing:2');
    expect(showInfoMock).not.toHaveBeenCalledWith(expect.stringContaining('no longer available'));
  });

  it('covers preselected UTXO frozen-removal branches (singular and plural)', async () => {
    vi.mocked(transactionsApi.getUTXOs).mockResolvedValue({
      utxos: [
        { id: 'u1', txid: 'tx1', vout: 0, amount: 1, address: 'a1', confirmations: 1, spendable: true, frozen: true },
        { id: 'u2', txid: 'tx2', vout: 1, amount: 1, address: 'a2', confirmations: 1, spendable: true, frozen: false },
        { id: 'u3', txid: 'tx3', vout: 2, amount: 1, address: 'a3', confirmations: 1, spendable: true, frozen: true },
      ],
    } as any);

    const first = renderPage({ preSelected: ['tx1:0', 'tx2:1'] });
    await waitFor(() => {
      expect(screen.getByTestId('wizard')).toBeInTheDocument();
    });
    expect(screen.getByTestId('selected-utxos')).toHaveTextContent('tx2:1');
    expect(screen.getByTestId('show-coin-control')).toHaveTextContent('true');
    expect(showInfoMock).toHaveBeenCalledWith('1 frozen UTXO removed from selection');
    first.unmount();

    showInfoMock.mockClear();
    renderPage({ preSelected: ['tx1:0', 'tx3:2'] });
    await waitFor(() => {
      expect(screen.getByTestId('wizard')).toBeInTheDocument();
    });
    expect(screen.getByTestId('selected-utxos')).toHaveTextContent('');
    expect(screen.getByTestId('show-coin-control')).toHaveTextContent('false');
    expect(showInfoMock).toHaveBeenCalledWith('2 frozen UTXOs removed from selection');
  });

  it('covers mountedRef guard after unmount before parallel requests resolve', async () => {
    const deferredUtxos = createDeferred<any>();
    vi.mocked(transactionsApi.getUTXOs).mockReturnValue(deferredUtxos.promise);

    const view = renderPage();
    await waitFor(() => {
      expect(walletsApi.getWallet).toHaveBeenCalledWith('wallet-1');
    });

    view.unmount();

    await act(async () => {
      deferredUtxos.resolve(baseUtxos as any);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByTestId('wizard')).not.toBeInTheDocument();
  });

  it('covers multisig descriptor branch where no fingerprint regex match is found', async () => {
    vi.mocked(walletsApi.getWallet).mockResolvedValue({
      ...baseWallet,
      type: 'multi_sig',
      descriptor: 'wsh(sortedmulti(2,xpubA,xpubB))',
    } as any);
    vi.mocked(devicesApi.getDevices).mockResolvedValue([
      { id: 'd1', type: 'ledger', label: 'Ledger', wallets: [] },
    ] as any);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('wizard')).toBeInTheDocument();
    });

    expect(screen.getByTestId('device-count')).toHaveTextContent('0');
  });

  it('covers draft branch with no valid selected UTXOs and address fallback defaults', async () => {
    vi.mocked(transactionsApi.getAddresses).mockResolvedValue(undefined as any);

    const outputsWithoutArray = {
      length: 1,
      map: () => undefined,
    };

    const draft = {
      id: 'draft-no-valid',
      walletId: 'wallet-1',
      userId: 'user-1',
      recipient: 'bc1q-fallback',
      amount: 10000,
      feeRate: 4,
      selectedUtxoIds: ['missing:9'],
      enableRBF: true,
      subtractFees: false,
      sendMax: false,
      isRBF: false,
      outputs: outputsWithoutArray,
      psbtBase64: 'unsigned',
      fee: 350,
      totalInput: 12000,
      totalOutput: 11650,
      changeAmount: 1650,
      effectiveAmount: 10000,
      inputPaths: [],
      status: 'unsigned',
      signedDeviceIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    renderPage({ draft });

    await waitFor(() => {
      expect(screen.getByTestId('wizard')).toBeInTheDocument();
    });

    expect(screen.getByTestId('selected-utxos')).toHaveTextContent('');
    expect(screen.getByTestId('show-coin-control')).toHaveTextContent('false');
    expect(screen.getByTestId('tx-type')).toHaveTextContent('standard');
    expect(screen.getByTestId('outputs-valid-count')).toHaveTextContent('0');
    expect(showInfoMock).toHaveBeenCalledWith('1 UTXOs are no longer available');
  });
});
