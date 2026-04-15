/**
 * Vault Policy Service Tests
 *
 * Registrar for policy CRUD, validation, and inheritance contract modules.
 */

import { describe } from 'vitest';
import { registerVaultPolicyCreateValidationContracts } from './vaultPolicyService/vaultPolicyService.create-validation.contracts';
import { registerVaultPolicyReadAddressContracts } from './vaultPolicyService/vaultPolicyService.read-address.contracts';
import { registerVaultPolicyUpdateDeleteContracts } from './vaultPolicyService/vaultPolicyService.update-delete.contracts';
import { registerVaultPolicyServiceTestHarness } from './vaultPolicyService/vaultPolicyServiceTestHarness';

describe('VaultPolicyService', () => {
  registerVaultPolicyServiceTestHarness();

  registerVaultPolicyCreateValidationContracts();
  registerVaultPolicyReadAddressContracts();
  registerVaultPolicyUpdateDeleteContracts();
});
