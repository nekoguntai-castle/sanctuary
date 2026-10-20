import { fireEvent, render, screen } from '@testing-library/react';
import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it, vi } from 'vitest';
import {
  PayjoinProposalPanel,
  PayjoinRoundOneNotice,
  PAYJOIN_SIGN_TWICE_NOTICE,
} from '../../../src/components/send/steps/review/PayjoinProposalPanel';

const format = (sats: number) => `${sats} sats`;

const PAYMENT = new Uint8Array([0x00, 0x14, ...new Array(20).fill(0x11)]);
const CHANGE = new Uint8Array([0x00, 0x14, ...new Array(20).fill(0x22)]);

/** An unsigned PSBT with these outputs; only the outputs matter to the panel. */
const psbtWithOutputs = (outputs: Array<[Uint8Array, number]>): string => {
  const psbt = new bitcoin.Psbt();
  psbt.addInput({ hash: 'a'.repeat(64), index: 0 });
  outputs.forEach(([script, value]) => psbt.addOutput({ script, value: BigInt(value) }));
  return psbt.toBase64();
};

const original = {
  psbtBase64: psbtWithOutputs([[PAYMENT, 10000], [CHANGE, 4000]]),
  intentId: 'intent-1',
  intentDigest: 'a'.repeat(64),
  fee: 123,
  totalInput: 10123,
  totalOutput: 10000,
  changeAmount: 0,
  effectiveAmount: 10000,
  utxos: [{ txid: 'a'.repeat(64), vout: 0 }],
};

const proposal = {
  ...original,
  psbtBase64: psbtWithOutputs([[PAYMENT, 10000], [CHANGE, 4000]]),
  intentId: 'intent-2',
  fee: 223,
  effectiveAmount: 9900,
  utxos: [{ txid: 'a'.repeat(64), vout: 0 }, { txid: 'b'.repeat(64), vout: 2, amount: 5000 }, { txid: 'c'.repeat(64), vout: 1 }],
};

const renderPanel = (overrides: Partial<Parameters<typeof PayjoinProposalPanel>[0]> = {}) => {
  const props = {
    status: 'awaiting-signature' as const,
    originalTxData: original,
    proposalTxData: proposal,
    busy: false,
    format,
    onSignPayjoin: vi.fn(),
    onSendWithoutPayjoin: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  render(<PayjoinProposalPanel {...props} />);
  return props;
};

describe('PayjoinProposalPanel', () => {
  it('summarizes the receiver inputs, unchanged outputs, fees and the net spend', () => {
    renderPanel();

    expect(screen.getByRole('region', { name: 'Payjoin proposal' })).toBeInTheDocument();
    expect(screen.getByText('2 (5000 sats)')).toBeInTheDocument();
    expect(screen.getByText('Unchanged')).toBeInTheDocument();
    expect(screen.getByText('223 sats (receiver paid 100 sats)')).toBeInTheDocument();
    expect(screen.getByText('9900 sats')).toBeInTheDocument();
    expect(screen.getByText(/may broadcast it if you do not finish/)).toBeInTheDocument();
  });

  it('reports the total increase of the signed outputs, matched by script in order', () => {
    // The receiver added its contribution to the payment and appended its own output.
    const grown = psbtWithOutputs([[PAYMENT, 14900], [CHANGE, 4000], [CHANGE, 700]]);
    renderPanel({ proposalTxData: { ...proposal, psbtBase64: grown } });

    expect(screen.getByText('Increased by 4900 sats')).toBeInTheDocument();
  });

  it.each([
    ['a signed output shrank', psbtWithOutputs([[PAYMENT, 10000], [CHANGE, 3999]])],
    ['a signed output is missing', psbtWithOutputs([[PAYMENT, 10000]])],
    ['the signed outputs were reordered', psbtWithOutputs([[CHANGE, 4000], [PAYMENT, 10000]])],
    ['the proposal PSBT cannot be decoded', 'not-a-psbt'],
  ])('says the outputs could not be compared when %s', (_label, psbtBase64) => {
    renderPanel({ proposalTxData: { ...proposal, psbtBase64 } });

    expect(screen.getByText('Could not be compared')).toBeInTheDocument();
    expect(screen.queryByText('Unchanged')).not.toBeInTheDocument();
  });

  it('offers signing the proposal and sending without payjoin', () => {
    const props = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /sign payjoin/i }));
    fireEvent.click(screen.getByRole('button', { name: /send without payjoin/i }));

    expect(props.onSignPayjoin).toHaveBeenCalledTimes(1);
    expect(props.onSendWithoutPayjoin).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['while broadcasting', { status: 'broadcasting' as const }],
    ['while busy', { busy: true }],
  ])('locks both buttons %s', (_label, overrides) => {
    renderPanel(overrides);

    expect(screen.getByRole('button', { name: /sign payjoin/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /send without payjoin/i })).toBeDisabled();
  });

  it('reports a zero net spend when the proposal carries no amount', () => {
    renderPanel({ proposalTxData: { ...proposal, effectiveAmount: undefined } });

    expect(screen.getByText('0 sats')).toBeInTheDocument();
  });

  it('shows the contacting state with an enabled exit while negotiating', () => {
    const props = renderPanel({ status: 'negotiating', originalTxData: null, proposalTxData: null, busy: true });

    expect(screen.getByRole('status')).toHaveTextContent('Contacting receiver for payjoin…');
    fireEvent.click(screen.getByRole('button', { name: /send without payjoin/i }));
    expect(props.onSendWithoutPayjoin).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['idle', { status: 'idle' as const }],
    ['failed', { status: 'failed' as const }],
    ['round two without the original', { originalTxData: null }],
    ['round two without the proposal', { proposalTxData: null }],
  ])('renders nothing when %s', (_label, overrides) => {
    const { container } = render(
      <PayjoinProposalPanel
        status="awaiting-signature"
        originalTxData={original}
        proposalTxData={proposal}
        busy={false}
        format={format}
        {...overrides}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('PayjoinRoundOneNotice', () => {
  it('tells the user they will sign twice', () => {
    render(<PayjoinRoundOneNotice visible />);

    expect(screen.getByText(PAYJOIN_SIGN_TWICE_NOTICE)).toBeInTheDocument();
  });

  it('renders nothing when the send cannot payjoin', () => {
    const { container } = render(<PayjoinRoundOneNotice visible={false} />);

    expect(container).toBeEmptyDOMElement();
  });
});
