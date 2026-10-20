/**
 * Payjoin peer-input trust policy (C-D4).
 *
 * Sanctuary does not verify a receiver's input witness cryptographically: the
 * node does that at broadcast. Before a proposal intent is persisted, each
 * receiver (peer) input must be a finalized P2WPKH or P2TR spend with an empty
 * or absent finalScriptSig, and its real witness must not be heavier than the
 * per-type maximum that the proposal's fee-policy estimate assumed; otherwise
 * the proposal would underpay its authorized fee rate only after round two.
 */
import * as bitcoin from 'bitcoinjs-lib';
import { getErrorMessage } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import { inputPrevout, payjoinScriptType, type PayjoinScriptType } from '../bitcoin/payjoinProposalValidation';
import { estimateTransactionWeight, type SpendPolicy } from '../bitcoin/transactionWeight';

const log = createLogger('PAYJOIN:SVC_PEER_INPUT');

type PeerPrevout = NonNullable<ReturnType<typeof inputPrevout>>;

/** Why a receiver's peer input is refused; the caller's payjoin fallback reports it. */
export type PeerInputRefusal =
  | 'peer_input_is_wallet_utxo'
  | 'peer_input_script_unsupported'
  | 'peer_input_final_script_sig'
  | 'peer_input_not_finalized'
  | 'peer_input_witness_malformed'
  | 'peer_input_witness_too_heavy';

const PEER_SPEND_POLICIES: Record<PayjoinScriptType, SpendPolicy | undefined> = {
  p2wpkh: { type: 'p2wpkh' },
  p2tr: { type: 'p2tr-keypath' },
  unsupported: undefined,
};

/**
 * Weight of a one-input/one-output skeleton spending the peer prevout with its
 * stored witness, decoded exactly as broadcast extraction decodes it.
 */
const skeletonWeight = (
  proposal: bitcoin.Psbt,
  index: number,
  prevout: PeerPrevout,
  outputScript: Uint8Array,
): number | undefined => {
  const txInput = proposal.txInputs[index];
  const skeleton = new bitcoin.Psbt();
  skeleton.addInput({
    hash: txInput.hash,
    index: txInput.index,
    sequence: txInput.sequence,
    witnessUtxo: { script: prevout.script, value: prevout.value },
  });
  // Weight does not depend on the amount; zero keeps the skeleton extractable.
  skeleton.addOutput({ script: outputScript, value: 0n });
  skeleton.updateInput(0, { finalScriptWitness: proposal.data.inputs[index].finalScriptWitness! });
  try {
    return skeleton.extractTransaction(true).weight();
  } catch (error) {
    log.debug('Payjoin peer witness could not be decoded', { index, error: getErrorMessage(error) });
    return undefined;
  }
};

const peerInputRejection = (proposal: bitcoin.Psbt, index: number): PeerInputRefusal | null => {
  const input = proposal.data.inputs[index];
  const prevout = inputPrevout(proposal, index);
  const spendPolicy = prevout && PEER_SPEND_POLICIES[payjoinScriptType(prevout.script)];
  if (!prevout || !spendPolicy) return 'peer_input_script_unsupported';
  if (input.finalScriptSig?.length) return 'peer_input_final_script_sig';
  // Never treat a missing witness as empty: an unfinalized peer could never broadcast.
  if (!input.finalScriptWitness) return 'peer_input_not_finalized';
  const outputScript = proposal.txOutputs[0].script;
  const actual = skeletonWeight(proposal, index, prevout, outputScript);
  if (actual === undefined) return 'peer_input_witness_malformed';
  const estimate = estimateTransactionWeight({
    inputs: [{ spendPolicy, prevoutScript: prevout.script }],
    outputs: [{ scriptPubKey: outputScript }],
  }).weight;
  return actual > estimate ? 'peer_input_witness_too_heavy' : null;
};

/**
 * Returns the reason the first listed peer input is refused, or null when
 * every peer input is within the policy. A refusal is a payjoin fallback, not
 * an error: the caller answers `success: false` and the original stays usable.
 */
export const assertPeerInputsWithinEstimate = (
  proposal: bitcoin.Psbt,
  peerIndexes: readonly number[],
): PeerInputRefusal | null => {
  for (const index of peerIndexes) {
    const rejection = peerInputRejection(proposal, index);
    if (rejection) return rejection;
  }
  return null;
};
