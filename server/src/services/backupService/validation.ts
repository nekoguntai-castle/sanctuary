/**
 * Backup Validation
 *
 * Validates backup structure, schema version, and referential integrity
 * before restore.
 */

import { migrationService } from '../migrationService';
import {
  BACKUP_FORMAT_VERSION,
  COMPLETE_TABLE_POLICY_HASH,
  COMPLETE_TABLE_POLICY_VERSION,
  PRE_SIGNING_INTENT_COMPLETE_TABLE_POLICY_HASH,
  PRE_WALLET_SYNC_COMPLETE_TABLE_POLICY_HASH,
  PRE_REMEDIATION_COMPLETE_TABLE_POLICY_HASH,
  getRequiredRestoreTables,
  LEGACY_BACKUP_FORMAT_VERSION,
  PRE_TOMBSTONE_COMPLETE_TABLE_POLICY_HASH,
  PREVIOUS_COMPLETE_TABLE_POLICY_HASH,
  TABLE_ORDER,
} from './constants';
import type { BackupRecord, BackupMeta, ValidationResult } from './types';
import {
  descriptorPolicyFingerprint,
  prepareDescriptorPolicy,
  prepareRecoveredLegacyDescriptorPolicy,
} from '../wallet/descriptorPolicy';
import { parseDescriptorForImport } from '../bitcoin/descriptorParser';
import { isBitcoinNetwork } from '../bitcoin/networks';
import { getErrorMessage } from '../../utils/errors';
import { validateRemediationEvidenceForRestore } from './remediationEvidenceValidation';

const DESCRIPTOR_POLICY_FIELDS = [
  'changeDescriptor',
  'descriptorSourceKind',
  'sourceDescriptor',
  'sourceChangeDescriptor',
  'sourceDescriptorChecksum',
  'sourceChangeDescriptorChecksum',
] as const;

const descriptorNetworkMatchesWallet = (
  descriptorNetwork: ReturnType<typeof parseDescriptorForImport>['network'],
  walletNetwork: unknown,
): boolean => (
  typeof walletNetwork === 'string'
  && isBitcoinNetwork(walletNetwork)
  && (descriptorNetwork === 'mainnet') === (walletNetwork === 'mainnet')
);

const descriptorMetadataMatchesWallet = (
  descriptor: string,
  wallet: BackupRecord,
): boolean => {
  const parsed = parseDescriptorForImport(descriptor);
  return (
    parsed.type === wallet.type
    && parsed.scriptType === wallet.scriptType
    && descriptorNetworkMatchesWallet(parsed.network, wallet.network)
    && (parsed.quorum ?? null) === (wallet.quorum ?? null)
    && (parsed.totalSigners ?? null) === (wallet.totalSigners ?? null)
  );
};

interface CompleteVersionedWalletPolicy extends BackupRecord {
  descriptor: string;
  fingerprint: string;
  changeDescriptor: string;
  sourceDescriptor: string;
  descriptorSourceKind: string;
}

const isCompleteVersionedWalletPolicy = (
  wallet: BackupRecord,
): wallet is CompleteVersionedWalletPolicy => (
  typeof wallet.descriptor === 'string'
  && typeof wallet.fingerprint === 'string'
  && typeof wallet.changeDescriptor === 'string'
  && typeof wallet.sourceDescriptor === 'string'
  && typeof wallet.descriptorSourceKind === 'string'
);

const hasPartialDescriptorPolicy = (wallet: BackupRecord): boolean =>
  DESCRIPTOR_POLICY_FIELDS.some(
    (field) => wallet[field] !== null && wallet[field] !== undefined,
  );

const validateLegacyDescriptorPolicy = (
  wallet: BackupRecord,
  walletId: string,
): { issue?: string; hasDescriptor: boolean } => {
  if (hasPartialDescriptorPolicy(wallet)) {
    return {
      issue: `Wallet ${walletId} has descriptor policy fields without a policy version`,
      hasDescriptor: false,
    };
  }
  return {
    hasDescriptor: wallet.descriptor !== null && wallet.descriptor !== undefined,
  };
};

const preparedPolicyMatchesWallet = (
  prepared: ReturnType<typeof prepareDescriptorPolicy>
    | ReturnType<typeof prepareRecoveredLegacyDescriptorPolicy>,
  wallet: CompleteVersionedWalletPolicy,
): boolean => (
  prepared.descriptor === wallet.descriptor
  && prepared.changeDescriptor === wallet.changeDescriptor
  && descriptorPolicyFingerprint(prepared.descriptor) === wallet.fingerprint
  && prepared.descriptorSourceKind === wallet.descriptorSourceKind
  && prepared.sourceDescriptor === wallet.sourceDescriptor
  && prepared.sourceChangeDescriptor === (wallet.sourceChangeDescriptor ?? null)
  && prepared.sourceDescriptorChecksum === (wallet.sourceDescriptorChecksum ?? null)
  && prepared.sourceChangeDescriptorChecksum === (wallet.sourceChangeDescriptorChecksum ?? null)
  && descriptorMetadataMatchesWallet(prepared.descriptor, wallet)
);

const validateVersionedDescriptorPolicy = (
  wallet: BackupRecord,
  walletId: string,
): string | undefined => {
  if (wallet.descriptorPolicyVersion !== 1) {
    return `Wallet ${walletId} uses unsupported descriptor policy version ${String(wallet.descriptorPolicyVersion)}`;
  }
  if (!isCompleteVersionedWalletPolicy(wallet)) {
    return `Wallet ${walletId} has an incomplete versioned descriptor policy`;
  }
  try {
    const sourceKind = wallet.descriptorSourceKind;
    // Each provenance kind is rebuilt by the code that produced it. Falling back to
    // 'imported' for an unrecognised kind is not a safe default here: a recovered wallet
    // has no source change descriptor, so it would route into multipath expansion, throw
    // on its fixed-branch token, and block the restore of an otherwise valid backup.
    const prepared = sourceKind === 'recovered_legacy'
      ? prepareRecoveredLegacyDescriptorPolicy(wallet.sourceDescriptor)
      : prepareDescriptorPolicy({
        receiveDescriptor: wallet.sourceDescriptor,
        changeDescriptor: sourceKind === 'imported_multipath'
          ? undefined
          : typeof wallet.sourceChangeDescriptor === 'string'
            ? wallet.sourceChangeDescriptor
            : undefined,
        sourceKind: sourceKind === 'generated_pair' ? 'generated_pair' : 'imported',
      });
    return preparedPolicyMatchesWallet(prepared, wallet)
      ? undefined
      : `Wallet ${walletId} descriptor policy does not match its exact source evidence`;
  } catch (error) {
    return `Wallet ${walletId} has invalid descriptor policy evidence: ${getErrorMessage(error)}`;
  }
};

/**
 * Rebuilds every versioned wallet policy from its exact source evidence before
 * a restore may mutate the database. Legacy descriptors remain quarantined and
 * produce a warning; malformed versioned evidence blocks the restore.
 */
export function validateDescriptorPoliciesForRestore(
  data: Record<string, BackupRecord[]>,
): { issues: string[]; warnings: string[] } {
  const issues: string[] = [];
  let legacyWalletCount = 0;
  for (const wallet of data.wallet ?? []) {
    const walletId = typeof wallet.id === 'string' ? wallet.id : '<unknown>';
    if (wallet.descriptorPolicyVersion === null || wallet.descriptorPolicyVersion === undefined) {
      const legacy = validateLegacyDescriptorPolicy(wallet, walletId);
      if (legacy.issue) issues.push(legacy.issue);
      if (legacy.hasDescriptor) legacyWalletCount += 1;
      continue;
    }
    const issue = validateVersionedDescriptorPolicy(wallet, walletId);
    if (issue) issues.push(issue);
  }
  return {
    issues,
    warnings: legacyWalletCount > 0
      ? [`${legacyWalletCount} restored wallet(s) remain legacy-unverified and require remediation before funds-controlling use`]
      : [],
  };
}

/**
 * Validate a backup file before restore
 */
export async function validateBackup(backup: unknown): Promise<ValidationResult> {
  const issues: string[] = [];
  const warnings: string[] = [];

  // Get current schema version for comparison
  const currentSchemaVersion = await migrationService.getSchemaVersion();

  // Structure validation
  if (backup === null || backup === undefined || typeof backup !== 'object') {
    issues.push('Invalid backup format: not an object');
    return createValidationResult(false, issues, warnings);
  }

  const backupObj = backup as BackupRecord;

  if (!validateBackupStructure(backupObj, issues)) {
    return createValidationResult(false, issues, warnings);
  }

  const meta = backupObj.meta as BackupMeta;
  const data = backupObj.data as Record<string, BackupRecord[]>;
  const tables = Object.keys(data);

  validateBackupMeta(meta, currentSchemaVersion, issues, warnings);
  if (meta.version === BACKUP_FORMAT_VERSION) {
    validateRecordCounts(meta.recordCounts, data, issues);
  }
  validateRequiredTables(data, issues, warnings);
  validateUsers(data, issues);
  validateDeviceReferences(data, issues);
  validateWalletUserReferences(data, issues);
  validateSubscriptionCheckpointReferences(data, issues);

  return createValidationResult(issues.length === 0, issues, warnings, meta, tables, data);
}

/**
 * Validate a backup for destructive restore.
 *
 * Preview validation may warn about tables that were not part of an older
 * backup schema. Restore validation is stricter: if the backup claims a schema
 * version where a table is known, that table must be present and array-shaped.
 */
export async function validateBackupForRestore(backup: unknown): Promise<ValidationResult> {
  const result = await validateBackup(backup);
  if (!isBackupRecord(backup)) {
    return result;
  }

  const meta = backup.meta as BackupMeta | undefined;
  const data = backup.data as Record<string, BackupRecord[]> | undefined;
  if (!meta || !data || typeof meta.schemaVersion !== 'number') {
    return result;
  }

  const currentSchemaVersion = await migrationService.getSchemaVersion();
  const issues = [...result.issues];
  const warnings = [...result.warnings];

  if (meta.schemaVersion > currentSchemaVersion) {
    issues.push(
      `Backup schema version (${meta.schemaVersion}) is newer than current (${currentSchemaVersion}). Cannot perform destructive restore from a future schema version.`
    );
  }

  validateRestoreCompleteness(
    data,
    getRequiredRestoreTables(meta),
    issues
  );
  const descriptorPolicies = validateDescriptorPoliciesForRestore(data);
  issues.push(...descriptorPolicies.issues);
  warnings.push(...descriptorPolicies.warnings);
  issues.push(...validateRemediationEvidenceForRestore(data));

  return createValidationResult(issues.length === 0, issues, warnings, meta, Object.keys(data), data);
}

const createEmptyInfo = (): ValidationResult['info'] => ({
  createdAt: '',
  appVersion: '',
  schemaVersion: 0,
  totalRecords: 0,
  tables: [],
});

const createValidationResult = (
  valid: boolean,
  issues: string[],
  warnings: string[],
  meta?: BackupMeta,
  tables: string[] = [],
  data?: Record<string, BackupRecord[]>
): ValidationResult => {
  if (!meta || !data) {
    return {
      valid,
      issues,
      warnings,
      info: createEmptyInfo(),
    };
  }

  return {
    valid,
    issues,
    warnings,
    info: {
      createdAt: meta.createdAt || '',
      appVersion: meta.appVersion || '',
      schemaVersion: meta.schemaVersion || 0,
      totalRecords: countTotalRecords(data, tables),
      tables,
    },
  };
};

const validateBackupStructure = (backupObj: BackupRecord, issues: string[]): boolean => {
  if (!backupObj.meta) {
    issues.push('Missing meta section');
  }

  if (!backupObj.data) {
    issues.push('Missing data section');
  }

  return issues.length === 0;
};

const isBackupRecord = (backup: unknown): backup is BackupRecord =>
  backup !== null && typeof backup === 'object';

const validateBackupMeta = (
  meta: BackupMeta,
  currentSchemaVersion: number,
  issues: string[],
  warnings: string[]
): void => {
  if (!meta.version) {
    issues.push('Missing backup format version');
  } else {
    validateTablePolicy(meta, issues);
  }

  if (!meta.appVersion) {
    warnings.push('Missing app version');
  }

  validateSchemaVersion(meta, currentSchemaVersion, issues, warnings);
};

const validateTablePolicy = (meta: BackupMeta, issues: string[]): void => {
  if (meta.version === LEGACY_BACKUP_FORMAT_VERSION) {
    if (meta.tablePolicy) {
      issues.push(`Table policy is not allowed for legacy backup format ${LEGACY_BACKUP_FORMAT_VERSION}`);
    }
    return;
  }

  if (meta.version !== BACKUP_FORMAT_VERSION) {
    issues.push(`Unsupported backup format version: ${meta.version}`);
    return;
  }

  if (!meta.tablePolicy) {
    issues.push(`Missing table policy for backup format ${BACKUP_FORMAT_VERSION}`);
    return;
  }

  const { version, hash } = meta.tablePolicy;
  const recognizedHash = hash === COMPLETE_TABLE_POLICY_HASH
    || hash === PRE_WALLET_SYNC_COMPLETE_TABLE_POLICY_HASH
    || hash === PRE_REMEDIATION_COMPLETE_TABLE_POLICY_HASH
    || hash === PRE_SIGNING_INTENT_COMPLETE_TABLE_POLICY_HASH
    || hash === PRE_TOMBSTONE_COMPLETE_TABLE_POLICY_HASH
    || hash === PREVIOUS_COMPLETE_TABLE_POLICY_HASH;
  if (version !== COMPLETE_TABLE_POLICY_VERSION || !recognizedHash) {
    issues.push(`Unknown table policy: ${version}/${hash}`);
  }
};

const validateRecordCounts = (
  recordCounts: unknown,
  data: Record<string, BackupRecord[]>,
  issues: string[]
): void => {
  if (!recordCounts || typeof recordCounts !== 'object' || Array.isArray(recordCounts)) {
    issues.push('Invalid recordCounts: expected an object');
    return;
  }
  const counts = recordCounts as Record<string, unknown>;
  const tables = new Set([...Object.keys(data), ...Object.keys(counts)]);
  for (const table of tables) {
    const count = counts[table];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      issues.push(`Invalid record count for ${table}: ${String(count)}`);
      continue;
    }
    const records = data[table];
    if (!Array.isArray(records)) {
      issues.push(`Record count provided for missing or invalid table: ${table}`);
      continue;
    }
    if (count !== records.length) {
      issues.push(`Record count mismatch for ${table}: expected ${count}, found ${records.length}`);
    }
  }
};

const validateSchemaVersion = (
  meta: BackupMeta,
  currentSchemaVersion: number,
  issues: string[],
  warnings: string[]
): void => {
  if (meta.schemaVersion === undefined) {
    issues.push('Missing schema version');
    return;
  }

  if (meta.schemaVersion <= currentSchemaVersion) {
    return;
  }

  // Slightly newer versions are allowed because migrations can be consolidated during development.
  const versionDiff = meta.schemaVersion - currentSchemaVersion;
  if (versionDiff <= 10) {
    warnings.push(`Backup schema version (${meta.schemaVersion}) is newer than current (${currentSchemaVersion}). Proceeding with caution - some fields may be ignored.`);
    return;
  }

  issues.push(`Backup schema version (${meta.schemaVersion}) is too far ahead of current (${currentSchemaVersion}). Cannot restore from future version.`);
};

const validateRequiredTables = (
  data: Record<string, BackupRecord[]>,
  issues: string[],
  warnings: string[]
): void => {
  for (const table of TABLE_ORDER) {
    if (!data[table]) {
      warnings.push(`Missing table: ${table}`);
    } else if (!Array.isArray(data[table])) {
      issues.push(`Table ${table} is not an array`);
    }
  }
};

const validateUsers = (data: Record<string, BackupRecord[]>, issues: string[]): void => {
  if (data.user && Array.isArray(data.user)) {
    if (data.user.length === 0) {
      issues.push('Backup must contain at least one user');
    } else {
      const hasAdmin = data.user.some((u: BackupRecord) => u.isAdmin === true);
      if (!hasAdmin) {
        issues.push('Backup must contain at least one admin user');
      }
    }
  }
};

const validateDeviceReferences = (
  data: Record<string, BackupRecord[]>,
  issues: string[]
): void => {
  if (Array.isArray(data.user) && Array.isArray(data.device)) {
    const userIds = new Set(data.user.map((u: BackupRecord) => u.id));
    for (const device of data.device) {
      if (!userIds.has(device.userId)) {
        issues.push(`Device ${device.id} references non-existent user ${device.userId}`);
      }
    }
  }
};

const validateWalletUserReferences = (
  data: Record<string, BackupRecord[]>,
  issues: string[]
): void => {
  if (Array.isArray(data.wallet) && Array.isArray(data.walletUser) && Array.isArray(data.user)) {
    const walletIds = new Set(data.wallet.map((w: BackupRecord) => w.id));
    const userIds = new Set(data.user.map((u: BackupRecord) => u.id));
    for (const wu of data.walletUser) {
      if (!walletIds.has(wu.walletId)) {
        issues.push(`WalletUser references non-existent wallet ${wu.walletId}`);
      }
      if (!userIds.has(wu.userId)) {
        issues.push(`WalletUser references non-existent user ${wu.userId}`);
      }
    }
  }
};

const validateSubscriptionCheckpointReferences = (
  data: Record<string, BackupRecord[]>,
  issues: string[],
): void => {
  if (
    !Array.isArray(data.wallet)
    || !Array.isArray(data.address)
    || !Array.isArray(data.addressSubscriptionCheckpoint)
  ) {
    return;
  }

  const walletsById = new Map(data.wallet.map(wallet => [wallet.id, wallet]));
  const addressesById = new Map(data.address.map(address => [address.id, address]));
  for (const checkpoint of data.addressSubscriptionCheckpoint) {
    const address = addressesById.get(checkpoint.addressId);
    if (!address) {
      issues.push(
        `AddressSubscriptionCheckpoint ${String(checkpoint.addressId)} references non-existent address`,
      );
      continue;
    }
    const wallet = walletsById.get(address.walletId);
    if (!wallet) {
      issues.push(
        `AddressSubscriptionCheckpoint ${String(checkpoint.addressId)} references address with non-existent wallet ${String(address.walletId)}`,
      );
      continue;
    }
    if (checkpoint.network !== wallet.network) {
      issues.push(
        `AddressSubscriptionCheckpoint ${String(checkpoint.addressId)} network ${String(checkpoint.network)} does not match owning wallet ${String(wallet.id)} network ${String(wallet.network)}`,
      );
    }
  }
};

const validateRestoreCompleteness = (
  data: Record<string, BackupRecord[]>,
  requiredTables: string[],
  issues: string[]
): void => {
  for (const table of requiredTables) {
    if (!Object.prototype.hasOwnProperty.call(data, table)) {
      issues.push(`Missing required restore table: ${table}`);
      continue;
    }

    if (!Array.isArray(data[table])) {
      issues.push(`Required restore table ${table} must be an array`);
    }
  }
};

const countTotalRecords = (data: Record<string, BackupRecord[]>, tables: string[]): number => {
  let totalRecords = 0;
  for (const table of tables) {
    if (Array.isArray(data[table])) {
      totalRecords += data[table].length;
    }
  }

  return totalRecords;
};
