/**
 * Vault Policy Collector
 *
 * Reports policy, approval request, and policy-event state. Intentionally
 * omits allowlist/denylist addresses and policy config details — a stuck
 * approval workflow is diagnosable from counts alone, and exposing the
 * address lists would leak wallet recipients.
 */

import { policyRepository } from '../../../repositories';
import { getErrorMessage } from '../../../utils/errors';
import { registerCollector } from './registry';

registerCollector('vaultPolicy', async () => {
  try {
    const stats = await policyRepository.getSupportStats();
    return stats as unknown as Record<string, unknown>;
  } catch (error) {
    return { error: getErrorMessage(error) };
  }
});
