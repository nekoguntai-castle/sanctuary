/**
 * A fake BIP78 receiver for the two-round payjoin proof.
 *
 * Like a real receiver it refuses an original that is not finalized and
 * broadcastable (`original-psbt-rejected`). Otherwise it answers a proposal:
 * every sender input kept with its sequence but stripped of UTXO data and final
 * fields, one receiver input signed over its BIP143 sighash and finalized, and
 * the receiver's output raised by the contributed amount less the extra fee
 * its input needs to keep the sender's BIP78 `minfeerate` (the fee
 * contribution r the sender's net spend P - r reflects).
 */
import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '../../../../src/services/bitcoin/bip32';
import { witnessStackToScriptWitness } from '../../../../src/services/bitcoin/psbtBuilder';

export const NETWORK = bitcoin.networks.testnet;

/** p2wpkh (the happy path); p2sh-p2wpkh and an oversized witness must both fall back. */
export type ReceiverInputVariant = 'p2wpkh' | 'p2sh-p2wpkh' | 'oversized-witness';

const receiverKey = bip32.fromSeed(Buffer.alloc(32, 0x52), NETWORK).derivePath("m/84'/1'/0'/0/0");
const receiverPubkey = Buffer.from(receiverKey.publicKey);

/** Where the sender pays: the receiver's own P2WPKH output. */
export const RECEIVER_PAY_TO_SCRIPT = bitcoin.payments.p2wpkh({ pubkey: receiverPubkey, network: NETWORK }).output!;
export const RECEIVER_PAY_TO_ADDRESS = bitcoin.address.fromOutputScript(RECEIVER_PAY_TO_SCRIPT, NETWORK);

/** The node's view of the receiver's funding transaction; its output 1 is the receiver's input. */
export const RECEIVER_FUNDING_TX = new bitcoin.Transaction();
RECEIVER_FUNDING_TX.addInput(Buffer.alloc(32, 0x52), 0);
RECEIVER_FUNDING_TX.addOutput(Buffer.from(`0014${'52'.repeat(20)}`, 'hex'), 1_000n);
RECEIVER_FUNDING_TX.addOutput(RECEIVER_PAY_TO_SCRIPT, 40_000n);
export const RECEIVER_INPUT = { txid: RECEIVER_FUNDING_TX.getId(), vout: 1, amount: 40_000 };

const ORIGINAL_PSBT_REJECTED = 'original-psbt-rejected';

const isBroadcastableOriginal = (original: bitcoin.Psbt): boolean => {
  if (!original.data.inputs.every(input => input.finalScriptWitness || input.finalScriptSig)) return false;
  try {
    original.extractTransaction();
    return true;
  } catch {
    return false;
  }
};

const receiverPrevoutFields = (variant: ReceiverInputVariant) => {
  if (variant !== 'p2sh-p2wpkh') {
    return { witnessUtxo: { script: RECEIVER_PAY_TO_SCRIPT, value: BigInt(RECEIVER_INPUT.amount) } };
  }
  const nested = bitcoin.payments.p2sh({
    redeem: bitcoin.payments.p2wpkh({ pubkey: receiverPubkey, network: NETWORK }),
    network: NETWORK,
  });
  return {
    witnessUtxo: { script: nested.output!, value: BigInt(RECEIVER_INPUT.amount) },
    redeemScript: nested.redeem!.output!,
  };
};

/** A P2WPKH witness heavier than the per-type maximum the proposal's fee estimate assumes. */
const OVERSIZED_WITNESS = witnessStackToScriptWitness([
  Buffer.alloc(72, 0x30),
  receiverPubkey,
  Buffer.alloc(200, 0x01),
]);

const sumValues = (values: bigint[]): bigint => values.reduce((sum, value) => sum + value, 0n);

/** The proposal raising the receiver's output by `increase`, its own input signed and finalized. */
const assembleProposal = (original: bitcoin.Psbt, variant: ReceiverInputVariant, increase: bigint): bitcoin.Psbt => {
  const proposal = new bitcoin.Psbt({ network: NETWORK });
  proposal.setVersion(original.version);
  proposal.setLocktime(original.locktime);
  original.txInputs.forEach((input, index) => proposal.addInput({
    hash: input.hash,
    index: input.index,
    sequence: input.sequence,
    witnessUtxo: original.data.inputs[index].witnessUtxo!,
  }));
  // BIP78: every proposal input uses the sender's sequence (RBF in Sanctuary originals).
  proposal.addInput({
    hash: Buffer.from(RECEIVER_INPUT.txid, 'hex').reverse(),
    index: RECEIVER_INPUT.vout,
    sequence: original.txInputs[0].sequence,
    ...receiverPrevoutFields(variant),
  });
  original.txOutputs.forEach(output => proposal.addOutput({
    script: output.script,
    value: Buffer.from(output.script).equals(RECEIVER_PAY_TO_SCRIPT) ? output.value + increase : output.value,
  }));
  const receiverIndex = proposal.inputCount - 1;
  proposal.signInput(receiverIndex, receiverKey);
  proposal.finalizeInput(receiverIndex);
  if (variant === 'oversized-witness') proposal.data.inputs[receiverIndex].finalScriptWitness = OVERSIZED_WITNESS;
  return proposal;
};

/** The extra fee r the receiver's input costs at `minFeeRate`, sized with the sender's original witnesses. */
const feeContribution = (original: bitcoin.Psbt, sized: bitcoin.Psbt, minFeeRate: number): bigint => {
  original.data.inputs.forEach((input, index) => {
    sized.data.inputs[index].finalScriptWitness = input.finalScriptWitness;
  });
  // +1 vB: the re-signed receiver signature may be a byte longer.
  const requiredFee = BigInt(Math.ceil(minFeeRate * (sized.extractTransaction(true).virtualSize() + 1)));
  const originalFee = sumValues(original.data.inputs.map(input => input.witnessUtxo!.value))
    - sumValues(original.txOutputs.map(output => output.value));
  return requiredFee > originalFee ? requiredFee - originalFee : 0n;
};

export const buildProposal = (
  originalBase64: string,
  variant: ReceiverInputVariant,
  minFeeRate = 0,
): { proposal: string; feeContribution: bigint } | null => {
  const original = bitcoin.Psbt.fromBase64(originalBase64, { network: NETWORK });
  if (!isBroadcastableOriginal(original)) return null;
  const contribution = BigInt(RECEIVER_INPUT.amount);
  const fee = feeContribution(original, assembleProposal(original, variant, contribution), minFeeRate);
  const proposal = assembleProposal(original, variant, contribution - fee);
  // BIP78: sender inputs come back without UTXO data or final fields.
  for (let index = 0; index < original.inputCount; index += 1) {
    delete proposal.data.inputs[index].witnessUtxo;
  }
  return { proposal: proposal.toBase64(), feeContribution: fee };
};

export interface FakeReceiverRequest {
  body: string;
  query: URLSearchParams;
}

export interface FakeReceiver {
  variant: ReceiverInputVariant;
  requests: FakeReceiverRequest[];
  /** When set, the receiver answers only after this resolves (an in-flight round one). */
  hold: Promise<void> | null;
  /** The finalized receiver witness of the last proposal it answered. */
  lastReceiverWitness: Buffer | null;
  /** The fee r its last proposal paid out of its contribution to keep the minfeerate. */
  lastFeeContribution: bigint;
}

export const createFakeReceiver = (): FakeReceiver => ({
  variant: 'p2wpkh',
  requests: [],
  hold: null,
  lastReceiverWitness: null,
  lastFeeContribution: 0n,
});

/** The receiver's HTTP behaviour, as `requestPinnedAddress` would observe it. */
export const answerReceiverRequest = async (
  receiver: FakeReceiver,
  url: URL,
  body: string,
): Promise<{ ok: boolean; status: number; body: Buffer }> => {
  receiver.requests.push({ body, query: url.searchParams });
  if (receiver.hold) await receiver.hold;
  const built = buildProposal(body, receiver.variant, Number(url.searchParams.get('minfeerate') ?? 0));
  if (!built) return { ok: false, status: 400, body: Buffer.from(ORIGINAL_PSBT_REJECTED) };
  const parsed = bitcoin.Psbt.fromBase64(built.proposal, { network: NETWORK });
  receiver.lastReceiverWitness = Buffer.from(parsed.data.inputs[parsed.inputCount - 1].finalScriptWitness!);
  receiver.lastFeeContribution = built.feeContribution;
  return { ok: true, status: 200, body: Buffer.from(built.proposal) };
};
