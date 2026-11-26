/**
 * Policy Evaluation Engine Tests
 *
 * Comprehensive tests for policy evaluation logic covering spending limits,
 * address controls, approval requirements, velocity limits, time delays,
 * monitor mode, preview mode, error handling, and usage recording.
 *
 * Target: 100% line/branch/statement/function coverage.
 */

import { describe, expect, it } from 'vitest';
import { registerPolicyEvaluateControlsTimingTests } from './policyEvaluationEngine/evaluate.controls-timing.contracts';
import { registerPolicyEvaluateErrorPreviewMultipleTests } from './policyEvaluationEngine/evaluate.error-preview-multiple.contracts';
import { registerPolicyEvaluateSpendingApprovalTests } from './policyEvaluationEngine/evaluate.spending-approval.contracts';
import { registerPolicyRecordUsageTests } from './policyEvaluationEngine/recordUsage.contracts';
import { registerReserveEnforcedUsageTests } from './policyEvaluationEngine/reserveEnforcedUsage.contracts';
import { setupPolicyEvaluationEngineTestHooks } from './policyEvaluationEngine/policyEvaluationEngineTestHarness';
import { registerPolicyWindowBoundsTests } from './policyEvaluationEngine/windowBounds.contracts';
import { registerWalletHasEnforcedUsageWindowsTests } from './policyEvaluationEngine/walletHasEnforcedUsageWindows.contracts';
import {
  MAX_WARNED_POLICY_IDS,
  rememberWarnedPolicyId,
} from '../../../src/services/vaultPolicy/policyEvaluationEngine';

describe('PolicyEvaluationEngine', () => {
  const context = setupPolicyEvaluationEngineTestHooks();

  describe('evaluatePolicies', () => {
    registerPolicyEvaluateSpendingApprovalTests(context);
    registerPolicyEvaluateControlsTimingTests(context);
    registerPolicyEvaluateErrorPreviewMultipleTests(context);
  });

  registerPolicyRecordUsageTests(context);
  registerReserveEnforcedUsageTests(context);
  registerPolicyWindowBoundsTests(context);
  registerWalletHasEnforcedUsageWindowsTests(context);

  describe('P3-7 bounded warn-once policy sets', () => {
    it('preserves insertion order when a policy has already been recorded', () => {
      const seen = new Set(['first', 'second']);
      rememberWarnedPolicyId(seen, 'first');
      expect([...seen]).toEqual(['first', 'second']);
    });

    it('caps warned policy ID sets at MAX_WARNED_POLICY_IDS by evicting oldest entries', () => {
      const seen = new Set<string>();
      for (let i = 0; i < MAX_WARNED_POLICY_IDS + 25; i += 1) {
        rememberWarnedPolicyId(seen, `policy-${i}`);
      }
      expect(seen.size).toBe(MAX_WARNED_POLICY_IDS);
      expect(seen.has('policy-0')).toBe(false);
      expect(seen.has(`policy-${MAX_WARNED_POLICY_IDS + 24}`)).toBe(true);
    });
  });
});
