/**
 * Migration Service
 *
 * Provides schema version tracking and migration verification.
 * Queries Prisma's _prisma_migrations table for accurate version info.
 *
 * Usage:
 *   import { migrationService } from './migrationService';
 *   const version = await migrationService.getSchemaVersion();
 *   const isValid = await migrationService.verifyMigrations();
 */

import { db as prisma } from '../repositories/db';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { execSync } from 'child_process';

const log = createLogger('MIGRATION:SVC');

/**
 * Migration record from Prisma's internal tracking table
 */
interface PrismaMigration {
  id: string;
  checksum: string;
  finished_at: Date | null;
  migration_name: string;
  logs: string | null;
  rolled_back_at: Date | null;
  started_at: Date;
  applied_steps_count: number;
}

/**
 * Schema version info
 */
export interface SchemaVersionInfo {
  version: number;
  latestMigration: string | null;
  appliedAt: Date | null;
  totalMigrations: number;
  pendingMigrations: number;
}

/**
 * Expected migrations in order (update this when adding new migrations)
 * This serves as a manifest of all migrations that should exist
 */
const EXPECTED_MIGRATIONS = [
  '20251211212018_init',
  '20251213000000_add_system_settings',
  '20251213100000_add_group_role',
  '20251213200000_add_audit_log',
  '20251213210000_add_two_factor_auth',
  '20251214000000_add_utxo_frozen',
  '20251214100000_add_draft_transactions',
  '20251215120000_add_performance_indexes',
  '20251215130000_add_draft_outputs',
  '20251217000000_fix_derivation_paths',
  '20251218000000_add_mempool_estimator',
  '20251218100000_decimal_fee_rates',
  '20251219000000_add_balance_after_to_transactions',
  '20251219200000_add_pool_settings',
  '20251219210000_add_electrum_servers',
  '20251219300000_add_allow_self_signed_cert',
  '20251220000000_add_rbf_tracking',
  '20251221000000_add_token_management',
  '20251222000000_add_electrum_health_error',
  '20251224000000_add_proxy_config',
  '20251224100000_add_transaction_inputs_outputs',
  '20251225000000_add_network_to_node_config',
  '20251225090000_add_draft_inputs',
  '20251225100000_add_decoy_outputs_to_drafts',
  '20251225220000_add_payjoin_url_to_drafts',
  '20251225230000_remove_bitcoin_rpc_support',
  '20251226120000_add_verbose_capability_to_electrum_servers',
  '20251228000000_add_type_blocktime_index',
] as const;

/**
 * Get the expected schema version (number of expected migrations)
 */
export function getExpectedSchemaVersion(): number {
  return EXPECTED_MIGRATIONS.length;
}

/**
 * Migration Service
 */
class MigrationService {
  /**
   * Get all applied migrations from Prisma's tracking table
   */
  async getAppliedMigrations(): Promise<PrismaMigration[]> {
    try {
      const migrations = await prisma.$queryRaw<PrismaMigration[]>`
        SELECT * FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL
          AND rolled_back_at IS NULL
        ORDER BY finished_at ASC
      `;
      return migrations;
    } catch (error) {
      // Table might not exist if no migrations have run
      log.warn('Could not query migrations table', { error: getErrorMessage(error) });
      return [];
    }
  }

  /**
   * Get the current schema version (count of successfully applied migrations)
   */
  async getSchemaVersion(): Promise<number> {
    const migrations = await this.getAppliedMigrations();
    return migrations.length;
  }

  /**
   * Get detailed schema version info
   */
  async getSchemaVersionInfo(): Promise<SchemaVersionInfo> {
    const migrations = await this.getAppliedMigrations();
    const latestMigration = migrations.length > 0 ? migrations[migrations.length - 1] : null;

    return {
      version: migrations.length,
      latestMigration: latestMigration?.migration_name || null,
      appliedAt: latestMigration?.finished_at || null,
      totalMigrations: EXPECTED_MIGRATIONS.length,
      pendingMigrations: Math.max(0, EXPECTED_MIGRATIONS.length - migrations.length),
    };
  }

  /**
   * Verify that all expected migrations have been applied
   * Returns true if database is up to date, false otherwise
   */
  async verifyMigrations(): Promise<{
    valid: boolean;
    applied: number;
    expected: number;
    missing: string[];
  }> {
    const migrations = await this.getAppliedMigrations();
    const appliedNames = new Set(migrations.map((m) => m.migration_name));

    const missing: string[] = [];
    for (const expected of EXPECTED_MIGRATIONS) {
      if (!appliedNames.has(expected)) {
        missing.push(expected);
      }
    }

    const valid = missing.length === 0;

    if (!valid) {
      log.warn('Database migrations are not up to date', {
        applied: migrations.length,
        expected: EXPECTED_MIGRATIONS.length,
        missing,
      });
    } else {
      log.debug('Database migrations verified', {
        applied: migrations.length,
        expected: EXPECTED_MIGRATIONS.length,
      });
    }

    return {
      valid,
      applied: migrations.length,
      expected: EXPECTED_MIGRATIONS.length,
      missing,
    };
  }

  /**
   * Check if a specific migration has been applied
   */
  async isMigrationApplied(migrationName: string): Promise<boolean> {
    const migrations = await this.getAppliedMigrations();
    return migrations.some((m) => m.migration_name === migrationName);
  }

  /**
   * Run pending database migrations using Prisma migrate deploy
   * This is safe for production - it only applies pending migrations
   */
  async runMigrations(): Promise<{ success: boolean; applied: number; error?: string }> {
    try {
      const beforeInfo = await this.getSchemaVersionInfo();

      if (beforeInfo.pendingMigrations === 0) {
        log.info('No pending migrations to apply');
        return { success: true, applied: 0 };
      }

      log.info('Running database migrations...', {
        pendingMigrations: beforeInfo.pendingMigrations,
      });

      // Run prisma migrate deploy (production-safe, only applies pending migrations)
      execSync('npx prisma migrate deploy', {
        stdio: 'pipe',
        cwd: process.cwd(),
        env: process.env,
      });

      const afterInfo = await this.getSchemaVersionInfo();
      const applied = afterInfo.version - beforeInfo.version;

      log.info('Database migrations completed successfully', {
        applied,
        currentVersion: afterInfo.version,
        latestMigration: afterInfo.latestMigration,
      });

      return { success: true, applied };
    } catch (error) {
      const message = getErrorMessage(error);
      log.error('Failed to run database migrations', { error: message });
      return { success: false, applied: 0, error: message };
    }
  }

  /**
   * Log migration status at startup
   */
  async logMigrationStatus(): Promise<void> {
    const info = await this.getSchemaVersionInfo();

    if (info.pendingMigrations > 0) {
      log.warn('Database schema is behind', {
        currentVersion: info.version,
        expectedVersion: info.totalMigrations,
        pendingMigrations: info.pendingMigrations,
      });
    } else {
      log.info('Database schema is up to date', {
        version: info.version,
        latestMigration: info.latestMigration,
      });
    }
  }
}

// Export singleton instance
export const migrationService = new MigrationService();
