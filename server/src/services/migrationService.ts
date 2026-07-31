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

import prisma from '../models/prisma';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { execSync } from 'child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

const DEFAULT_MIGRATIONS_DIRECTORY = resolve(process.cwd(), 'prisma/migrations');

/**
 * Load the migration manifest shipped in the runtime image.
 *
 * Prisma treats every directory containing migration.sql as a migration,
 * including legacy names that do not use the timestamp convention. A missing,
 * malformed, or empty manifest is unsafe because it could make an out-of-date
 * database appear current, so those states deliberately throw.
 */
export function loadPackagedMigrationNames(
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY
): string[] {
  let entries;
  try {
    entries = readdirSync(migrationsDirectory, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `Could not read packaged migration manifest: ${getErrorMessage(error)}`
    );
  }

  const directories = entries.filter((entry) => entry.isDirectory());
  for (const directory of directories) {
    const migrationFile = join(migrationsDirectory, directory.name, 'migration.sql');
    if (!statSync(migrationFile).isFile()) {
      throw new Error(`${directory.name}/migration.sql is not a file`);
    }
  }

  const migrationNames = directories.map((directory) => directory.name).sort();
  if (migrationNames.length === 0) {
    throw new Error('packaged migration manifest is empty');
  }

  return migrationNames;
}

/**
 * Get the expected schema version (number of expected migrations)
 */
export function getExpectedSchemaVersion(): number {
  return loadPackagedMigrationNames().length;
}

function isSuccessfulMigration(migration: PrismaMigration): boolean {
  return migration.finished_at !== null && migration.rolled_back_at === null;
}

function findMissingMigrations(
  expectedMigrations: string[],
  appliedMigrations: PrismaMigration[]
): string[] {
  const appliedNames = new Set(
    appliedMigrations.map((migration) => migration.migration_name)
  );
  return expectedMigrations.filter((migration) => !appliedNames.has(migration));
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
        ORDER BY started_at ASC
      `;
      return migrations.filter(isSuccessfulMigration);
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
    const expectedMigrations = loadPackagedMigrationNames();
    const migrations = await this.getAppliedMigrations();
    const latestMigration = migrations.length > 0 ? migrations[migrations.length - 1] : null;
    const missingMigrations = findMissingMigrations(expectedMigrations, migrations);

    return {
      version: migrations.length,
      latestMigration: latestMigration?.migration_name || null,
      appliedAt: latestMigration?.finished_at || null,
      totalMigrations: expectedMigrations.length,
      pendingMigrations: missingMigrations.length,
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
    const expectedMigrations = loadPackagedMigrationNames();
    const migrations = await this.getAppliedMigrations();
    const missing = findMissingMigrations(expectedMigrations, migrations);
    const valid = missing.length === 0;

    if (!valid) {
      log.warn('Database migrations are not up to date', {
        applied: migrations.length,
        expected: expectedMigrations.length,
        missing,
      });
    } else {
      log.debug('Database migrations verified', {
        applied: migrations.length,
        expected: expectedMigrations.length,
      });
    }

    return {
      valid,
      applied: migrations.length,
      expected: expectedMigrations.length,
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
      if (afterInfo.pendingMigrations > 0) {
        throw new Error(
          `${afterInfo.pendingMigrations} packaged migration(s) still missing after deploy`
        );
      }
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
