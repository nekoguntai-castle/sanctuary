import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { OutputsStep } from '../../../components/send/steps/OutputsStep';
import * as SendContext from '../../../contexts/send';
import * as CurrencyContext from '../../../contexts/CurrencyContext';
import * as bip21 from '../../../utils/bip21Parser';
import * as validate from '../../../utils/validateAddress';
import * as txApi from '../../../src/api/transactions';

const capture = vi.hoisted(() => ({
  outputRows: [] as any[],
  coinProps: null as any,
  feeProps: null as any,
  advancedProps: null as any,
}));

const loggerSpies = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => loggerSpies,
}));

vi.mock('../../../contexts/send', () => ({
  useSendTransaction: vi.fn(),
}));

vi.mock('../../../contexts/CurrencyContext', () => ({
  useCurrency: vi.fn(),
}));

vi.mock('../../../utils/bip21Parser', () => ({
  parseBip21Uri: vi.fn(),
}));

vi.mock('../../../utils/validateAddress', () => ({
  validateAddress: vi.fn(),
  addressMatchesNetwork: vi.fn(),
}));

vi.mock('../../../src/api/transactions', () => ({
  analyzeSpendPrivacy: vi.fn(),
  getWalletPrivacy: vi.fn(),
}));

vi.mock('../../../components/send/OutputRow', () => ({
  OutputRow: (props: any) => {
    capture.outputRows[props.index] = props;
    return <div data-testid={`output-row-${props.index}`} />;
  },
}));

vi.mock('../../../components/send/steps/OutputsStep/CoinControlPanel', () => ({
  CoinControlPanel: (props: any) => {
    capture.coinProps = props;
    return <div data-testid="coin-control-panel" />;
  },
}));

vi.mock('../../../components/send/steps/OutputsStep/FeePanel', () => ({
  FeePanel: (props: any) => {
    capture.feeProps = props;
    return <div data-testid="fee-panel" />;
  },
}));

vi.mock('../../../components/send/steps/OutputsStep/AdvancedOptionsPanel', () => ({
  AdvancedOptionsPanel: (props: any) => {
    capture.advancedProps = props;
    return <div data-testid="advanced-panel" />;
  },
}));

vi.mock('../../../components/send/WizardNavigation', () => ({
  WizardNavigation: () => <div data-testid="wizard-nav" />,
}));

const mockDispatch = vi.fn();
const mockUpdateOutputAddress = vi.fn();
const mockUpdateOutputAmount = vi.fn();
const mockToggleCoinControl = vi.fn();

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    state: {
      transactionType: 'standard',
      outputs: [{ address: '', amount: '', sendMax: false }],
      outputsValid: [null],
      selectedUTXOs: new Set<string>(),
      showCoinControl: false,
      feeRate: 25,
      rbfEnabled: true,
      subtractFees: false,
      useDecoys: false,
      decoyCount: 2,
      scanningOutputIndex: null,
      payjoinUrl: null,
      payjoinStatus: 'idle',
    },
    dispatch: mockDispatch,
    wallet: { id: 'wallet-1', name: 'Main', network: 'mainnet' },
    utxos: [{ txid: 'a', vout: 0, amount: 10000, address: 'bc1qa', frozen: false, spent: false }],
    spendableUtxos: [{ txid: 'a', vout: 0, amount: 10000, address: 'bc1qa', frozen: false, spent: false }],
    addOutput: vi.fn(),
    removeOutput: vi.fn(),
    updateOutputAddress: mockUpdateOutputAddress,
    updateOutputAmount: mockUpdateOutputAmount,
    toggleSendMax: vi.fn(),
    walletAddresses: [{ address: 'bc1qrecv1', isChange: false, used: false }],
    selectedTotal: 10000,
    estimatedFee: 500,
    totalOutputAmount: 2000,
    toggleUtxo: vi.fn(),
    selectAllUtxos: vi.fn(),
    clearUtxoSelection: vi.fn(),
    toggleCoinControl: mockToggleCoinControl,
    fees: { fastestFee: 30, halfHourFee: 20, hourFee: 10, economyFee: 5, minimumFee: 1 },
    mempoolBlocks: [],
    queuedBlocksSummary: null,
    setFeeRate: vi.fn(),
    ...overrides,
  };
}

describe('OutputsStep branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capture.outputRows = [];
    capture.coinProps = null;
    capture.feeProps = null;
    capture.advancedProps = null;

    vi.mocked(CurrencyContext.useCurrency).mockReturnValue({
      unit: 'sats',
      format: (sats: number) => `${sats} sats`,
      formatFiat: (sats: number) => `$${sats / 1000}`,
    } as never);
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(makeContext() as never);
    vi.mocked(bip21.parseBip21Uri).mockReturnValue(null);
    vi.mocked(validate.validateAddress).mockReturnValue(true as never);
    vi.mocked(validate.addressMatchesNetwork).mockReturnValue(true);
    vi.mocked(txApi.getWalletPrivacy).mockResolvedValue({ utxos: [] } as never);
    vi.mocked(txApi.analyzeSpendPrivacy).mockResolvedValue({ score: 75 } as never);
  });

  it('auto-selects consolidation destination from first unused receive address and fallback', async () => {
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(
      makeContext({
        state: {
          ...makeContext().state,
          transactionType: 'consolidation',
          outputs: [{ address: '', amount: '', sendMax: false }],
        },
        walletAddresses: [
          { address: 'bc1qchange', isChange: true, used: false },
          { address: 'bc1qused', isChange: false, used: true },
          { address: 'bc1qunused', isChange: false, used: false },
        ],
      }) as never,
    );

    const firstView = render(<OutputsStep />);
    await waitFor(() => expect(mockUpdateOutputAddress).toHaveBeenCalledWith(0, 'bc1qunused'));
    firstView.unmount();

    mockUpdateOutputAddress.mockClear();
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(
      makeContext({
        state: {
          ...makeContext().state,
          transactionType: 'consolidation',
          outputs: [{ address: '', amount: '', sendMax: false }],
        },
        walletAddresses: [
          { address: 'bc1qused-a', isChange: false, used: true },
          { address: 'bc1qused-b', isChange: false, used: true },
        ],
      }) as never,
    );
    const secondView = render(<OutputsStep />);
    await waitFor(() => expect(mockUpdateOutputAddress).toHaveBeenCalledWith(0, 'bc1qused-a'));
    secondView.unmount();

    mockUpdateOutputAddress.mockClear();
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(
      makeContext({
        state: {
          ...makeContext().state,
          transactionType: 'consolidation',
          outputs: [{ address: '', amount: '', sendMax: false }],
        },
        walletAddresses: [
          { address: 'bc1qchange-a', isChange: true, used: false },
          { address: 'bc1qchange-b', isChange: true, used: true },
        ],
      }) as never,
    );
    render(<OutputsStep />);
    await waitFor(() => expect(txApi.getWalletPrivacy).toHaveBeenCalled());
    expect(mockUpdateOutputAddress).not.toHaveBeenCalled();
  });

  it('handles BIP21 parsing paths, payjoin network checks, and plain address fallback', async () => {
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(
      makeContext({
        state: {
          ...makeContext().state,
          outputs: [{ address: '', amount: '', sendMax: false }],
          payjoinUrl: 'https://existing-payjoin',
        },
      }) as never,
    );

    const view = render(<OutputsStep />);
    await waitFor(() => expect(capture.outputRows[0]?.onAddressChange).toEqual(expect.any(Function)));

    vi.mocked(bip21.parseBip21Uri).mockReturnValueOnce({
      address: 'bc1qpayjoin',
      amount: 0.001,
      payjoinUrl: 'https://payjoin.example',
    } as never);
    vi.mocked(validate.addressMatchesNetwork).mockReturnValueOnce(true);
    capture.outputRows[0].onAddressChange(0, 'bitcoin:bc1qpayjoin?amount=0.001&pj=https://payjoin.example');
    expect(mockUpdateOutputAddress).toHaveBeenCalledWith(0, 'bc1qpayjoin');
    expect(mockUpdateOutputAmount).toHaveBeenCalledWith(0, '0.001');
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_PAYJOIN_URL', url: 'https://payjoin.example' });

    vi.mocked(bip21.parseBip21Uri).mockReturnValueOnce({
      address: 'tb1qpayjoin',
      amount: 0.002,
      payjoinUrl: 'https://payjoin.bad',
    } as never);
    vi.mocked(validate.addressMatchesNetwork).mockReturnValueOnce(false);
    capture.outputRows[0].onAddressChange(0, 'bitcoin:tb1qpayjoin?amount=0.002&pj=https://payjoin.bad');
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_PAYJOIN_URL', url: null });
    expect(loggerSpies.warn).toHaveBeenCalledWith(
      'Payjoin disabled: Address network mismatch',
      expect.objectContaining({ walletNetwork: 'mainnet' }),
    );

    vi.mocked(bip21.parseBip21Uri).mockReturnValueOnce(null);
    capture.outputRows[0].onAddressChange(0, 'bitcoin:not-parseable');
    expect(mockUpdateOutputAddress).toHaveBeenCalledWith(0, 'bitcoin:not-parseable');

    mockDispatch.mockClear();
    mockUpdateOutputAmount.mockClear();
    vi.mocked(bip21.parseBip21Uri).mockReturnValueOnce({
      address: 'bc1qaddressonly',
    } as never);
    capture.outputRows[0].onAddressChange(0, 'bitcoin:bc1qaddressonly');
    expect(mockUpdateOutputAddress).toHaveBeenCalledWith(0, 'bc1qaddressonly');
    expect(mockUpdateOutputAmount).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_PAYJOIN_URL' }));

    vi.mocked(bip21.parseBip21Uri).mockImplementationOnce(() => {
      throw new Error('parse failed');
    });
    capture.outputRows[0].onAddressChange(0, 'bitcoin:throws');
    expect(mockUpdateOutputAddress).toHaveBeenCalledWith(0, 'bitcoin:throws');

    capture.outputRows[0].onAddressChange(0, 'bc1qplain');
    expect(mockUpdateOutputAddress).toHaveBeenCalledWith(0, 'bc1qplain');
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_PAYJOIN_URL', url: null });

    view.unmount();
    capture.outputRows = [];
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(
      makeContext({
        wallet: { id: 'wallet-1', name: 'Main' } as any,
      }) as never,
    );
    render(<OutputsStep />);
    await waitFor(() => expect(capture.outputRows[0]?.onAmountChange).toEqual(expect.any(Function)));
    vi.mocked(bip21.parseBip21Uri).mockReturnValueOnce({
      address: 'bc1qfallback',
      payjoinUrl: 'https://payjoin.fallback',
    } as never);
    vi.mocked(validate.addressMatchesNetwork).mockReturnValueOnce(true);
    capture.outputRows[0].onAddressChange(0, 'bitcoin:bc1qfallback?pj=https://payjoin.fallback');
    expect(validate.addressMatchesNetwork).toHaveBeenCalledWith('bc1qfallback', 'mainnet');
  });

  it('handles scan toggles, BTC amount conversion, blur cleanup, and display formatting branches', async () => {
    vi.mocked(CurrencyContext.useCurrency).mockReturnValue({
      unit: 'btc',
      format: (sats: number) => `${sats} sats`,
      formatFiat: (sats: number) => `$${sats / 1000}`,
    } as never);

    vi.mocked(SendContext.useSendTransaction).mockReturnValue(
      makeContext({
        state: {
          ...makeContext().state,
          outputs: [{ address: 'bc1qdest', amount: 'not-a-number', sendMax: true, displayValue: '0.1234' }],
        },
      }) as never,
    );

    const firstView = render(<OutputsStep />);
    await waitFor(() => expect(capture.outputRows[0]?.onAmountChange).toEqual(expect.any(Function)));

    const row = capture.outputRows[0];
    expect(row.unitLabel).toBe('BTC');
    expect(row.displayValue).toBe('0.1234');
    expect(row.fiatAmount).toBeGreaterThan(0);
    expect(row.formatAmount(123456789)).toBe('1.23456789');

    row.onScanQR(0);
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SCANNING_OUTPUT_INDEX', index: 0 });

    row.onAmountChange(0, '0.00000002', '');
    expect(mockUpdateOutputAmount).toHaveBeenCalledWith(0, '2', '0.00000002');

    row.onAmountChange(0, 'abc', '123');
    expect(mockUpdateOutputAmount).toHaveBeenCalledWith(0, '123', 'abc');

    row.onAmountChange(0, '', '77');
    expect(mockUpdateOutputAmount).toHaveBeenCalledWith(0, '77', '');

    row.onAmountBlur(0);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_OUTPUT',
      index: 0,
      field: 'displayValue',
      value: undefined,
    });

    firstView.unmount();
    mockDispatch.mockClear();
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(
      makeContext({
        state: {
          ...makeContext().state,
          scanningOutputIndex: 0,
          outputs: [{ address: 'bc1qdest', amount: 'not-a-number', sendMax: false }],
        },
      }) as never,
    );
    render(<OutputsStep />);
    await waitFor(() => expect(capture.outputRows[0]?.onScanQR).toEqual(expect.any(Function)));
    expect(capture.outputRows[0].displayValue).toBe('not-a-number');
    capture.outputRows[0].onScanQR(0);
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SCANNING_OUTPUT_INDEX', index: null });
    mockDispatch.mockClear();
    capture.outputRows[0].onAmountBlur(0);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('builds privacy map keys and toggles coin-control expansion with side effects', async () => {
    vi.mocked(txApi.getWalletPrivacy).mockResolvedValue({
      utxos: [{ txid: 'privacy-tx', vout: 2, score: 70 }],
    } as never);

    const firstView = render(<OutputsStep />);
    await waitFor(() => expect(capture.coinProps?.onTogglePanel).toEqual(expect.any(Function)));
    await waitFor(() => {
      expect(capture.coinProps.utxoPrivacyMap.has('privacy-tx:2')).toBe(true);
    });

    act(() => {
      capture.coinProps.onTogglePanel();
    });
    expect(mockToggleCoinControl).toHaveBeenCalledTimes(1);
    firstView.unmount();

    mockToggleCoinControl.mockClear();
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(
      makeContext({
        state: {
          ...makeContext().state,
          showCoinControl: true,
        },
      }) as never,
    );
    render(<OutputsStep />);
    await waitFor(() => expect(capture.coinProps?.onTogglePanel).toEqual(expect.any(Function)));
    act(() => {
      capture.coinProps.onTogglePanel();
    });
    expect(mockToggleCoinControl).not.toHaveBeenCalled();
  });

  it('dispatches advanced option updates', async () => {
    render(<OutputsStep />);
    await waitFor(() => expect(capture.advancedProps?.onRbfChange).toEqual(expect.any(Function)));

    capture.advancedProps.onRbfChange(false);
    capture.advancedProps.onSubtractFeesChange(true);
    capture.advancedProps.onDecoysChange(true);
    capture.advancedProps.onDecoyCountChange(6);

    expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_RBF_ENABLED', enabled: false });
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SUBTRACT_FEES', enabled: true });
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_USE_DECOYS', enabled: true });
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_DECOY_COUNT', count: 6 });
  });

  it('shows the locked/frozen/no-confirmed spendable warning variants', async () => {
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(
      makeContext({
        spendableUtxos: [],
        utxos: [{ txid: 'locked', vout: 0, amount: 1, address: 'bc1q', frozen: false, spent: false, lockedByDraftId: 'd1' }],
      }) as never,
    );
    const lockedView = render(<OutputsStep />);
    expect(await screen.findByText('No spendable funds available')).toBeInTheDocument();
    expect(screen.getByText(/locked by pending transactions or drafts/i)).toBeInTheDocument();
    lockedView.unmount();

    vi.mocked(SendContext.useSendTransaction).mockReturnValue(
      makeContext({
        spendableUtxos: [],
        utxos: [{ txid: 'frozen', vout: 0, amount: 1, address: 'bc1q', frozen: true, spent: false }],
      }) as never,
    );
    const frozenView = render(<OutputsStep />);
    expect(await screen.findByText(/All UTXOs are frozen/i)).toBeInTheDocument();
    frozenView.unmount();

    vi.mocked(SendContext.useSendTransaction).mockReturnValue(
      makeContext({
        spendableUtxos: [],
        utxos: [],
      }) as never,
    );
    render(<OutputsStep />);
    expect(await screen.findByText(/no confirmed UTXOs to spend/i)).toBeInTheDocument();
  });
});
