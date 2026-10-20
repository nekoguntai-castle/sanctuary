/**
 * ReviewStep payjoin surfaces: the C-D7 sign-twice notice, the round-two
 * proposal panel, USB buttons hidden for the proposal, and Save draft locked.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewStep } from '../../../src/components/send/steps/ReviewStep';
import * as CurrencyContext from '../../../src/contexts/CurrencyContext';
import * as SendContext from '../../../src/contexts/send';
import { PAYJOIN_SIGN_TWICE_NOTICE } from '../../../src/components/send/steps/review/PayjoinProposalPanel';
import { testPsbtSigningContext } from '../../fixtures/psbtSigningContext';

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../../src/components/send/steps/review/deviceCapabilities', () => ({
  getDeviceCapabilities: () => ({ methods: ['usb', 'airgap'], labels: {}, blockedReason: '' }),
}));

vi.mock('../../../src/contexts/send', () => ({
  useSendTransaction: vi.fn(),
}));

vi.mock('../../../src/contexts/CurrencyContext', () => ({
  useCurrency: vi.fn(),
  usePriceFreeFormatter: vi.fn(),
}));

vi.mock('../../../src/components/TransactionFlowPreview', () => ({
  TransactionFlowPreview: () => <div data-testid="tx-flow-preview" />,
}));

vi.mock('../../../src/components/FiatDisplay', () => ({
  FiatDisplay: () => <span />,
}));

vi.mock('../../../src/api/bitcoin', () => ({
  lookupAddresses: vi.fn().mockImplementation(() => new Promise(() => {})),
}));

const txData = {
  psbtBase64: 'psbt',
  intentId: 'intent-1',
  intentDigest: 'a'.repeat(64),
  fee: 123,
  totalInput: 10123,
  totalOutput: 10000,
  changeAmount: 0,
  effectiveAmount: 10000,
  utxos: [{ txid: 'a'.repeat(64), vout: 0 }],
  signingContext: testPsbtSigningContext,
};

const context = (state: Record<string, unknown> = {}) => ({
  state: {
    transactionType: 'standard' as const,
    outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
    selectedUTXOs: new Set<string>(),
    showCoinControl: false,
    feeRate: 2,
    rbfEnabled: true,
    useDecoys: false,
    decoyCount: 0,
    payjoinUrl: 'https://merchant.example/payjoin',
    isDraftMode: false,
    draftId: null,
    ...state,
  },
  wallet: { id: 'wallet-1', name: 'Test Wallet', type: 'single_sig', quorum: 1 },
  devices: [{ id: 'device-1', type: 'ledger', label: 'My Ledger', fingerprint: 'ABC123' }],
  utxos: [],
  spendableUtxos: [],
  walletAddresses: [],
  selectedTotal: 10123,
  estimatedFee: 123,
  totalOutputAmount: 10000,
  goToStep: vi.fn(),
  prevStep: vi.fn(),
  isReadyToSign: true,
});

describe('ReviewStep payjoin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(context() as any);
    const currency = { format: (sats: number) => `${sats} sats` };
    vi.mocked(CurrencyContext.useCurrency).mockReturnValue(currency as any);
    vi.mocked(CurrencyContext.usePriceFreeFormatter).mockReturnValue(currency as any);
  });

  it('tells the user they will sign twice before round one of an eligible send', () => {
    render(<ReviewStep txData={txData} unsignedPsbt="psbt" />);

    expect(screen.getByText(PAYJOIN_SIGN_TWICE_NOTICE)).toBeInTheDocument();
  });

  it.each([
    ['without a payjoin URL', { payjoinUrl: null }, 'idle'],
    ['for a bound draft', { draftId: 'draft-1' }, 'idle'],
    ['once the round has started', {}, 'negotiating'],
  ] as const)('shows no sign-twice notice %s', (_label, state, payjoinStatus) => {
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(context(state) as any);

    render(<ReviewStep txData={txData} unsignedPsbt="psbt" payjoinStatus={payjoinStatus} />);

    expect(screen.queryByText(PAYJOIN_SIGN_TWICE_NOTICE)).not.toBeInTheDocument();
  });

  it('shows the proposal panel, hides USB signing and locks Save draft in round two', async () => {
    const user = userEvent.setup();
    const onDownloadPsbt = vi.fn();
    const onSendWithoutPayjoin = vi.fn().mockResolvedValue(true);
    const onSaveDraft = vi.fn();
    const proposal = { ...txData, intentId: 'intent-2', fee: 223, effectiveAmount: 9900,
      utxos: [...txData.utxos, { txid: 'b'.repeat(64), vout: 2, amount: 5000 }] };

    render(
      <ReviewStep
        txData={proposal}
        unsignedPsbt="proposal"
        payjoinStatus="awaiting-signature"
        payjoinUsbBlocked
        payjoinOriginalTxData={txData}
        onDownloadPsbt={onDownloadPsbt}
        onSendWithoutPayjoin={onSendWithoutPayjoin}
        onSaveDraft={onSaveDraft}
      />,
    );

    expect(screen.getByLabelText('Payjoin proposal')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /USB \(My Ledger\)/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save as Draft/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /sign payjoin/i }));
    await user.click(screen.getByRole('button', { name: /send without payjoin/i }));
    expect(onDownloadPsbt).toHaveBeenCalledTimes(1);
    expect(onSendWithoutPayjoin).toHaveBeenCalledTimes(1);
  });

  it('keeps USB signing and Save draft available for an ordinary send', () => {
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(context({ payjoinUrl: null }) as any);

    render(<ReviewStep txData={txData} unsignedPsbt="psbt" onSaveDraft={vi.fn()} />);

    expect(screen.getByRole('button', { name: /USB \(My Ledger\)/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Save as Draft/ })).toBeEnabled();
    expect(screen.queryByLabelText('Payjoin proposal')).not.toBeInTheDocument();
  });
});
