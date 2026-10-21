/**
 * usePayjoin Hook
 *
 * Owns the two-round BIP78 payjoin state machine. Round one hands the server
 * the signed original (from an uploaded or QR-scanned PSBT); a valid proposal
 * then needs its own round-two signature before anything is broadcast. Every
 * failure falls back to the signed original only after the server confirms,
 * through `releasePayjoinOriginal`, that the original is broadcastable again,
 * so Sanctuary never broadcasts both.
 *
 * The status, busy flag and original snapshot are mirrored in refs: unmount
 * and reset cleanup (including the one `navigate()` triggers after a broadcast)
 * runs from a stale closure and must read the live values.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import * as bitcoin from 'bitcoinjs-lib';
import * as payjoinApi from '../../api/payjoin';
import { ApiError, apiErrorMessageOr } from '../../api/client';
import { isMultisigType } from '../../types';
import type { Wallet } from '../../types';
import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';
import { createLogger } from '../../utils/logger';
import { toHex } from '../../utils/bufferUtils';
import type { PayjoinAttemptStatus, TransactionState } from '../../contexts/send/types';
import { getBoundPayjoinUrl } from '../../contexts/send/reducerParts/payjoin';
import { requiresApproval, type TransactionData } from './types';
import type { BroadcastFailureInfo, BroadcastOverrides } from './useBroadcast';
import type { SignedArtifactOrigin } from './useQrSigning';

const log = createLogger('Payjoin');

/** Above the server's 30s receiver budget plus validation (decision C-D11). */
export const PAYJOIN_ATTEMPT_TIMEOUT_MS = 75_000;

export const PAYJOIN_STATE_UNCERTAIN_MESSAGE =
  'Payjoin state is uncertain; check wallet activity before retrying';
export const PAYJOIN_PENDING_RECONCILIATION_MESSAGE =
  'Broadcast pending reconciliation; check wallet activity before retrying';
export const PAYJOIN_DRAFT_LOCKED_MESSAGE =
  'Drafts cannot be saved while a payjoin is in progress';
export const PAYJOIN_PROPOSAL_MISMATCH_MESSAGE =
  'This signed transaction is not the payjoin proposal. Sign the proposal, or choose "Send without payjoin".';

const PAYJOIN_SCRIPT_TYPES: ReadonlySet<string> = new Set(['native_segwit', 'taproot']);

/** The signed original and the state it was signed in; the only fallback artifact. */
export interface PayjoinOriginal {
  walletId: string;
  txData: TransactionData;
  signedPsbt: string;
  signedDevices: Set<string>;
}

type PayjoinReleaseOutcome =
  | { kind: 'released'; restored: boolean }
  | { kind: 'conflict' }
  | { kind: 'error'; message: string };

type PayjoinReleaseRefusal = Exclude<PayjoinReleaseOutcome, { kind: 'released' }>;

type BroadcastPsbt = (signedPsbt?: string, rawTxHex?: string, overrides?: BroadcastOverrides) => Promise<boolean>;

type PayjoinClaim = 'original' | 'proposal';

/** A signed artifact as the broadcast would send it: a raw transaction wins over a PSBT. */
export interface PayjoinArtifact {
  psbt?: string | null;
  rawTxHex?: string | null;
}

export interface UsePayjoinResult {
  payjoinStatus: PayjoinAttemptStatus;
  isPayjoinBusy: boolean;
  /** True from the moment a proposal was adopted until reset. */
  proposalMinted: boolean;
  /** The original the current round falls back to (for the proposal panel). */
  originalTxData: TransactionData | null;
  statusRef: React.RefObject<PayjoinAttemptStatus>;
  busyRef: React.RefObject<boolean>;
  originalRef: React.RefObject<PayjoinOriginal | null>;
  originRef: React.RefObject<SignedArtifactOrigin | null>;
  /** Which artifact of the round went to a broadcast; once the original did, the proposal is dead. */
  claimed: () => PayjoinClaim | null;
  claim: (artifact: PayjoinClaim) => void;
  /** A fresh signal for the round-one /attempt; abortAttempt() aborts only that, never a release or a broadcast. */
  startAttempt: () => AbortSignal;
  abortAttempt: () => void;
  setPayjoinStatus: (status: PayjoinAttemptStatus) => void;
  setPayjoinBusy: (busy: boolean) => void;
  beginPayjoinRound: (original: PayjoinOriginal) => number;
  currentRoundToken: () => number;
  isRoundCurrent: (token: number) => boolean;
  /** Records the adopted proposal; round two then accepts only artifacts of its transaction. */
  markProposalMinted: (proposalPsbt: string) => void;
  /** The refusal message for an artifact round two must not take, or null when it may proceed. */
  checkRoundTwoArtifact: (artifact: PayjoinArtifact) => string | null;
  recordArtifactOrigin: (origin: SignedArtifactOrigin) => void;
  clearArtifactOrigin: () => void;
  releaseOriginal: (original: PayjoinOriginal) => Promise<PayjoinReleaseOutcome>;
  resetPayjoin: () => void;
}

/** Everything the round helpers below need from the orchestrator. */
export interface PayjoinRoundContext {
  payjoin: UsePayjoinResult;
  token: number;
  broadcast: BroadcastPsbt;
  setError: (message: string | null) => void;
  /** Put the signed original back into hook state (txData, PSBT, signed devices; no raw tx). */
  restoreOriginal: (original: PayjoinOriginal) => void;
  /** Make the proposal the transaction under review; it is unsigned for the sender. */
  adoptProposal: (proposal: TransactionData) => void;
}

export interface PayjoinRoundOneRequest {
  original: PayjoinOriginal;
  payjoinUrl: string;
  network: NetworkType;
}

interface PayjoinCandidate {
  state: Pick<
    TransactionState,
    'transactionType' | 'payjoinUrl' | 'payjoinAddress' | 'outputs' | 'isDraftMode' | 'draftId'
  >;
  wallet: Pick<Wallet, 'type' | 'scriptType'>;
  txData: TransactionData | null;
}

/**
 * A send that may negotiate a payjoin once it holds an uploaded/QR signature:
 * single-sig native segwit or taproot, an endpoint bound to the single output's
 * address, no draft, no approval hold (decision C-D3). The server refuses the
 * other cases independently.
 */
export function isPayjoinCandidate({ state, wallet, txData }: PayjoinCandidate): boolean {
  if (!getBoundPayjoinUrl(state) || !txData) return false;
  const scriptType = txData.signingContext?.scriptType ?? wallet.scriptType ?? '';
  return !state.isDraftMode
    && !state.draftId
    && !isMultisigType(wallet.type)
    && PAYJOIN_SCRIPT_TYPES.has(scriptType)
    && !requiresApproval(txData.policyEvaluation);
}

interface RoundOneInputs extends PayjoinCandidate {
  walletId: string;
  network: Wallet['network'];
  signedPsbt: string | null;
  rawTxHex: string | undefined;
  signedRawTx: string | null;
  signedDevices: Set<string>;
  origin: SignedArtifactOrigin | null;
}

/** The round-one request for an eligible broadcast, or null for an ordinary broadcast. */
export function resolvePayjoinRoundOne(inputs: RoundOneInputs): PayjoinRoundOneRequest | null {
  const { txData, signedPsbt } = inputs;
  // A raw transaction comes from a USB signer; payjoin round one needs a file/QR signature.
  if (!inputs.origin || !signedPsbt || inputs.rawTxHex || inputs.signedRawTx) return null;
  if (!txData || !isPayjoinCandidate(inputs)) return null;
  return {
    original: {
      walletId: inputs.walletId,
      txData,
      signedPsbt,
      signedDevices: new Set(inputs.signedDevices),
    },
    // isPayjoinCandidate already required a bound payjoin URL.
    payjoinUrl: getBoundPayjoinUrl(inputs.state) as string,
    network: (inputs.network || 'mainnet') as NetworkType,
  };
}

const PAYJOIN_STATUS_GROUPS = {
  /** A proposal awaits or is in its broadcast: only its own signature may be taken. */
  roundTwo: new Set<PayjoinAttemptStatus>(['awaiting-signature', 'broadcasting']),
  /** A payjoin intent exists, which can never become a draft (C-D9). */
  draftLocked: new Set<PayjoinAttemptStatus>(['negotiating', 'awaiting-signature', 'broadcasting']),
} as const;

/** The one place that says which payjoin statuses lock what. */
export const isPayjoinStatusIn = (group: keyof typeof PAYJOIN_STATUS_GROUPS, status: PayjoinAttemptStatus): boolean =>
  PAYJOIN_STATUS_GROUPS[group].has(status);

/**
 * The txid of an artifact's unsigned transaction (a raw transaction's txid
 * excludes its witnesses, so it matches), or null when it does not parse.
 */
function artifactTxid({ psbt, rawTxHex }: PayjoinArtifact): string | null {
  try {
    if (rawTxHex) return bitcoin.Transaction.fromHex(rawTxHex).getId();
    if (!psbt) return null;
    const unsignedTx = bitcoin.Psbt.fromBase64(psbt).data.globalMap.unsignedTx;
    return bitcoin.Transaction.fromBuffer(unsignedTx.toBuffer()).getId();
  } catch (err) {
    log.debug('Signed artifact does not parse as a transaction', { error: err });
    return null;
  }
}

// The throws below are defensive: the server validates the proposal and its prevouts first.
function getProposalInputValue(psbt: bitcoin.Psbt, index: number): bigint {
  const input = psbt.data.inputs[index];
  if (input.witnessUtxo) return input.witnessUtxo.value;
  if (input.nonWitnessUtxo) {
    return bitcoin.Transaction.fromBuffer(input.nonWitnessUtxo).outs[psbt.txInputs[index].index].value;
  }
  throw new Error(`Payjoin proposal input ${index} has no previous output`);
}

/**
 * Broadcast and draft metadata must describe the proposal the server minted
 * the new intent from: every input (the receiver's included), the proposal's
 * fee, and the canonical amount the server derived for that intent (P - r
 * when the receiver raised the fee out of its contribution). The amount is
 * never recomputed here: broadcast compares it to the server's own.
 */
export function applyPayjoinProposal(result: TransactionData, proposalPsbt: string, amount: number): Pick<
  TransactionData, 'utxos' | 'fee' | 'totalInput' | 'totalOutput' | 'effectiveAmount'
> {
  const psbt = bitcoin.Psbt.fromBase64(proposalPsbt);
  const known = new Map(result.utxos.map(utxo => [`${utxo.txid}:${utxo.vout}`, utxo]));
  let totalInput = 0n;
  const utxos = psbt.txInputs.map((input, index) => {
    const txid = toHex(Uint8Array.from(input.hash).reverse());
    const inputValue = getProposalInputValue(psbt, index);
    totalInput += inputValue;
    return known.get(`${txid}:${input.index}`) ?? { txid, vout: input.index, amount: Number(inputValue) };
  });
  const totalOutput = psbt.txOutputs.reduce((sum, output) => sum + output.value, 0n);
  // Unreachable for a server-validated proposal; kept as a fallback to the original transaction.
  if (totalInput < totalOutput) throw new Error('Payjoin proposal spends more than its inputs');
  return {
    utxos,
    fee: Number(totalInput - totalOutput),
    totalInput: Number(totalInput),
    totalOutput: Number(totalOutput),
    effectiveAmount: amount,
  };
}

/** The proposal as the transaction under review, or null when the response is not a usable proposal. */
function buildProposalTransaction(
  original: TransactionData,
  response: payjoinApi.PayjoinAttemptResult,
): TransactionData | null {
  // The schema makes a success atomic; the signing-context check also guards untyped callers.
  // The server floors the net amount at 0, which can be neither broadcast nor saved.
  if (!response.success || !response.signingContext || !(response.amount > 0)) return null;
  return {
    ...original,
    ...applyPayjoinProposal(original, response.proposalPsbt, response.amount),
    psbtBase64: response.proposalPsbt,
    intentId: response.intentId,
    intentDigest: response.intentDigest,
    signingContext: response.signingContext,
  };
}

const classifyReleaseError = (err: unknown): PayjoinReleaseRefusal => {
  if (err instanceof ApiError && err.status === 409) return { kind: 'conflict' };
  return { kind: 'error', message: apiErrorMessageOr(err, 'Could not restore the original transaction') };
};

function finishRound(ctx: PayjoinRoundContext, status: PayjoinAttemptStatus, result: boolean): boolean {
  if (!ctx.payjoin.isRoundCurrent(ctx.token)) return result;
  ctx.payjoin.setPayjoinStatus(status);
  ctx.payjoin.setPayjoinBusy(false);
  return result;
}

function stopOnReleaseRefusal(ctx: PayjoinRoundContext, outcome: PayjoinReleaseRefusal): boolean {
  ctx.setError(outcome.kind === 'conflict' ? PAYJOIN_STATE_UNCERTAIN_MESSAGE : outcome.message);
  return finishRound(ctx, 'failed', false);
}

/**
 * Broadcast the signed original. If that broadcast fails for any reason, ask
 * the server once more and retry exactly once only when it restored the
 * original meanwhile (a proposal persisted after the client gave up; C-D11).
 * The decision never reads a broadcast lease: the fallback's own
 * beginBroadcast() replaces any earlier one.
 */
async function broadcastOriginalWithRetry(ctx: PayjoinRoundContext, original: PayjoinOriginal): Promise<boolean> {
  const { payjoin } = ctx;
  payjoin.claim('original');
  payjoin.setPayjoinBusy(true);
  let failure: BroadcastFailureInfo | undefined;
  const sent = await ctx.broadcast(original.signedPsbt, undefined, {
    transaction: original.txData,
    onFailure: (info) => { failure = info; },
  });
  if (sent || !failure || !payjoin.isRoundCurrent(ctx.token)) {
    return finishRound(ctx, 'failed', sent);
  }
  log.warn('Fallback broadcast failed; asking the server whether to retry', { ...failure });
  const outcome = await payjoin.releaseOriginal(original);
  if (!payjoin.isRoundCurrent(ctx.token)) return false;
  if (outcome.kind !== 'released') return stopOnReleaseRefusal(ctx, outcome);
  if (!outcome.restored) return finishRound(ctx, 'failed', false);
  const retried = await ctx.broadcast(original.signedPsbt, undefined, { transaction: original.txData });
  return finishRound(ctx, 'failed', retried);
}

/** Round-one failure or an explicit "Send without payjoin": release, then broadcast the original (C-D1). */
export async function fallbackToPayjoinOriginal(ctx: PayjoinRoundContext, original: PayjoinOriginal): Promise<boolean> {
  const { payjoin } = ctx;
  payjoin.setPayjoinStatus('failed');
  payjoin.setPayjoinBusy(true);
  ctx.restoreOriginal(original);
  const outcome = await payjoin.releaseOriginal(original);
  if (!payjoin.isRoundCurrent(ctx.token)) return false;
  if (outcome.kind !== 'released') return stopOnReleaseRefusal(ctx, outcome);
  return broadcastOriginalWithRetry(ctx, original);
}

/** Round one: post the signed original; adopt a valid proposal or fall back. Never broadcasts a proposal. */
export async function negotiatePayjoin(ctx: PayjoinRoundContext, request: PayjoinRoundOneRequest): Promise<boolean> {
  const { payjoin } = ctx;
  const { original } = request;
  const signal = payjoin.startAttempt();
  payjoin.setPayjoinStatus('negotiating');
  payjoin.setPayjoinBusy(true);
  log.info('Attempting Payjoin', { payjoinUrl: request.payjoinUrl, network: request.network });

  let proposal: TransactionData | null;
  try {
    const response = await payjoinApi.attemptPayjoin(
      original.walletId,
      original.signedPsbt,
      original.txData.intentId,
      original.txData.intentDigest,
      request.payjoinUrl,
      request.network,
      { signal, timeoutMs: PAYJOIN_ATTEMPT_TIMEOUT_MS },
    );
    if (!payjoin.isRoundCurrent(ctx.token)) return false;
    // A throw here comes after the server persisted the replacement; the release restores the original.
    proposal = buildProposalTransaction(original.txData, response);
    if (!proposal) log.warn('Payjoin unavailable; sending the signed original', { error: response.error });
  } catch (err) {
    if (!payjoin.isRoundCurrent(ctx.token)) return false;
    log.warn('Payjoin attempt failed; sending the signed original', { error: err });
    return fallbackToPayjoinOriginal(ctx, original);
  }

  if (!proposal) return fallbackToPayjoinOriginal(ctx, original);
  ctx.adoptProposal(proposal);
  payjoin.markProposalMinted(proposal.psbtBase64);
  log.info('Payjoin proposal ready for its second signature');
  return finishRound(ctx, 'awaiting-signature', false);
}

/** Round two: broadcast the signed proposal; on any failure let the server decide what follows. */
export async function broadcastPayjoinProposal(
  ctx: PayjoinRoundContext,
  original: PayjoinOriginal,
  signedPsbt?: string,
  rawTxHex?: string,
): Promise<boolean> {
  const { payjoin } = ctx;
  // Never both: once the original was handed to a broadcast, the proposal is dead.
  if (payjoin.claimed() === 'original') return false;
  // Set before the call: the navigate() after a success unmounts with this status, which must not
  // release; busy makes a second Broadcast before the re-render a no-op instead of a second lease.
  payjoin.setPayjoinStatus('broadcasting');
  payjoin.setPayjoinBusy(true);
  if (await ctx.broadcast(signedPsbt, rawTxHex)) return finishRound(ctx, 'success', true);
  if (!payjoin.isRoundCurrent(ctx.token)) return false;

  // The boolean says nothing about the server's state (a stale lease reports false after success).
  const outcome = await payjoin.releaseOriginal(original);
  if (!payjoin.isRoundCurrent(ctx.token)) return false;
  if (outcome.kind === 'conflict') {
    // The proposal's outcome is unknown or it was accepted: never broadcast the original.
    payjoin.claim('proposal');
    ctx.setError(PAYJOIN_PENDING_RECONCILIATION_MESSAGE);
    return finishRound(ctx, 'broadcasting', false);
  }
  if (outcome.kind === 'error') return stopOnReleaseRefusal(ctx, outcome);
  log.info('Payjoin proposal was not broadcast; sending the signed original without payjoin');
  payjoin.setPayjoinStatus('failed');
  ctx.restoreOriginal(original);
  return broadcastOriginalWithRetry(ctx, original);
}

/** "Send without payjoin": abort only /attempt while negotiating, or release and fall back from round two. */
export async function abandonPayjoinProposal(ctx: PayjoinRoundContext, original: PayjoinOriginal): Promise<boolean> {
  const status = ctx.payjoin.statusRef.current;
  if (status === 'negotiating') {
    // The aborted attempt takes the round-one failure path: release, then the original.
    ctx.payjoin.abortAttempt();
    return false;
  }
  if (status !== 'awaiting-signature') return false;
  return fallbackToPayjoinOriginal(ctx, original);
}

export function usePayjoin(): UsePayjoinResult {
  const [payjoinStatus, setStatusState] = useState<PayjoinAttemptStatus>('idle');
  const [isPayjoinBusy, setBusyState] = useState(false);
  const [proposalMinted, setProposalMinted] = useState(false);
  const statusRef = useRef<PayjoinAttemptStatus>('idle');
  const busyRef = useRef(false);
  const originalRef = useRef<PayjoinOriginal | null>(null);
  const originRef = useRef<SignedArtifactOrigin | null>(null);
  const claimedRef = useRef<PayjoinClaim | null>(null);
  const proposalTxidRef = useRef<string | null>(null);
  const roundToken = useRef(0);
  const attemptControllerRef = useRef<AbortController | null>(null);

  const setPayjoinStatus = useCallback((status: PayjoinAttemptStatus) => {
    statusRef.current = status;
    setStatusState(status);
  }, []);

  const setPayjoinBusy = useCallback((busy: boolean) => {
    busyRef.current = busy;
    setBusyState(busy);
  }, []);

  const beginPayjoinRound = useCallback((original: PayjoinOriginal) => {
    originalRef.current = original;
    claimedRef.current = null;
    proposalTxidRef.current = null;
    roundToken.current += 1;
    return roundToken.current;
  }, []);

  const currentRoundToken = useCallback(() => roundToken.current, []);
  const isRoundCurrent = useCallback((token: number) => token === roundToken.current, []);
  const claimed = useCallback(() => claimedRef.current, []);
  const claim = useCallback((artifact: PayjoinClaim) => { claimedRef.current = artifact; }, []);
  const startAttempt = useCallback(() => {
    attemptControllerRef.current = new AbortController();
    return attemptControllerRef.current.signal;
  }, []);
  // Aborting a settled attempt's controller is a no-op.
  const abortAttempt = useCallback(() => attemptControllerRef.current?.abort(), []);
  const markProposalMinted = useCallback((proposalPsbt: string) => {
    proposalTxidRef.current = artifactTxid({ psbt: proposalPsbt });
    setProposalMinted(true);
  }, []);
  // An unparsable artifact, or a proposal txid that never parsed, is refused like any other mismatch.
  const checkRoundTwoArtifact = useCallback((artifact: PayjoinArtifact): string | null => {
    if (!isPayjoinStatusIn('roundTwo', statusRef.current)) return null;
    const txid = artifactTxid(artifact);
    return txid !== null && txid === proposalTxidRef.current ? null : PAYJOIN_PROPOSAL_MISMATCH_MESSAGE;
  }, []);
  const recordArtifactOrigin = useCallback((origin: SignedArtifactOrigin) => { originRef.current = origin; }, []);
  const clearArtifactOrigin = useCallback(() => { originRef.current = null; }, []);

  // No abort signal: the owner lease is aborted on unmount, and the release must still reach the server.
  const releaseOriginal = useCallback(async (original: PayjoinOriginal): Promise<PayjoinReleaseOutcome> => {
    try {
      const { restored } = await payjoinApi.releasePayjoinOriginal(
        original.walletId,
        original.txData.intentId,
        original.txData.intentDigest,
      );
      return { kind: 'released', restored };
    } catch (err) {
      return classifyReleaseError(err);
    }
  }, []);

  // Reset, identity change and unmount broadcast nothing; a pending round's original is released best-effort.
  const abandonRound = useCallback(() => {
    const status = statusRef.current;
    const original = originalRef.current;
    roundToken.current += 1;
    abortAttempt();
    if (!original || (status !== 'negotiating' && status !== 'awaiting-signature')) return;
    void releaseOriginal(original).then((outcome) => {
      if (outcome.kind !== 'released') log.warn('Failed to release the payjoin original', { outcome });
    });
  }, [abortAttempt, releaseOriginal]);

  const resetPayjoin = useCallback(() => {
    abandonRound();
    originalRef.current = null;
    originRef.current = null;
    claimedRef.current = null;
    proposalTxidRef.current = null;
    setProposalMinted(false);
    setPayjoinBusy(false);
    setPayjoinStatus('idle');
  }, [abandonRound, setPayjoinBusy, setPayjoinStatus]);

  useEffect(() => abandonRound, [abandonRound]);

  // Stable while the round's state is unchanged, so the orchestrator's callbacks keep their identity.
  // originalRef only changes together with the status (a round begins negotiating; a reset goes
  // idle), so the snapshot of the original's txData below is never stale.
  return useMemo(() => ({
    payjoinStatus,
    isPayjoinBusy,
    proposalMinted,
    originalTxData: originalRef.current?.txData ?? null,
    statusRef,
    busyRef,
    originalRef,
    originRef,
    claimed,
    claim,
    startAttempt,
    abortAttempt,
    setPayjoinStatus,
    setPayjoinBusy,
    beginPayjoinRound,
    currentRoundToken,
    isRoundCurrent,
    markProposalMinted,
    checkRoundTwoArtifact,
    recordArtifactOrigin,
    clearArtifactOrigin,
    releaseOriginal,
    resetPayjoin,
  }), [
    payjoinStatus,
    isPayjoinBusy,
    proposalMinted,
    claimed,
    claim,
    startAttempt,
    abortAttempt,
    setPayjoinStatus,
    setPayjoinBusy,
    beginPayjoinRound,
    currentRoundToken,
    isRoundCurrent,
    markProposalMinted,
    checkRoundTwoArtifact,
    recordArtifactOrigin,
    clearArtifactOrigin,
    releaseOriginal,
    resetPayjoin,
  ]);
}
