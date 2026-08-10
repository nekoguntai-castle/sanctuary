import { describe, expect, it } from 'vitest';

import type {
  CreatePolicyInput,
} from '../../../../src/services/vaultPolicy/types';
import {
  groupId,
  mockPolicyRepo,
  policyId,
  userId,
  vaultPolicyService,
  walletId,
} from './vaultPolicyServiceTestHarness';

export function registerVaultPolicyCreateValidationContracts(): void {
  describe('createPolicy', () => {
    it('creates a spending_limit policy with valid config', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Daily Limit',
        type: 'spending_limit',
        config: {
          perTransaction: 1_000_000,
          daily: 10_000_000,
          scope: 'wallet',
        },
      };

      const mockPolicy = {
        id: policyId,
        ...input,
        config: input.config,
        priority: 0,
        enforcement: 'enforce',
        enabled: true,
        createdBy: userId,
        sourceType: 'wallet',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPolicyRepo.createPolicy.mockResolvedValue(mockPolicy);

      const result = await vaultPolicyService.createPolicy(userId, input);

      expect(result.id).toBe(policyId);
      expect(result.name).toBe('Daily Limit');
      expect(mockPolicyRepo.createPolicy).toHaveBeenCalledTimes(1);
    });

    it('creates an approval_required policy with valid config', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Large Transaction Approval',
        type: 'approval_required',
        config: {
          trigger: { amountAbove: 5_000_000 },
          requiredApprovals: 2,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 48,
        },
      };

      mockPolicyRepo.createPolicy.mockResolvedValue({
        id: policyId,
        ...input,
        config: input.config,
      });

      const result = await vaultPolicyService.createPolicy(userId, input);
      expect(result.id).toBe(policyId);
    });

    it('creates a specific quorum approval_required policy with approvers', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Specific Approval',
        type: 'approval_required',
        config: {
          trigger: { always: true },
          requiredApprovals: 1,
          quorumType: 'specific',
          specificApprovers: ['security-admin'],
          allowSelfApproval: false,
          expirationHours: 24,
        },
      };

      mockPolicyRepo.createPolicy.mockResolvedValue({
        id: policyId,
        ...input,
        config: input.config,
      });

      const result = await vaultPolicyService.createPolicy(userId, input);

      expect(result.id).toBe(policyId);
      expect(mockPolicyRepo.createPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            quorumType: 'specific',
            specificApprovers: ['security-admin'],
          }),
        }),
      );
    });

    it('creates a system-wide policy when no walletId or groupId', async () => {
      const input: CreatePolicyInput = {
        name: 'Org Spending Cap',
        type: 'spending_limit',
        config: {
          daily: 100_000_000,
          scope: 'wallet',
        },
      };

      mockPolicyRepo.createPolicy.mockResolvedValue({
        id: policyId,
        ...input,
        walletId: null,
        groupId: null,
        sourceType: 'system',
      });

      await vaultPolicyService.createPolicy(userId, input);

      expect(mockPolicyRepo.createPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: undefined,
          groupId: undefined,
          sourceType: 'system',
        })
      );
    });

    it('rejects invalid policy type', async () => {
      const input = {
        walletId,
        name: 'Bad Policy',
        type: 'invalid_type',
        config: {},
      };

      await expect(Reflect.apply(vaultPolicyService.createPolicy, vaultPolicyService, [userId, input]))
        .rejects.toThrow('Invalid policy type');
    });

    it('rejects empty name', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: '',
        type: 'spending_limit',
        config: { daily: 100, scope: 'wallet' },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('Policy name is required');
    });

    it('rejects name over 100 characters', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'a'.repeat(101),
        type: 'spending_limit',
        config: { daily: 100, scope: 'wallet' },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('100 characters');
    });

    it('rejects spending_limit with no limits set', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'No Limits',
        type: 'spending_limit',
        config: { scope: 'wallet' },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('at least one non-zero limit');
    });

    it('rejects spending_limit with missing scope', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Bad Scope',
        type: 'spending_limit',
        config: { daily: 100 } as any,
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('scope');
    });

    it('rejects non-object policy configs', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Bad Config',
        type: 'spending_limit',
        config: null as any,
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('spending_limit config must be an object');
    });

    it('rejects unknown policy config fields', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Extra Config',
        type: 'spending_limit',
        config: { daily: 100, scope: 'wallet', maxAmount: 100 } as any,
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('spending_limit config contains unknown field: maxAmount');
    });

    it('rejects spending_limit with invalid limit values', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Bad Limit',
        type: 'spending_limit',
        config: { daily: -1, weekly: 100, scope: 'wallet' } as any,
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('daily must be a non-negative integer');
    });

    it('rejects approval_required with no trigger', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'No Trigger',
        type: 'approval_required',
        config: {
          trigger: {},
          requiredApprovals: 1,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 24,
        },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('at least one condition');
    });

    it('rejects unknown approval trigger fields', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Extra Trigger',
        type: 'approval_required',
        config: {
          trigger: { amountAbove: 1, window: '24h' },
          requiredApprovals: 1,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 24,
        } as any,
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('approval_required trigger contains unknown field: window');
    });

    it('rejects approval_required with zero requiredApprovals', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Zero Approvals',
        type: 'approval_required',
        config: {
          trigger: { always: true },
          requiredApprovals: 0,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 24,
        },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('positive integer');
    });

    it('rejects specific quorum without specificApprovers', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Specific No Approvers',
        type: 'approval_required',
        config: {
          trigger: { always: true },
          requiredApprovals: 1,
          quorumType: 'specific',
          allowSelfApproval: false,
          expirationHours: 24,
        },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('specificApprovers');
    });

    it('rejects specific quorum with an empty specificApprovers array', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Specific Empty Approvers',
        type: 'approval_required',
        config: {
          trigger: { always: true },
          requiredApprovals: 1,
          quorumType: 'specific',
          specificApprovers: [],
          allowSelfApproval: false,
          expirationHours: 24,
        },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('specific quorum requires specificApprovers array');
    });

    it('rejects approval_required with false-only trigger flags', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'False Trigger',
        type: 'approval_required',
        config: {
          trigger: { always: false, unknownAddressesOnly: false },
          requiredApprovals: 1,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 24,
        },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('at least one condition');
    });

    it('rejects approval_required with invalid required fields', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Bad Approval Fields',
        type: 'approval_required',
        config: {
          trigger: { amountAbove: 1 },
          requiredApprovals: 1,
          quorumType: 'any_n',
          allowSelfApproval: 'no' as any,
          expirationHours: 24,
        },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('allowSelfApproval must be a boolean');
    });

    it('rejects time_delay exceeding 7 days', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Too Long',
        type: 'time_delay',
        config: {
          trigger: { always: true },
          delayHours: 200,
          vetoEligible: 'any_approver',
          notifyOnStart: true,
          notifyOnVeto: true,
          notifyOnClear: true,
        },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('168');
    });

    it('rejects time_delay with false-only trigger flags', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'False Trigger',
        type: 'time_delay',
        config: {
          trigger: { always: false },
          delayHours: 24,
          vetoEligible: 'any_approver',
          notifyOnStart: true,
          notifyOnVeto: true,
          notifyOnClear: true,
        },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('at least one condition');
    });

    it('rejects specific time_delay veto eligibility without vetoers', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'No Vetoers',
        type: 'time_delay',
        config: {
          trigger: { amountAbove: 1 },
          delayHours: 24,
          vetoEligible: 'specific',
          notifyOnStart: true,
          notifyOnVeto: true,
          notifyOnClear: true,
        },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('specificVetoers');
    });

    it('rejects velocity with no limits', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'No Velocity Limits',
        type: 'velocity',
        config: { scope: 'wallet' },
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('at least one non-zero limit');
    });

    it('rejects velocity with invalid limit values', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Bad Velocity Limit',
        type: 'velocity',
        config: { maxPerHour: 1.5, maxPerDay: 10, scope: 'wallet' } as any,
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('maxPerHour must be a non-negative integer');
    });

    it('validates address_control config', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Allowlist',
        type: 'address_control',
        config: {
          mode: 'allowlist',
          allowSelfSend: true,
          managedBy: 'owner_only',
        },
      };

      mockPolicyRepo.createPolicy.mockResolvedValue({
        id: policyId,
        ...input,
      });

      const result = await vaultPolicyService.createPolicy(userId, input);
      expect(result.id).toBe(policyId);
    });

    it('rejects invalid enforcement mode', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Bad Mode',
        type: 'spending_limit',
        config: { daily: 100, scope: 'wallet' },
        enforcement: 'block' as any,
      };

      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('Invalid enforcement mode');
    });
  });

  describe('validation edge cases', () => {
    it('creates a group-level policy', async () => {
      const input: CreatePolicyInput = {
        groupId,
        name: 'Group Cap',
        type: 'spending_limit',
        config: { daily: 50_000_000, scope: 'wallet' },
      };
      mockPolicyRepo.createPolicy.mockResolvedValue({ id: policyId, ...input, sourceType: 'group' });

      await vaultPolicyService.createPolicy(userId, input);
      expect(mockPolicyRepo.createPolicy).toHaveBeenCalledWith(
        expect.objectContaining({ sourceType: 'group' })
      );
    });

    it('rejects time_delay with zero delayHours', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Zero Delay',
        type: 'time_delay',
        config: {
          trigger: { always: true },
          delayHours: 0,
          vetoEligible: 'any_approver',
          notifyOnStart: true,
          notifyOnVeto: true,
          notifyOnClear: true,
        },
      };
      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('delayHours must be a positive number');
    });

    it('rejects time_delay with missing trigger', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'No Trigger',
        type: 'time_delay',
        config: {
          delayHours: 24,
          vetoEligible: 'any_approver',
          notifyOnStart: true,
          notifyOnVeto: true,
          notifyOnClear: true,
        } as any,
      };
      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('trigger');
    });

    it('rejects time_delay with invalid vetoEligible', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Bad Veto',
        type: 'time_delay',
        config: {
          trigger: { always: true },
          delayHours: 24,
          vetoEligible: 'nobody' as any,
          notifyOnStart: true,
          notifyOnVeto: true,
          notifyOnClear: true,
        },
      };
      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('vetoEligible');
    });

    it('rejects time_delay with invalid notification fields', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Bad Notify',
        type: 'time_delay',
        config: {
          trigger: { always: true },
          delayHours: 24,
          vetoEligible: 'any_approver',
          notifyOnStart: 'yes' as any,
          notifyOnVeto: true,
          notifyOnClear: true,
        },
      };
      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('notifyOnStart must be a boolean');
    });

    it('rejects address_control with invalid mode', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Bad Mode',
        type: 'address_control',
        config: {
          mode: 'blocklist' as any,
          allowSelfSend: true,
          managedBy: 'owner_only',
        },
      };
      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('mode');
    });

    it('rejects address_control with non-boolean allowSelfSend', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Bad Self Send',
        type: 'address_control',
        config: {
          mode: 'allowlist',
          allowSelfSend: 'yes' as any,
          managedBy: 'owner_only',
        },
      };
      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('allowSelfSend must be a boolean');
    });

    it('rejects address_control with invalid managedBy', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Bad Manager',
        type: 'address_control',
        config: {
          mode: 'allowlist',
          allowSelfSend: true,
          managedBy: 'admins' as any,
        },
      };
      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('managedBy');
    });

    it('rejects velocity with invalid scope', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Bad Scope',
        type: 'velocity',
        config: {
          maxPerDay: 10,
          scope: 'global' as any,
        },
      };
      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('scope');
    });

    it('rejects invalid optional role lists', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Bad Roles',
        type: 'velocity',
        config: {
          maxPerDay: 10,
          scope: 'wallet',
          exemptRoles: ['owner', ''],
        },
      };
      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('exemptRoles');
    });

    it('rejects approval_required with invalid quorumType', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Bad Quorum',
        type: 'approval_required',
        config: {
          trigger: { always: true },
          requiredApprovals: 1,
          quorumType: 'majority' as any,
          allowSelfApproval: false,
          expirationHours: 24,
        },
      };
      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('quorumType');
    });

    it('rejects approval_required with missing trigger object', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'No Trigger',
        type: 'approval_required',
        config: {
          requiredApprovals: 1,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 24,
        } as any,
      };
      await expect(vaultPolicyService.createPolicy(userId, input))
        .rejects.toThrow('trigger');
    });

    it('creates a valid time_delay policy', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Cool Down',
        type: 'time_delay',
        config: {
          trigger: { always: true },
          delayHours: 24,
          vetoEligible: 'specific',
          specificVetoers: [userId],
          notifyOnStart: true,
          notifyOnVeto: true,
          notifyOnClear: true,
        },
      };
      mockPolicyRepo.createPolicy.mockResolvedValue({ id: policyId, ...input });
      const result = await vaultPolicyService.createPolicy(userId, input);
      expect(result.id).toBe(policyId);
    });

    it('creates a valid velocity policy', async () => {
      const input: CreatePolicyInput = {
        walletId,
        name: 'Rate Limit',
        type: 'velocity',
        config: {
          maxPerDay: 10,
          scope: 'per_user',
        },
      };
      mockPolicyRepo.createPolicy.mockResolvedValue({ id: policyId, ...input });
      const result = await vaultPolicyService.createPolicy(userId, input);
      expect(result.id).toBe(policyId);
    });
  });
}
