import { describe } from 'vitest';

import { registerWalletPolicyAddressTests } from './walletPolicies/walletPolicies.addresses.contracts';
import { registerWalletPolicyCrudTests } from './walletPolicies/walletPolicies.crud.contracts';
import { registerWalletPolicyEventsEvaluationTests } from './walletPolicies/walletPolicies.events-evaluation.contracts';
import { setupWalletPoliciesTestHarness } from './walletPolicies/walletPoliciesTestHarness';

describe('Wallet Policies Routes', () => {
  setupWalletPoliciesTestHarness();
  registerWalletPolicyEventsEvaluationTests();
  registerWalletPolicyCrudTests();
  registerWalletPolicyAddressTests();
});
