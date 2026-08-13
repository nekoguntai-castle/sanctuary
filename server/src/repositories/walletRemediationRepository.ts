import { Prisma, type WalletRemediationEvent, type WalletRemediationProposal } from '../generated/prisma/client';
import prisma, { type PrismaTxClient } from '../models/prisma';
import type {
  RemediationChange,
  WalletRemediationActor,
  WalletRemediationDocument,
  WalletRemediationSnapshot,
} from '../services/walletRemediation/types';
import { remediationDigest } from '../utils/walletRemediationCanonicalDocument';
import { NotFoundError } from '../errors';

const REMEDIATION_PATCH_FIELDS = {
  wallet_policy: new Set([
    'descriptorPolicyVersion', 'descriptorSourceKind', 'sourceDescriptorChecksum',
    'sourceChangeDescriptorChecksum', 'canonicalPolicyId', 'canonicalPolicyVersion',
  ]),
  signer_binding: new Set([
    'deviceAccountId', 'signerIndex', 'signerBindingVersion', 'signerFingerprint',
    'signerXpub', 'signerDerivationPath', 'signerPurpose', 'signerScriptType',
  ]),
  address_coordinate: new Set([
    'branch', 'coordinateVersion', 'canonicalPolicyId', 'canonicalPolicyVersion', 'scriptPubKey',
  ]),
} as const;

function assertExactPatch(change: RemediationChange): void {
  const keys = Object.keys(change.proposed);
  const allowed = REMEDIATION_PATCH_FIELDS[change.kind];
  if (keys.length === 0 || keys.some((key) => !allowed.has(key as never))) {
    throw new Error(`Unsafe remediation patch for ${change.recordId}`);
  }
}

export async function loadSnapshot(
  walletId: string,
  tx: PrismaTxClient = prisma,
): Promise<WalletRemediationSnapshot | null> {
  const wallets = await tx.$queryRaw<WalletRemediationSnapshot['wallet'][]>(Prisma.sql`
    SELECT "id", "type", "scriptType", "network", "quorum", "totalSigners",
      "descriptor", "changeDescriptor", "descriptorPolicyVersion", "descriptorSourceKind",
      "sourceDescriptor", "sourceChangeDescriptor", "sourceDescriptorChecksum",
      "sourceChangeDescriptorChecksum", "fingerprint", "canonicalPolicyId", "canonicalPolicyVersion"
    FROM "wallets" WHERE "id" = ${walletId}
  `);
  const wallet = wallets[0];
  if (!wallet) return null;
  const signers = await tx.$queryRaw<WalletRemediationSnapshot['signers']>(Prisma.sql`
    SELECT wd."id", wd."walletId", wd."deviceId", wd."deviceAccountId",
      wd."signerIndex", wd."signerBindingVersion", wd."signerFingerprint",
      wd."signerXpub", wd."signerDerivationPath", wd."signerPurpose", wd."signerScriptType",
      d."fingerprint" AS "deviceFingerprint", da."id" AS "accountId",
      da."purpose" AS "accountPurpose", da."scriptType" AS "accountScriptType",
      da."derivationPath" AS "accountDerivationPath", da."xpub" AS "accountXpub"
    FROM "wallet_devices" wd
    INNER JOIN "devices" d ON d."id" = wd."deviceId"
    LEFT JOIN "device_accounts" da ON da."deviceId" = wd."deviceId"
    WHERE wd."walletId" = ${walletId}
    ORDER BY wd."id" ASC, da."derivationPath" ASC, da."id" ASC
  `);
  const addresses = await tx.$queryRaw<WalletRemediationSnapshot['addresses']>(Prisma.sql`
    SELECT "id", "walletId", "address", "derivationPath", "index", "branch",
      "coordinateVersion", "canonicalPolicyId", "canonicalPolicyVersion", "scriptPubKey"
    FROM "addresses" WHERE "walletId" = ${walletId} ORDER BY "id" ASC
  `);
  const owners = await tx.$queryRaw<Array<{ userId: string }>>(Prisma.sql`
    SELECT wu."userId" FROM "wallet_users" wu
    WHERE wu."walletId" = ${walletId} AND wu."role" = 'owner'
    UNION
    SELECT gm."userId" FROM "wallets" w
    INNER JOIN "group_members" gm ON gm."groupId" = w."groupId"
    WHERE w."id" = ${walletId} AND w."groupRole" = 'owner'
    ORDER BY 1 ASC
  `);
  return { wallet, signers, addresses, ownerUserIds: owners.map(({ userId }) => userId) };
}

export async function createProposal(input: {
  id: string;
  digest: string;
  document: WalletRemediationDocument;
  actor: WalletRemediationActor;
}): Promise<WalletRemediationProposal> {
  try {
    return await prisma.walletRemediationProposal.create({
      data: {
        id: input.id,
        walletId: input.document.walletId,
        schemaVersion: input.document.schemaVersion,
        proposalDigest: input.digest,
        document: input.document as unknown as Prisma.InputJsonValue,
        createdByUserId: input.actor.userId,
        createdByUsername: input.actor.username,
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    const existing = await findExactProposal(input.document.walletId, input.id, input.digest);
    if (!existing || remediationDigest(existing.document) !== input.digest) throw error;
    return existing;
  }
}

export async function findExactProposal(
  walletId: string,
  proposalId: string,
  proposalDigest: string,
): Promise<(WalletRemediationProposal & { events: WalletRemediationEvent[] }) | null> {
  return prisma.walletRemediationProposal.findFirst({
    where: { walletId, id: proposalId, proposalDigest },
    include: { events: { orderBy: { sequence: 'asc' } } },
  });
}

export function withSerializableTransaction<T>(
  callback: (tx: PrismaTxClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(callback, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 300_000,
  });
}

export async function lockApprovalGraph(
  tx: PrismaTxClient,
  walletId: string,
  proposalId: string,
  proposalDigest: string,
): Promise<WalletRemediationProposal & { events: WalletRemediationEvent[] }> {
  const proposals = await tx.$queryRaw<WalletRemediationProposal[]>(Prisma.sql`
    SELECT * FROM "wallet_remediation_proposals"
    WHERE "id" = ${proposalId} AND "walletId" = ${walletId}
      AND "proposalDigest" = ${proposalDigest} FOR UPDATE
  `);
  if (proposals.length !== 1) throw new NotFoundError('Remediation proposal not found');
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "wallets" WHERE "id" = ${walletId} FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "wallet_users" WHERE "walletId" = ${walletId} ORDER BY "id" FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`
    SELECT gm."id" FROM "wallets" w INNER JOIN "group_members" gm ON gm."groupId" = w."groupId"
    WHERE w."id" = ${walletId} ORDER BY gm."id" FOR UPDATE OF gm
  `);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "wallet_devices" WHERE "walletId" = ${walletId} ORDER BY "id" FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`
    SELECT d."id" FROM "devices" d INNER JOIN "wallet_devices" wd ON wd."deviceId" = d."id"
    WHERE wd."walletId" = ${walletId} ORDER BY d."id" FOR UPDATE OF d
  `);
  await tx.$queryRaw(Prisma.sql`
    SELECT da."id" FROM "device_accounts" da INNER JOIN "wallet_devices" wd ON wd."deviceId" = da."deviceId"
    WHERE wd."walletId" = ${walletId} ORDER BY da."deviceId", da."derivationPath", da."id" FOR UPDATE OF da
  `);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "addresses" WHERE "walletId" = ${walletId} ORDER BY "id" FOR UPDATE`);
  const events = await tx.walletRemediationEvent.findMany({ where: { proposalId }, orderBy: { sequence: 'asc' } });
  return { ...proposals[0], events };
}

export async function applyChanges(
  tx: PrismaTxClient,
  walletId: string,
  changes: readonly RemediationChange[],
): Promise<void> {
  for (const change of changes) {
    assertExactPatch(change);
    const result = change.kind === 'wallet_policy'
      ? await tx.wallet.updateMany({ where: { id: walletId }, data: change.proposed })
      : change.kind === 'signer_binding'
        ? await tx.walletDevice.updateMany({ where: { id: change.recordId, walletId }, data: change.proposed })
        : await tx.address.updateMany({ where: { id: change.recordId, walletId }, data: change.proposed });
    /* v8 ignore next -- focused tests exercise both exact-one success and non-one rollback outcomes */
    if (result.count === 1) continue;
    throw new Error(`Remediation write count mismatch for ${change.recordId}`);
  }
}

export async function appendEvent(
  tx: PrismaTxClient,
  input: {
    proposalId: string;
    proposalDigest: string;
    kind: 'approved_applied' | 'cancelled' | 'failed';
    actor: WalletRemediationActor;
    details: Record<string, string | number>;
  },
): Promise<WalletRemediationEvent> {
  const previous = await tx.walletRemediationEvent.findFirst({ where: { proposalId: input.proposalId }, orderBy: { sequence: 'desc' } });
  const sequence = (previous?.sequence ?? 0) + 1;
  const eventDigest = remediationDigest({
    proposalId: input.proposalId,
    proposalDigest: input.proposalDigest,
    sequence,
    kind: input.kind,
    actorUserId: input.actor.userId,
    actorUsername: input.actor.username,
    details: input.details,
    previousEventDigest: previous?.eventDigest ?? null,
  });
  return tx.walletRemediationEvent.create({
    data: {
      proposalId: input.proposalId,
      sequence,
      proposalDigest: input.proposalDigest,
      kind: input.kind,
      actorUserId: input.actor.userId,
      actorUsername: input.actor.username,
      details: input.details,
      previousEventDigest: previous?.eventDigest ?? null,
      eventDigest,
    },
  });
}

export const walletRemediationRepository = {
  loadSnapshot,
  createProposal,
  findExactProposal,
  withSerializableTransaction,
  lockApprovalGraph,
  applyChanges,
  appendEvent,
};

export default walletRemediationRepository;
