import { describe, expect, it } from 'vitest';
import {
  makePolicy,
  mockLog,
  mockPolicyRepo,
  mockWalletRepo,
  mockVaultPolicyService,
  getPolicyEvaluationEngine,
  type PolicyEvaluationEngineTestContext,
} from './policyEvaluationEngineTestHarness';

const MAINNET_BECH32 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const TESTNET_BECH32 = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const MAINNET_BASE58 = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';

function setAddressControl(
  mode: 'allowlist' | 'denylist',
  entries: string[],
  network: string | undefined,
): void {
  mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
    makePolicy({
      id: 'p1',
      name: 'Canonical list',
      type: 'address_control',
      enforcement: 'enforce',
      config: { mode, allowSelfSend: true, managedBy: 'owner_only' },
    }),
  ]);
  mockPolicyRepo.findPolicyAddresses.mockResolvedValue(
    entries.map((address) => ({ address, listType: mode === 'allowlist' ? 'allow' : 'deny' })),
  );
  mockWalletRepo.findById.mockResolvedValue({ id: 'w', groupId: null, network });
}

export function registerPolicyEvaluateControlsTimingTests(context: PolicyEvaluationEngineTestContext): void {
  const { walletId, userId, groupId, recipient } = context;

    describe('address_control', () => {
      it('blocks address not on allowlist', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Allowlist',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
          { address: 'bc1qallowed1', listType: 'allow' },
          { address: 'bc1qallowed2', listType: 'allow' },
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId,
          recipient: 'bc1qnotallowed',
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('not on the allowlist');
      });

      it('allows address on allowlist', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Allowlist',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
          { address: 'bc1qallowed1', listType: 'allow' },
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId,
          recipient: 'bc1qallowed1',
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(0);
      });

      it('allows empty allowlist (no restrictions)', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Empty Allowlist',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId,
          recipient: 'bc1qanything',
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(0);
      });

      it('blocks address on denylist', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Denylist',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'denylist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
          { address: 'bc1qbadactor', listType: 'deny' },
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId,
          recipient: 'bc1qbadactor',
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('denylist');
      });

      it('allows address not on denylist', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Denylist',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'denylist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
          { address: 'bc1qbadactor', listType: 'deny' },
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId,
          recipient: 'bc1qgoodactor',
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(0);
      });

      it('checks multiple outputs against allowlist', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Allowlist',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
          { address: 'bc1qallowed1', listType: 'allow' },
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId,
          recipient: 'bc1qallowed1',
          amount: BigInt(100),
          outputs: [
            { address: 'bc1qallowed1', amount: 50 },
            { address: 'bc1qnotallowed', amount: 50 },
          ],
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('not on the allowlist');
      });

      it('allows all outputs when all on allowlist', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Allowlist',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
          { address: 'bc1qallowed1', listType: 'allow' },
          { address: 'bc1qallowed2', listType: 'allow' },
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId,
          recipient: 'bc1qallowed1',
          amount: BigInt(100),
          outputs: [
            { address: 'bc1qallowed1', amount: 50 },
            { address: 'bc1qallowed2', amount: 50 },
          ],
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(0);
      });

      it('checks multiple outputs against denylist and blocks if any match', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Denylist',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'denylist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
          { address: 'bc1qbadactor', listType: 'deny' },
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId,
          recipient: 'bc1qgoodactor',
          amount: BigInt(100),
          outputs: [
            { address: 'bc1qgoodactor', amount: 50 },
            { address: 'bc1qbadactor', amount: 50 },
          ],
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('denylist');
      });

      it('monitors but does not block in monitor mode', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Monitored Allowlist',
            type: 'address_control',
            enforcement: 'monitor',
            config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([
          { address: 'bc1qallowed1', listType: 'allow' },
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId,
          recipient: 'bc1qnotallowed',
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].action).toBe('monitored');
      });

      describe('address canonicalization', () => {
        const evaluate = (to: string) => getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient: to, amount: BigInt(100),
        });

        it('blocks a lowercase recipient on an uppercase denylist entry', async () => {
          setAddressControl('denylist', [MAINNET_BECH32.toUpperCase()], 'mainnet');
          const result = await evaluate(MAINNET_BECH32);
          expect(result.allowed).toBe(false);
          expect(mockLog.warn).not.toHaveBeenCalled();
        });

        it('lets an uppercase recipient through a padded allowlist entry', async () => {
          setAddressControl('allowlist', [`  ${MAINNET_BECH32}  `], 'mainnet');
          const result = await evaluate(MAINNET_BECH32.toUpperCase());
          expect(result.allowed).toBe(true);
        });

        it('warns once per policy, not per evaluation, for legacy undecodable rows', async () => {
          setAddressControl('denylist', ['legacy-one', 'legacy-two'], 'mainnet');
          const result = await evaluate(MAINNET_BECH32);
          expect(result.allowed).toBe(true);
          await evaluate(MAINNET_BECH32);
          expect(mockLog.warn).toHaveBeenCalledTimes(1);
        });

        it('decodes testnet entries with the wallet network', async () => {
          setAddressControl('denylist', [TESTNET_BECH32.toUpperCase()], 'testnet');
          const result = await evaluate(TESTNET_BECH32);
          expect(result.allowed).toBe(false);
          expect(mockLog.warn).not.toHaveBeenCalled();
        });

        it.each([undefined, 'bogus'])(
          'uses the fallback form on both sides when the wallet network is %s',
          async (network) => {
            setAddressControl('denylist', [MAINNET_BECH32.toUpperCase()], network);
            const result = await evaluate(MAINNET_BECH32);
            expect(result.allowed).toBe(false);
            expect(mockLog.warn).not.toHaveBeenCalled();
          },
        );

        it('trims non-bech32 entries but keeps their case in the fallback form', async () => {
          setAddressControl('denylist', [`  ${MAINNET_BASE58}  `], undefined);
          expect((await evaluate(MAINNET_BASE58)).allowed).toBe(false);

          setAddressControl('denylist', [MAINNET_BASE58.toLowerCase()], undefined);
          expect((await evaluate(MAINNET_BASE58)).allowed).toBe(true);
        });
      });
    });

    // ========================================
    // velocity
    // ========================================

    describe('velocity', () => {
      it('blocks when hourly tx count exceeded', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Hourly Limit',
            type: 'velocity',
            enforcement: 'enforce',
            config: { maxPerHour: 3, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 3,
        });

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('hourly');
        expect(result.triggered[0].type).toBe('velocity');
      });

      it('blocks when daily tx count exceeded', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Daily Tx Limit',
            type: 'velocity',
            enforcement: 'enforce',
            config: { maxPerDay: 5, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 5,
        });

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('daily');
      });

      it('blocks when weekly tx count exceeded', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Weekly Tx Limit',
            type: 'velocity',
            enforcement: 'enforce',
            config: { maxPerWeek: 10, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 10,
        });

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('weekly');
      });

      it('allows when under all velocity limits', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Multi Velocity',
            type: 'velocity',
            enforcement: 'enforce',
            config: { maxPerHour: 5, maxPerDay: 20, maxPerWeek: 100, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 2,
        });

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(0);
        // 3 window checks: hourly, daily, weekly
        expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledTimes(3);
      });

      it('uses per_user scope when configured', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Per-User Velocity',
            type: 'velocity',
            enforcement: 'enforce',
            config: { maxPerDay: 5, scope: 'per_user' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 0,
        });

        await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
          expect.objectContaining({ userId }),
        );
      });

      it('monitors but does not block in monitor mode', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Monitored Velocity',
            type: 'velocity',
            enforcement: 'monitor',
            config: { maxPerDay: 1, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 5,
        });

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].action).toBe('monitored');
      });
    });

    // ========================================
    // time_delay
    // ========================================

    describe('time_delay', () => {
      it('triggers when always is set', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Cooling Period',
            type: 'time_delay',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              delayHours: 24,
              vetoEligible: 'any_approver',
              notifyOnStart: true,
              notifyOnVeto: true,
              notifyOnClear: true,
            },
          }),
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        // Enforce-mode time_delay fails closed: no cooling-period feature
        // exists yet, so the draft is refused instead of silently proceeding.
        expect(result.allowed).toBe(false);
        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].type).toBe('time_delay');
        expect(result.triggered[0].action).toBe('blocked');
        expect(result.triggered[0].reason).toBe(
          'time-delay enforcement is not available; switch this policy to monitor mode or disable it'
        );
      });

      it('triggers when amountAbove threshold exceeded', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Large Tx Delay',
            type: 'time_delay',
            enforcement: 'enforce',
            config: {
              trigger: { amountAbove: 1_000_000 },
              delayHours: 12,
              vetoEligible: 'any_approver',
              notifyOnStart: true,
              notifyOnVeto: true,
              notifyOnClear: true,
            },
          }),
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(2_000_000),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].type).toBe('time_delay');
        expect(result.triggered[0].action).toBe('blocked');
      });

      it('does not trigger when amount is under amountAbove threshold', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Large Tx Delay',
            type: 'time_delay',
            enforcement: 'enforce',
            config: {
              trigger: { amountAbove: 1_000_000 },
              delayHours: 12,
              vetoEligible: 'any_approver',
              notifyOnStart: true,
              notifyOnVeto: true,
              notifyOnClear: true,
            },
          }),
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(500_000),
        });

        expect(result.triggered).toHaveLength(0);
      });

      it('does not trigger when trigger has no always or amountAbove', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Empty Trigger',
            type: 'time_delay',
            enforcement: 'enforce',
            config: {
              trigger: {},
              delayHours: 12,
              vetoEligible: 'any_approver',
              notifyOnStart: true,
              notifyOnVeto: true,
              notifyOnClear: true,
            },
          }),
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.triggered).toHaveLength(0);
      });

      it('sets action to monitored in monitor mode', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Monitored Delay',
            type: 'time_delay',
            enforcement: 'monitor',
            config: {
              trigger: { always: true },
              delayHours: 24,
              vetoEligible: 'any_approver',
              notifyOnStart: true,
              notifyOnVeto: true,
              notifyOnClear: true,
            },
          }),
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].action).toBe('monitored');
        expect(result.triggered[0].reason).toBe(
          'time-delay enforcement is not available; switch this policy to monitor mode or disable it'
        );
      });
    });
}
