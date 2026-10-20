/**
 * Payjoin send, round one (BIP78 sender).
 *
 * The client hands over the signed (not finalized) original for an
 * authenticated intent. It is verified exactly as a broadcast would verify it,
 * refused before it leaves the server when payjoin is not allowed for the
 * wallet or the spend, and posted to the receiver as a finalized BIP78
 * original. A valid proposal is bound to the wallet account and persisted as a
 * replacement intent that supersedes the original; the sender then signs the
 * proposal's own inputs (round two).
 */
import * as bitcoin from 'bitcoinjs-lib';
import { ConflictError, ForbiddenError, InvalidInputError } from '../../errors/ApiError';
import { findAddressStrings } from '../../repositories/addressRepository';
import {
  SIGNING_INTENT_SUPERSESSION_CONFLICT,
  SIGNING_INTENT_SUPERSESSION_DRAFT_BOUND,
} from '../../repositories/transactionSigningIntentRepository';
import { findByOutpointsForWallet } from '../../repositories/utxoRepository';
import { attemptPayjoinSend } from '../payjoinService';
import { getNetwork } from '../bitcoin/utils';
import { normalizeLegacyBitcoinNetwork, type BitcoinNetwork } from '../bitcoin/networks';
import {
  findDraftBySigningIntent,
  persistSigningIntent,
  prepareSigningIntent,
} from '../bitcoin/signingIntent/service';
import { validateSignedArtifact, type ValidatedBroadcastArtifact } from '../bitcoin/signingIntent/artifactValidation';
import { derivePayjoinInputRoles } from '../bitcoin/signingIntent/canonical';
import { deriveIntentSpend } from '../bitcoin/signingIntent/intentSpend';
import type { SigningIntentEnvelope, SigningIntentInputRole } from '../bitcoin/signingIntent/types';
import { bindPsbtAccount } from '../bitcoin/psbtAccountBinding';
import {
  buildSigningIntentFeePolicy,
  calculatePsbtFee,
  estimatePsbtMaximumSignedVsize,
} from '../bitcoin/signingIntent/feePolicy';
import { feeForRate } from '../bitcoin/transactionWeight';
import { policyEvaluationEngine } from '../vaultPolicy';
import { buildIntentPolicyInput, requiresEnforcedApproval } from '../vaultPolicy/intentPolicyInput';
import { buildBip78OriginalPsbt } from './originalPsbt';
import { assertPeerInputsWithinEstimate, type PeerInputRefusal } from './peerInputPolicy';

export interface PayjoinAttemptRequest {
  signedPsbt: string;
  intentId: string;
  intentDigest: string;
  payjoinUrl: string;
  network?: string;
}

export interface AttemptPayjoinWithSignedOriginalInput {
  walletId: string;
  userId: string;
  walletNetwork: string;
  original: SigningIntentEnvelope;
  body: PayjoinAttemptRequest;
}

type PayjoinFallback = { success: false; isPayjoin: false; error?: string };

/** Every round-one failure answers this exact shape; the client falls back to the original. */
const fallback = (error?: string): PayjoinFallback => ({ success: false, isPayjoin: false, error });

const PAYJOIN_SCRIPT_TYPES: ReadonlySet<string> = new Set(['native_segwit', 'taproot']);

/** C-D3: only single-sig P2WPKH or P2TR senders can ever complete a proposal. */
const assertPayjoinSigningContext = (original: SigningIntentEnvelope): void => {
  if (original.signingContext?.walletType !== 'single_sig') {
    throw new InvalidInputError('Payjoin is only available for single-signature wallets', 'walletId', {
      reason: 'payjoin_multisig_unsupported',
    });
  }
  if (!PAYJOIN_SCRIPT_TYPES.has(original.signingContext.scriptType)) {
    throw new InvalidInputError('Payjoin requires a native segwit or taproot wallet', 'walletId', {
      reason: 'payjoin_script_type_unsupported',
    });
  }
};

/**
 * C-D8. A receiver may broadcast the original itself, outside any Sanctuary
 * policy reservation, so a blocked or approval-required spend, or any wallet
 * with an enforce-mode usage window, is refused before the original leaves.
 * The approval check is a preview evaluation; nothing is reserved or written.
 */
const assertPayjoinPolicyAllows = async (
  walletId: string,
  userId: string,
  original: SigningIntentEnvelope,
): Promise<void> => {
  const input = await buildIntentPolicyInput(walletId, userId, original);
  if (input) {
    const evaluation = await policyEvaluationEngine.evaluatePolicies({ ...input, preview: true });
    if (!evaluation.allowed) throw new ForbiddenError('Transaction blocked by vault policy');
    if (requiresEnforcedApproval(evaluation)) {
      throw new ForbiddenError('Vault policy requires approval; payjoin is not available for this spend', undefined, {
        reason: 'approval_required',
      });
    }
  }
  if (await policyEvaluationEngine.walletHasEnforcedUsageWindows(walletId)) {
    throw new ForbiddenError(
      'Payjoin is not available while a spending-limit or velocity policy is enforced on this wallet',
      undefined,
      { reason: 'payjoin_policy_usage_unsupported' },
    );
  }
};

const draftBoundIntent = (): ConflictError => new ConflictError(
  'Payjoin is not available for an intent bound to a draft',
  undefined,
  { reason: 'draft_bound_intent' },
);

/** Steps 2-6: everything that must hold before the signed original leaves the server. */
const verifySignedOriginal = async (
  input: AttemptPayjoinWithSignedOriginalInput,
  network: BitcoinNetwork,
): Promise<ValidatedBroadcastArtifact> => {
  const { walletId, userId, original, body } = input;
  // A proposal is never the original of another payjoin round.
  if (original.source === 'payjoin') {
    throw new ConflictError('A payjoin proposal cannot be the original of a payjoin', undefined, {
      reason: 'payjoin_replacement_not_original',
    });
  }
  if (await findDraftBySigningIntent(walletId, body.intentId)) throw draftBoundIntent();
  const artifact = await validateSignedArtifact({
    walletId,
    intentId: body.intentId,
    intentDigest: body.intentDigest,
    signedPsbtBase64: body.signedPsbt,
  });
  if (artifact.broadcastReplay) {
    throw new ConflictError('Payjoin original has already been broadcast', undefined, {
      reason: 'already_broadcast',
    });
  }
  assertPayjoinSigningContext(original);
  if (body.network && normalizeLegacyBitcoinNetwork(body.network, 'mainnet') !== network) {
    throw new InvalidInputError('Payjoin network does not match wallet', 'network');
  }
  await assertPayjoinPolicyAllows(walletId, userId, original);
  return artifact;
};

const peerIndexesOf = (roles: readonly SigningIntentInputRole[]): number[] => (
  roles.flatMap((role, index) => (role === 'payjoin_peer' ? [index] : []))
);

/** Steps 10-11 (C-D4): the reason a proposal's peer inputs are refused, or null. */
const peerInputRefusal = async (
  walletId: string,
  proposal: bitcoin.Psbt,
  peerIndexes: number[],
): Promise<PeerInputRefusal | null> => {
  const outpoints = peerIndexes.map(index => ({
    txid: Buffer.from(proposal.txInputs[index].hash).reverse().toString('hex'),
    vout: proposal.txInputs[index].index,
  }));
  if ((await findByOutpointsForWallet(walletId, outpoints)).length > 0) return 'peer_input_is_wallet_utxo';
  return assertPeerInputsWithinEstimate(proposal, peerIndexes);
};

/**
 * Step 12 (C-D6): bitcoinjs keeps an empty finalScriptSig through base64, so it
 * is dropped before the proposal is bound, hashed and persisted.
 */
const stripEmptyPeerScriptSigs = (proposal: bitcoin.Psbt, peerIndexes: number[]): void => {
  peerIndexes.forEach(index => {
    if (proposal.data.inputs[index].finalScriptSig?.length === 0) delete proposal.data.inputs[index].finalScriptSig;
  });
};

/** The round-two PSBT the client signs: the peer's final fields stay server-side (C-D6). */
const withoutPeerFinalFields = (boundProposalPsbt: string, peerIndexes: number[]): string => {
  const stripped = bitcoin.Psbt.fromBase64(boundProposalPsbt);
  peerIndexes.forEach(index => {
    delete stripped.data.inputs[index].finalScriptWitness;
    delete stripped.data.inputs[index].finalScriptSig;
  });
  return stripped.toBase64();
};

const requestedFeeRateOf = (original: SigningIntentEnvelope): number => {
  if (original.snapshot.version !== 2) {
    throw new InvalidInputError('Payjoin requires a current signing intent', 'intentId', { reason: 'stale_intent' });
  }
  return original.snapshot.feePolicy.requestedFeeRateSatsPerVbyte;
};

/**
 * The Payjoin sender validator has already enforced the BIP78 sender-output
 * and bounded-fee-increase invariants. Bind the proposal's exact total fee,
 * including any receiver-funded contribution, without weakening final
 * artifact equality checks.
 */
const proposalFeePolicy = (proposal: bitcoin.Psbt, boundProposalPsbt: string, originalRate: number) => {
  const proposalFee = calculatePsbtFee(proposal);
  const proposalMaximumVsize = estimatePsbtMaximumSignedVsize(proposal);
  // Pick an interior point in the proposal fee's integer ceiling bucket. For an
  // integer fee F and maximum vsize V, ceil(((F - 0.5) / V) * V) remains F,
  // while avoiding a binary floating-point result infinitesimally above F.
  const requestedFeeRate = Math.min(originalRate, (proposalFee - 0.5) / proposalMaximumVsize);
  const proposalFeeSurplus = Math.max(0, proposalFee - feeForRate(proposalMaximumVsize, requestedFeeRate));
  return buildSigningIntentFeePolicy(boundProposalPsbt, requestedFeeRate, undefined, proposalFeeSurplus);
};

const persistReplacement = async (prepared: Awaited<ReturnType<typeof prepareSigningIntent>>) => {
  try {
    return (await persistSigningIntent(prepared)).handle;
  } catch (error) {
    // The original was claimed or superseded meanwhile (e.g. the client gave up and broadcast it).
    if (error instanceof Error && error.message === SIGNING_INTENT_SUPERSESSION_CONFLICT) {
      throw new ConflictError('Payjoin original is no longer available', undefined, {
        reason: 'payjoin_broadcast_in_progress',
      });
    }
    // A draft was bound to the original during the receiver round trip (C-D9).
    if (error instanceof Error && error.message === SIGNING_INTENT_SUPERSESSION_DRAFT_BOUND) throw draftBoundIntent();
    throw error;
  }
};

/** Step 12: bind, prepare, derive the net spend and only then supersede the original. */
const mintReplacementIntent = async (
  input: AttemptPayjoinWithSignedOriginalInput,
  network: BitcoinNetwork,
  proposal: bitcoin.Psbt,
  inputRoles: SigningIntentInputRole[],
) => {
  const { walletId, original } = input;
  const peerIndexes = peerIndexesOf(inputRoles);
  stripEmptyPeerScriptSigs(proposal, peerIndexes);
  const signingContext = await bindPsbtAccount(walletId, proposal, { foreignInputIndexes: peerIndexes });
  const boundProposalPsbt = proposal.toBase64();
  const feePolicy = proposalFeePolicy(proposal, boundProposalPsbt, requestedFeeRateOf(original));
  // Everything fallible runs before the replacement intent supersedes the
  // original: after that write, a failure would strand the client on a
  // superseded intent.
  const walletAddresses = new Set(await findAddressStrings(walletId));
  const prepared = await prepareSigningIntent({
    walletId,
    createdByUserId: input.userId,
    network,
    source: 'payjoin',
    unsignedPsbtBase64: boundProposalPsbt,
    feePolicy,
    inputRoles,
    supersedesIntentId: original.intentId,
    signingContext,
  });
  // The client reports this amount back on broadcast, so it is the canonical
  // net spend of the replacement snapshot: P - r when the receiver raised the
  // fee out of its contribution, not P. The response proposal cannot be saved
  // as a draft (C-D9).
  const { amount } = await deriveIntentSpend(walletId, prepared.snapshot.network, prepared.snapshot, walletAddresses);
  if (amount <= 0) {
    throw new InvalidInputError('Payjoin proposal leaves no net spend for the sender', 'psbt');
  }
  const replacementIntent = await persistReplacement(prepared);
  return {
    success: true as const,
    isPayjoin: true as const,
    proposalPsbt: withoutPeerFinalFields(boundProposalPsbt, peerIndexes),
    ...replacementIntent,
    amount,
  };
};

/**
 * Round one of a BIP78 send for a signed original.
 *
 * Verifies the signed original as a broadcast would (steps 2-6), sends it to
 * the receiver as a finalized BIP78 original with the original's fee rate as
 * `minfeerate`, and mints a replacement intent from a valid proposal. Answers
 * the fallback shape `{ success: false, isPayjoin: false }` whenever the
 * receiver fails or its proposal is refused; the original then stays
 * broadcastable. Throws instead (nothing was sent, or the original is no
 * longer the caller's to fall back to) for a payjoin or draft-bound original,
 * an invalid or already-broadcast artifact, an unsupported wallet, a network
 * mismatch, a vault policy refusal, or a supersession that lost a race.
 */
export const attemptPayjoinWithSignedOriginal = async (input: AttemptPayjoinWithSignedOriginalInput) => {
  const network = normalizeLegacyBitcoinNetwork(input.walletNetwork, 'mainnet');
  const artifact = await verifySignedOriginal(input, network);
  const networkObj = getNetwork(network);
  const bip78Original = buildBip78OriginalPsbt(input.original.unsignedPsbtBase64, artifact.rawTx, networkObj);
  // BIP78 minfeerate: the receiver must keep the original's own fee rate.
  const result = await attemptPayjoinSend(bip78Original, input.body.payjoinUrl, networkObj, networkObj, {
    minFeeRate: artifact.feeRateSatsPerVbyte,
  });
  if (!result.success) return fallback(result.error);
  if (!result.proposalPsbt) return fallback('Payjoin receiver returned no proposal');
  const inputRoles = derivePayjoinInputRoles(input.original.unsignedPsbtBase64, result.proposalPsbt);
  const proposal = bitcoin.Psbt.fromBase64(result.proposalPsbt, { network: networkObj });
  const refusal = await peerInputRefusal(input.walletId, proposal, peerIndexesOf(inputRoles));
  if (refusal) return fallback(refusal);
  return mintReplacementIntent(input, network, proposal, inputRoles);
};
