import prisma from '../models/prisma';
import {
  walletSafetyRawSnapshotSchema,
  type RawAuditAddress,
  type RawAuditSigner,
  type RawAuditWallet,
  type WalletSafetyRawSnapshot,
} from '../validation/walletSafetyAudit';

export interface RawAuditTransaction {
  $executeRawUnsafe(query: string): Promise<number>;
  $queryRawUnsafe<T>(query: string): Promise<T>;
}

export interface RawAuditDatabaseClient {
  $transaction<T>(
    callback: (transaction: RawAuditTransaction) => Promise<T>,
    options: { isolationLevel: 'RepeatableRead'; maxWait: number; timeout: number },
  ): Promise<T>;
}

const WALLET_SNAPSHOT_SQL = `
  SELECT
    "id",
    "type",
    "scriptType",
    "network",
    "quorum",
    "totalSigners",
    "descriptor",
    "changeDescriptor",
    "descriptorPolicyVersion",
    "descriptorSourceKind",
    "sourceDescriptor",
    "sourceChangeDescriptor",
    "sourceDescriptorChecksum",
    "sourceChangeDescriptorChecksum",
    "fingerprint",
    "canonicalPolicyId",
    "canonicalPolicyVersion"
  FROM "wallets"
  ORDER BY "id" ASC
`;

const ADDRESS_SNAPSHOT_SQL = `
  SELECT
    "id",
    "walletId",
    "address",
    "derivationPath",
    "index",
    "branch",
    "coordinateVersion",
    "canonicalPolicyId",
    "canonicalPolicyVersion",
    "scriptPubKey"
  FROM "addresses"
  ORDER BY "walletId" ASC, "index" ASC, "derivationPath" ASC, "id" ASC
`;

const SIGNER_SNAPSHOT_SQL = `
  SELECT
    wd."id",
    wd."walletId",
    wd."deviceId",
    wd."deviceAccountId",
    wd."signerIndex",
    wd."signerBindingVersion",
    wd."signerFingerprint",
    wd."signerXpub",
    wd."signerDerivationPath",
    wd."signerPurpose",
    wd."signerScriptType",
    d."type" AS "deviceType",
    d."fingerprint" AS "deviceFingerprint",
    d."derivationPath" AS "deviceDerivationPath",
    d."xpub" AS "deviceXpub",
    da."purpose" AS "accountPurpose",
    da."scriptType" AS "accountScriptType",
    da."derivationPath" AS "accountDerivationPath",
    da."xpub" AS "accountXpub"
  FROM "wallet_devices" wd
  INNER JOIN "devices" d ON d."id" = wd."deviceId"
  LEFT JOIN "device_accounts" da
    ON da."id" = wd."deviceAccountId"
   AND da."deviceId" = wd."deviceId"
  ORDER BY wd."walletId" ASC, wd."signerIndex" ASC NULLS LAST, wd."id" ASC
`;

async function readSnapshot(transaction: RawAuditTransaction): Promise<WalletSafetyRawSnapshot> {
  const wallets = await transaction.$queryRawUnsafe<RawAuditWallet[]>(WALLET_SNAPSHOT_SQL);
  const addresses = await transaction.$queryRawUnsafe<RawAuditAddress[]>(ADDRESS_SNAPSHOT_SQL);
  const signers = await transaction.$queryRawUnsafe<RawAuditSigner[]>(SIGNER_SNAPSHOT_SQL);
  return walletSafetyRawSnapshotSchema.parse({ wallets, addresses, signers });
}

export async function withWalletSafetyReadOnlyTransaction<T>(
  client: RawAuditDatabaseClient,
  callback: (transaction: RawAuditTransaction) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return callback(transaction);
  }, {
    isolationLevel: 'RepeatableRead',
    maxWait: 10_000,
    timeout: 300_000,
  });
}

export async function loadWalletSafetyRawSnapshot(
  client: RawAuditDatabaseClient = prisma as unknown as RawAuditDatabaseClient,
): Promise<WalletSafetyRawSnapshot> {
  return withWalletSafetyReadOnlyTransaction(client, readSnapshot);
}

export const walletSafetyAuditSql = Object.freeze({
  wallets: WALLET_SNAPSHOT_SQL,
  addresses: ADDRESS_SNAPSHOT_SQL,
  signers: SIGNER_SNAPSHOT_SQL,
});
