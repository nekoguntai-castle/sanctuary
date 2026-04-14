import { beforeEach, describe } from 'vitest';
import { registerPolicyRepositoryApprovalVoteContracts } from './policyRepository/policyRepository.approvals-votes.contracts';
import { registerPolicyRepositoryCrudContracts } from './policyRepository/policyRepository.policy-crud.contracts';
import { registerPolicyRepositoryEventAddressContracts } from './policyRepository/policyRepository.events-addresses.contracts';
import { setupPolicyRepositoryMocks } from './policyRepository/policyRepositoryTestHarness';
import { registerPolicyRepositoryUsageExportContracts } from './policyRepository/policyRepository.usage-export.contracts';

describe('policyRepository', () => {
  beforeEach(setupPolicyRepositoryMocks);

  registerPolicyRepositoryCrudContracts();
  registerPolicyRepositoryApprovalVoteContracts();
  registerPolicyRepositoryEventAddressContracts();
  registerPolicyRepositoryUsageExportContracts();
});
