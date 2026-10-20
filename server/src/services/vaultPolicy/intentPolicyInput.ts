/**
 * Policy evaluation input for an authenticated signing intent.
 *
 * Built from the intent's snapshot (via deriveIntentSpend) — never from the
 * client-requested recipient/amount — so draft creation, the create-route
 * echo and the payjoin attempt evaluate exactly what will be signed. A
 * verified RBF replacement carries `{ replacedAmount, isReplacementBump }`
 * as broadcast does: approval triggers and per-transaction limits still see
 * the full amount; only rolling-window accounting uses the delta.
 */
import { deriveIntentSpend, type IntentSpend, type SigningIntentEnvelope } from '../bitcoin/signingIntent';
import { findVerifiedReplacement } from '../bitcoin/transactions/replacementLink';
import type { PolicyEvaluationInput, PolicyEvaluationResult } from './types';

/**
 * Null when nothing leaves the wallet (no external outputs): there is no spend to evaluate.
 * A caller that already derived the intent's spend passes it to avoid a second derivation.
 */
export const buildIntentPolicyInput = async (
  walletId: string,
  userId: string,
  intent: Pick<SigningIntentEnvelope, 'snapshot'>,
  precomputedSpend?: IntentSpend,
): Promise<PolicyEvaluationInput | null> => {
  let spend = precomputedSpend;
  if (!spend) {
    spend = await deriveIntentSpend(walletId, intent.snapshot.network, intent.snapshot);
  }
  if (spend.externalOutputs.length === 0) return null;
  const replacement = spend.replacementTxid
    ? await findVerifiedReplacement(walletId, spend.replacementTxid, spend.inputs, undefined)
    : null;
  return {
    walletId,
    userId,
    recipient: spend.externalOutputs[0].address,
    amount: BigInt(spend.amount),
    outputs: spend.externalOutputs,
    ...(replacement && { replacedAmount: replacement.amount, isReplacementBump: true }),
  };
};

/** An enforce-mode approval_required policy fired (monitor mode reports `monitored`). */
export const requiresEnforcedApproval = (result: Pick<PolicyEvaluationResult, 'triggered'>): boolean =>
  result.triggered?.some(trigger => trigger.action === 'approval_required') ?? false;
