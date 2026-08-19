import type { PrismaClient } from '../../../src/generated/prisma/client';
import {
  approveWalletRemediationProposal,
  cancelWalletRemediationProposal,
  createWalletRemediationProposal,
} from '../../../src/services/walletRemediation';
import { prepareDescriptorPolicy } from '../../../src/services/wallet/descriptorPolicy';
import {
  AUDIT_FIXTURE_CHANGE,
  AUDIT_FIXTURE_RECEIVE,
  AUDIT_FIXTURE_SOURCE,
  AUDIT_FIXTURE_XPUB,
  provenAuditSnapshot,
} from '../../fixtures/walletSafetyAuditFixture';
import { assertCanonicalAddressesForWallet } from '../../../src/services/wallet/canonicalAddressValidation';
import {
  canRunIntegrationTests,
  cleanupTestData,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup/testDatabase';
import { createTestUser, getTestUser } from '../setup/helpers';

const describeWithDatabase = canRunIntegrationTests() ? describe : describe.skip;
const FAILURE_TRIGGER = 'test_fail_wallet_remediation_address_update';
const FAILURE_FUNCTION = 'test_fail_wallet_remediation_address_update';

async function dropFailure(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${FAILURE_TRIGGER} ON "addresses"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${FAILURE_FUNCTION}()`);
}

async function installFailure(prisma: PrismaClient, walletId: string): Promise<void> {
  await dropFailure(prisma);
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION ${FAILURE_FUNCTION}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW."walletId" = '${walletId}' THEN
        RAISE EXCEPTION 'forced remediation metadata failure';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER ${FAILURE_TRIGGER}
    BEFORE UPDATE ON "addresses"
    FOR EACH ROW EXECUTE FUNCTION ${FAILURE_FUNCTION}()
  `);
}

async function createLegacyWallet(prisma: PrismaClient) {
  const user = await createTestUser(prisma, getTestUser());
  const fixture = provenAuditSnapshot();
  const descriptorPolicy = prepareDescriptorPolicy({
    receiveDescriptor: AUDIT_FIXTURE_SOURCE,
    sourceKind: 'imported',
  });
  const wallet = await prisma.wallet.create({
    data: {
      name: `remediation-${Date.now()}`,
      type: 'single_sig', scriptType: 'native_segwit', network: 'testnet3',
      descriptor: descriptorPolicy.descriptor,
      changeDescriptor: descriptorPolicy.changeDescriptor,
      fingerprint: 'aabbccdd',
      descriptorPolicyVersion: descriptorPolicy.descriptorPolicyVersion,
      descriptorSourceKind: descriptorPolicy.descriptorSourceKind,
      sourceDescriptor: descriptorPolicy.sourceDescriptor,
      sourceChangeDescriptor: descriptorPolicy.sourceChangeDescriptor,
      sourceDescriptorChecksum: descriptorPolicy.sourceDescriptorChecksum,
      sourceChangeDescriptorChecksum: descriptorPolicy.sourceChangeDescriptorChecksum,
      users: { create: { userId: user.id, role: 'owner' } },
    },
  });
  const device = await prisma.device.create({
    data: {
      userId: user.id, type: 'trezor', label: 'Remediation signer',
      fingerprint: 'aabbccdd', xpub: AUDIT_FIXTURE_XPUB,
      derivationPath: "m/84'/1'/0'",
    },
  });
  const account = await prisma.deviceAccount.create({
    data: {
      deviceId: device.id, purpose: 'single_sig', scriptType: 'native_segwit',
      derivationPath: "m/84'/1'/0'", xpub: AUDIT_FIXTURE_XPUB,
    },
  });
  await prisma.walletDevice.create({ data: { walletId: wallet.id, deviceId: device.id } });
  await prisma.address.createMany({
    data: fixture.addresses.map((address) => ({
      walletId: wallet.id,
      address: address.address,
      derivationPath: address.derivationPath,
      index: address.index,
    })),
  });
  return { user, wallet, account };
}

/**
 * A wallet exactly as an upgraded install holds it: a stored receive descriptor and
 * addresses, and NOTHING else — every descriptor-policy and canonical-policy column null.
 * This is the shape the two 20260810 migrations leave behind, and the shape that could
 * not be remediated before recovery existed.
 */
async function createLegacyNullWallet(prisma: PrismaClient) {
  const user = await createTestUser(prisma, getTestUser());
  const fixture = provenAuditSnapshot();
  const wallet = await prisma.wallet.create({
    data: {
      name: `remediation-legacy-null-${Date.now()}`,
      type: 'single_sig', scriptType: 'native_segwit', network: 'testnet3',
      descriptor: AUDIT_FIXTURE_RECEIVE,
      fingerprint: 'aabbccdd',
      users: { create: { userId: user.id, role: 'owner' } },
    },
  });
  const device = await prisma.device.create({
    data: {
      userId: user.id, type: 'trezor', label: 'Legacy signer',
      fingerprint: 'aabbccdd', xpub: AUDIT_FIXTURE_XPUB,
      derivationPath: "m/84'/1'/0'",
    },
  });
  const account = await prisma.deviceAccount.create({
    data: {
      deviceId: device.id, purpose: 'single_sig', scriptType: 'native_segwit',
      derivationPath: "m/84'/1'/0'", xpub: AUDIT_FIXTURE_XPUB,
    },
  });
  await prisma.walletDevice.create({ data: { walletId: wallet.id, deviceId: device.id } });
  await prisma.address.createMany({
    data: fixture.addresses.map((address) => ({
      walletId: wallet.id,
      address: address.address,
      derivationPath: address.derivationPath,
      index: address.index,
      used: false,
    })),
  });
  return { user, wallet, account };
}

describeWithDatabase('wallet remediation atomic evidence', () => {
  let prisma: PrismaClient;

  beforeAll(async () => { prisma = await setupTestDatabase(); });
  beforeEach(async () => { await dropFailure(prisma); await cleanupTestData(); });
  afterEach(async () => { await dropFailure(prisma); await cleanupTestData(); });
  afterAll(async () => { await teardownTestDatabase(); });

  it('recovers a legacy-null wallet end to end and unblocks receive addresses', async () => {
    const { user, wallet } = await createLegacyNullWallet(prisma);
    const before = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(before.descriptorPolicyVersion).toBeNull();
    expect(before.changeDescriptor).toBeNull();

    // Before recovery the ownership proof that gates deposit addresses cannot pass.
    // (assertUnusedAddressesSafeForDisplay wraps this behind a hardware-capability gate,
    // which is an independent axis this change does not touch, so the canonical proof is
    // asserted directly.)
    const legacyAddresses = await prisma.address.findMany({ where: { walletId: wallet.id } });
    await expect(assertCanonicalAddressesForWallet(wallet.id, legacyAddresses))
      .rejects.toThrow(/descriptor policy is incomplete/i);

    const proposal = await createWalletRemediationProposal(wallet.id, {
      userId: user.id, username: user.username,
    });
    expect(proposal.eligible).toBe(true);
    expect(proposal.changes.map((change) => change.kind)).toContain('wallet_policy_recovery');

    const applied = await approveWalletRemediationProposal(
      wallet.id, proposal.proposalId, proposal.proposalDigest,
      { userId: user.id, username: user.username },
    );
    expect(applied.state).toBe('applied');

    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(after).toMatchObject({
      descriptorPolicyVersion: 1,
      descriptorSourceKind: 'recovered_legacy',
      changeDescriptor: AUDIT_FIXTURE_CHANGE,
      sourceDescriptor: AUDIT_FIXTURE_RECEIVE,
      canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
      canonicalPolicyVersion: 1,
    });
    // The frozen columns are untouched, and no second source token was invented.
    expect(after.descriptor).toBe(before.descriptor);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.sourceChangeDescriptor).toBeNull();
    expect(after.sourceDescriptorChecksum).toBeNull();

    const afterAddresses = await prisma.address.findMany({
      where: { walletId: wallet.id }, orderBy: { index: 'asc' },
    });
    for (const address of afterAddresses) {
      expect(address.coordinateVersion).toBe(1);
      expect(address.canonicalPolicyId).toBe('single-sig-native-segwit-bip84-v1');
      expect(address.scriptPubKey).toMatch(/^[0-9a-f]+$/);
    }
    // The address strings and their user-visible paths are never rewritten.
    expect(afterAddresses.map((a) => [a.address, a.derivationPath]))
      .toEqual(legacyAddresses
        .sort((a, b) => a.index - b.index)
        .map((a) => [a.address, a.derivationPath]));

    // The loop is closed: the ownership proof that gates deposit addresses now passes.
    await expect(assertCanonicalAddressesForWallet(wallet.id, afterAddresses))
      .resolves.toBeUndefined();
  });

  it('is idempotent on a retried recovery approval and never writes twice', async () => {
    // Approval is intentionally idempotent: a retried request returns the applied view
    // rather than re-writing. That matters here because the policy columns are frozen by
    // trigger the moment they are set, so a second write would not merely be redundant --
    // it would abort the transaction.
    const { user, wallet } = await createLegacyNullWallet(prisma);
    const proposal = await createWalletRemediationProposal(wallet.id, {
      userId: user.id, username: user.username,
    });
    const first = await approveWalletRemediationProposal(
      wallet.id, proposal.proposalId, proposal.proposalDigest,
      { userId: user.id, username: user.username },
    );
    const afterFirst = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });

    const second = await approveWalletRemediationProposal(
      wallet.id, proposal.proposalId, proposal.proposalDigest,
      { userId: user.id, username: user.username },
    );

    expect(second.state).toBe('applied');
    expect(second.appliedAt).toEqual(first.appliedAt);
    await expect(prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } }))
      .resolves.toEqual(afterFirst);
    // Exactly one applied event: the retry appended no new evidence.
    await expect(prisma.walletRemediationEvent.findMany({
      where: { proposalId: proposal.proposalId, kind: 'approved_applied' },
    })).resolves.toHaveLength(1);
  });

  it('rejects recovered provenance that claims a source change descriptor', async () => {
    // The CHECK constraint is what makes the provenance claim honest rather than a
    // convention the application could drift away from.
    const { wallet } = await createLegacyNullWallet(prisma);

    await expect(prisma.$executeRawUnsafe(`
      UPDATE "wallets" SET
        "descriptorPolicyVersion" = 1,
        "descriptorSourceKind" = 'recovered_legacy',
        "changeDescriptor" = '${AUDIT_FIXTURE_CHANGE}',
        "sourceDescriptor" = '${AUDIT_FIXTURE_RECEIVE}',
        "sourceChangeDescriptor" = '${AUDIT_FIXTURE_CHANGE}'
      WHERE "id" = '${wallet.id}'
    `)).rejects.toThrow();
  });

  it('rejects recovered provenance whose source token is not the stored descriptor', async () => {
    const { wallet } = await createLegacyNullWallet(prisma);

    await expect(prisma.$executeRawUnsafe(`
      UPDATE "wallets" SET
        "descriptorPolicyVersion" = 1,
        "descriptorSourceKind" = 'recovered_legacy',
        "changeDescriptor" = '${AUDIT_FIXTURE_CHANGE}',
        "sourceDescriptor" = '${AUDIT_FIXTURE_CHANGE}'
      WHERE "id" = '${wallet.id}'
    `)).rejects.toThrow();
  });

  it('applies unique proof metadata without changing descriptors, addresses, paths, or scripts', async () => {
    const { user, wallet, account } = await createLegacyWallet(prisma);
    const before = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    const beforeAddresses = await prisma.address.findMany({ where: { walletId: wallet.id }, orderBy: { address: 'asc' } });
    const proposal = await createWalletRemediationProposal(wallet.id, {
      userId: user.id, username: user.username,
    });
    expect(proposal.eligible).toBe(true);
    expect(proposal.changes.length).toBeGreaterThan(0);

    const applied = await approveWalletRemediationProposal(
      wallet.id, proposal.proposalId, proposal.proposalDigest,
      { userId: user.id, username: user.username },
    );
    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    const afterAddresses = await prisma.address.findMany({ where: { walletId: wallet.id }, orderBy: { address: 'asc' } });
    const link = await prisma.walletDevice.findFirstOrThrow({ where: { walletId: wallet.id } });

    expect(applied.state).toBe('applied');
    expect({ descriptor: after.descriptor, changeDescriptor: after.changeDescriptor, fingerprint: after.fingerprint })
      .toEqual({ descriptor: before.descriptor, changeDescriptor: before.changeDescriptor, fingerprint: before.fingerprint });
    expect(afterAddresses.map(({ address, derivationPath, index }) => ({ address, derivationPath, index })))
      .toEqual(beforeAddresses.map(({ address, derivationPath, index }) => ({ address, derivationPath, index })));
    expect(link).toMatchObject({ deviceAccountId: account.id, signerIndex: 0, signerBindingVersion: 1 });
    await expect(prisma.walletRemediationEvent.findMany({ where: { proposalId: proposal.proposalId } }))
      .resolves.toEqual([expect.objectContaining({ kind: 'approved_applied' })]);
  });

  it('rolls back every active metadata write on failure and appends redacted failure evidence', async () => {
    const { user, wallet } = await createLegacyWallet(prisma);
    const proposal = await createWalletRemediationProposal(wallet.id, {
      userId: user.id, username: user.username,
    });
    await installFailure(prisma, wallet.id);

    await expect(approveWalletRemediationProposal(
      wallet.id, proposal.proposalId, proposal.proposalDigest,
      { userId: user.id, username: user.username },
    )).rejects.toThrow('forced remediation metadata failure');

    await expect(prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).resolves.toMatchObject({
      descriptorPolicyVersion: 1, canonicalPolicyId: null, canonicalPolicyVersion: null,
    });
    await expect(prisma.walletDevice.findFirstOrThrow({ where: { walletId: wallet.id } })).resolves.toMatchObject({
      deviceAccountId: null, signerBindingVersion: null,
    });
    await expect(prisma.address.findMany({ where: { walletId: wallet.id } })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ branch: null, coordinateVersion: null, scriptPubKey: null })]),
    );
    await expect(prisma.walletRemediationEvent.findMany({ where: { proposalId: proposal.proposalId } }))
      .resolves.toEqual([expect.objectContaining({
        kind: 'failed', details: { reasonCode: 'approval_rejected' },
      })]);
  });

  it('cancels one attempt without changing metadata, then permits a new exact attempt', async () => {
    const { user, wallet } = await createLegacyWallet(prisma);
    const actor = { userId: user.id, username: user.username };
    const proposal = await createWalletRemediationProposal(wallet.id, actor);
    const cancelled = await cancelWalletRemediationProposal(
      wallet.id, proposal.proposalId, proposal.proposalDigest, actor,
    );

    expect(cancelled.state).toBe('cancelled');
    await expect(approveWalletRemediationProposal(
      wallet.id, proposal.proposalId, proposal.proposalDigest, actor,
    )).rejects.toThrow('blocked');
    await expect(prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).resolves.toMatchObject({
      descriptorPolicyVersion: 1, canonicalPolicyId: null, canonicalPolicyVersion: null,
    });
    await expect(prisma.walletRemediationEvent.findMany({ where: { proposalId: proposal.proposalId } }))
      .resolves.toEqual([expect.objectContaining({ kind: 'cancelled' })]);

    const retry = await createWalletRemediationProposal(wallet.id, actor);
    expect(retry.state).toBe('pending');
    expect(retry.attemptId).not.toBe(proposal.attemptId);
    expect(retry.proofDigest).toBe(proposal.proofDigest);
    expect(retry.proposalId).not.toBe(proposal.proposalId);
    await expect(approveWalletRemediationProposal(
      wallet.id, retry.proposalId, retry.proposalDigest, actor,
    )).resolves.toMatchObject({ state: 'applied' });
  });
});
