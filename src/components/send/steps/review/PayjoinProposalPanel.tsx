import * as bitcoin from 'bitcoinjs-lib';
import { AlertTriangle, FileDown, Loader2, Shield } from 'lucide-react';
import { Button } from '../../../ui/Button';
import { createLogger } from '../../../../utils/logger';
import { toHex } from '../../../../utils/bufferUtils';
import type { TransactionData } from '../../../../hooks/send/types';
import type { PayjoinAttemptStatus } from '../../../../contexts/send/types';

type FormatSats = (sats: number) => string;

const log = createLogger('PayjoinProposalPanel');

export const PAYJOIN_SIGN_TWICE_NOTICE =
  'The receiver supports payjoin: you will sign twice. Your first signature authorizes this exact payment and is shared with the receiver as a fallback.';

/** Decision C-D7: shown on the review step before round one when the send can negotiate a payjoin. */
export function PayjoinRoundOneNotice({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800">
      <Shield className="w-5 h-5 text-primary-600 dark:text-primary-400 flex-shrink-0 mt-0.5" />
      <p className="text-sm text-sanctuary-700 dark:text-sanctuary-200">{PAYJOIN_SIGN_TWICE_NOTICE}</p>
    </div>
  );
}

/**
 * A payjoin proposal is the transaction under review: round two, with the
 * signed original still held. The review summary and this panel share it.
 */
export function isPayjoinProposalReview(
  status: string,
  originalTxData: TransactionData | null | undefined
): originalTxData is TransactionData {
  return (status === 'awaiting-signature' || status === 'broadcasting') && Boolean(originalTxData);
}

interface PayjoinProposalPanelProps {
  status: PayjoinAttemptStatus;
  originalTxData: TransactionData | null;
  proposalTxData: TransactionData | null;
  busy: boolean;
  format: FormatSats;
  onSignPayjoin?: () => void;
  onSendWithoutPayjoin?: () => Promise<boolean>;
}

interface ProposalSummary {
  receiverInputCount: number;
  receiverInputTotal: number;
  /** Total increase of the original's outputs; null when they could not be compared. */
  outputIncrease: number | null;
  fee: number;
  receiverFeeDelta: number;
  netSpend: number;
}

const outpointKey = (utxo: TransactionData['utxos'][number]): string => `${utxo.txid}:${utxo.vout}`;

const outputsOf = (psbtBase64: string) => bitcoin.Psbt.fromBase64(psbtBase64).txOutputs
  .map(output => ({ script: toHex(output.script), value: output.value }));

/**
 * How much the original's outputs grew in the proposal. The BIP78 checklist
 * the server enforces lets them increase but never shrink or disappear, so
 * null (a removed or reduced output, or an undecodable PSBT) is unreachable
 * for a validated proposal. Outputs match by script in relative order, as the
 * server matches them.
 */
function originalOutputIncrease(original: TransactionData, proposal: TransactionData): number | null {
  let before: ReturnType<typeof outputsOf>;
  let after: ReturnType<typeof outputsOf>;
  try {
    before = outputsOf(original.psbtBase64);
    after = outputsOf(proposal.psbtBase64);
  } catch (error) {
    log.debug('Could not decode payjoin PSBTs for the output comparison', { error });
    return null;
  }
  let increase = 0n;
  let next = 0;
  for (const output of before) {
    const index = after.findIndex((candidate, i) => i >= next && candidate.script === output.script);
    if (index < 0 || after[index].value < output.value) return null;
    increase += after[index].value - output.value;
    next = index + 1;
  }
  return Number(increase);
}

function summarizeProposal(original: TransactionData, proposal: TransactionData): ProposalSummary {
  const originalOutpoints = new Set(original.utxos.map(outpointKey));
  const receiverInputs = proposal.utxos.filter(utxo => !originalOutpoints.has(outpointKey(utxo)));
  return {
    receiverInputCount: receiverInputs.length,
    receiverInputTotal: receiverInputs.reduce((sum, utxo) => sum + (utxo.amount ?? 0), 0),
    outputIncrease: originalOutputIncrease(original, proposal),
    fee: proposal.fee,
    // Receiver-funded by construction: the sender's inputs are fixed and none
    // of the original's outputs may shrink, so every extra sat of fee comes
    // from the receiver's contribution.
    receiverFeeDelta: proposal.fee - original.fee,
    netSpend: proposal.effectiveAmount ?? 0,
  };
}

function describeOutputIncrease(increase: number | null, format: FormatSats): string {
  if (increase === null) return 'Could not be compared';
  return increase === 0 ? 'Unchanged' : `Increased by ${format(increase)}`;
}

function NegotiatingPanel({ onSendWithoutPayjoin }: Pick<PayjoinProposalPanelProps, 'onSendWithoutPayjoin'>) {
  return (
    <div className="surface-secondary rounded-lg p-4 space-y-3" role="status">
      <div className="flex items-center gap-2 text-sm text-sanctuary-800 dark:text-sanctuary-100">
        <Loader2 className="w-4 h-4 animate-spin" />
        Contacting receiver for payjoin…
      </div>
      <Button variant="secondary" size="sm" onClick={onSendWithoutPayjoin}>
        Send without payjoin
      </Button>
    </div>
  );
}

/**
 * Round two of a payjoin (decision C-D2): what the receiver changed, a way to
 * sign the proposal off-device, and the exit that broadcasts the original.
 * Leaving the page broadcasts nothing.
 */
export function PayjoinProposalPanel({
  status,
  originalTxData,
  proposalTxData,
  busy,
  format,
  onSignPayjoin,
  onSendWithoutPayjoin,
}: PayjoinProposalPanelProps) {
  if (status === 'negotiating') return <NegotiatingPanel onSendWithoutPayjoin={onSendWithoutPayjoin} />;
  if (!isPayjoinProposalReview(status, originalTxData) || !proposalTxData) return null;

  const summary = summarizeProposal(originalTxData, proposalTxData);
  const locked = busy || status === 'broadcasting';
  return (
    <div className="surface-secondary rounded-lg p-4 space-y-3" role="region" aria-label="Payjoin proposal">
      <h3 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Payjoin proposal</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-sanctuary-600 dark:text-sanctuary-300">
        <dt>Receiver inputs added</dt>
        <dd>{summary.receiverInputCount} ({format(summary.receiverInputTotal)})</dd>
        <dt>Outputs you signed</dt>
        <dd>{describeOutputIncrease(summary.outputIncrease, format)}</dd>
        <dt>Total fee</dt>
        <dd>{format(summary.fee)} (receiver paid {format(summary.receiverFeeDelta)})</dd>
        <dt>Net spend</dt>
        <dd>{format(summary.netSpend)}</dd>
      </dl>
      <div className="flex items-start gap-2 text-xs text-warning-800 dark:text-warning-200">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        <span>
          Sign this proposal with your hardware wallet by PSBT file or QR code, then broadcast it.
          The receiver already holds your signed original and may broadcast it if you do not finish;
          leaving this page broadcasts nothing.
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={onSignPayjoin} disabled={locked}>
          <FileDown className="w-4 h-4 mr-2" />
          Sign payjoin
        </Button>
        <Button variant="secondary" size="sm" onClick={onSendWithoutPayjoin} disabled={locked}>
          Send without payjoin
        </Button>
      </div>
    </div>
  );
}
