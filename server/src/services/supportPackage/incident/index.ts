import { readIncidentJobEvidence } from './jobEvidence';
import { readIncidentTransactionEvidence } from './transactionEvidence';
import { getIncidentTelegramEligibilityCoverage } from '../../../repositories/supportNotificationDiagnosticsRepository';
import type {
  IncidentEvidenceSnapshot,
  IncidentRoleEvidence,
  IncidentSelectors,
} from './types';

export * from './types';
export { readIncidentJobEvidence } from './jobEvidence';
export { readIncidentTransactionEvidence } from './transactionEvidence';

async function readCurrentEligibility(
  walletId: string,
  direction: 'sent' | 'received',
): Promise<IncidentRoleEvidence['eligibility']> {
  try {
    return {
      evidenceSource: 'current_snapshot',
      coverage: await getIncidentTelegramEligibilityCoverage(walletId, direction),
    };
  } catch {
    return { evidenceSource: 'not_observed', coverage: 'unknown' };
  }
}

/** Assemble fixed sender/receiver evidence without returning any selector. */
export async function readIncidentEvidence(
  selectors: IncidentSelectors,
): Promise<IncidentEvidenceSnapshot> {
  const [transactionSnapshot, jobs, senderEligibility, receiverEligibility] = await Promise.all([
    readIncidentTransactionEvidence(selectors),
    readIncidentJobEvidence(selectors),
    readCurrentEligibility(selectors.senderWalletId, 'sent'),
    readCurrentEligibility(selectors.receiverWalletId, 'received'),
  ]);
  const sender: IncidentRoleEvidence = {
    role: 'sender',
    expectedDirection: 'sent',
    transaction: transactionSnapshot.roles[0],
    notificationJob: jobs[0],
    receiverMatch: {
      ownsSelectedOutput: 'not_applicable',
      networkMatches: 'not_applicable',
      addressTiming: 'not_applicable',
    },
    eligibility: senderEligibility,
  };
  const receiver: IncidentRoleEvidence = {
    role: 'receiver',
    expectedDirection: 'received',
    transaction: transactionSnapshot.roles[1],
    notificationJob: jobs[1],
    receiverMatch: transactionSnapshot.receiverMatch,
    eligibility: receiverEligibility,
  };
  return { roles: [sender, receiver] };
}
