/**
 * Policy Evaluation Engine Tests
 *
 * Comprehensive tests for policy evaluation logic covering spending limits,
 * address controls, approval requirements, velocity limits, time delays,
 * monitor mode, preview mode, error handling, and usage recording.
 *
 * Target: 100% line/branch/statement/function coverage.
 */

import { describe } from 'vitest';
import { registerPolicyEvaluateControlsTimingTests } from './policyEvaluationEngine/evaluate.controls-timing.contracts';
import { registerPolicyEvaluateErrorPreviewMultipleTests } from './policyEvaluationEngine/evaluate.error-preview-multiple.contracts';
import { registerPolicyEvaluateSpendingApprovalTests } from './policyEvaluationEngine/evaluate.spending-approval.contracts';
import { registerPolicyRecordUsageTests } from './policyEvaluationEngine/recordUsage.contracts';
import { setupPolicyEvaluationEngineTestHooks } from './policyEvaluationEngine/policyEvaluationEngineTestHarness';
import { registerPolicyWindowBoundsTests } from './policyEvaluationEngine/windowBounds.contracts';

describe('PolicyEvaluationEngine', () => {
  const context = setupPolicyEvaluationEngineTestHooks();

  describe('evaluatePolicies', () => {
    registerPolicyEvaluateSpendingApprovalTests(context);
    registerPolicyEvaluateControlsTimingTests(context);
    registerPolicyEvaluateErrorPreviewMultipleTests(context);
  });

  registerPolicyRecordUsageTests(context);
  registerPolicyWindowBoundsTests(context);
});
