/**
 * Backup Migration
 *
 * Applies schema migrations to upgrade backups from older schema versions
 * to the current version.
 */

import { createLogger } from '../../utils/logger';
import { MIGRATIONS } from './constants';
import type { SanctuaryBackup } from './types';

const log = createLogger('BACKUP');

/**
 * Apply migrations to upgrade backup to current schema version
 */
export function migrateBackup(backup: SanctuaryBackup, targetVersion: number): SanctuaryBackup {
  let current = { ...backup, data: { ...backup.data } };
  const startVersion = backup.meta.schemaVersion;

  for (const migration of MIGRATIONS) {
    if (startVersion < migration.toVersion && current.meta.schemaVersion < migration.toVersion) {
      log.debug(`[BACKUP] Applying migration ${migration.fromVersion} -> ${migration.toVersion}`);
      current = migration.migrate(current);
      current.meta.schemaVersion = migration.toVersion;
    }
  }

  // Update to target version even if no migrations defined
  // (schema may have changed without needing data transformation)
  current.meta.schemaVersion = targetVersion;

  return current;
}
