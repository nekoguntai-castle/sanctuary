#!/usr/bin/env ts-node
/**
 * Check Prisma Imports Script
 *
 * Enforces the repository pattern by checking that direct Prisma imports
 * only occur in allowed locations.
 *
 * ## Usage
 *
 * ```bash
 * npx ts-node scripts/check-prisma-imports.ts
 * # or
 * npm run check:prisma-imports
 * ```
 *
 * ## Allowed Locations
 *
 * - src/models/prisma.ts - Prisma client initialization
 * - src/repositories/** - Repository implementations
 * - src/errors/** - Error handling (needs Prisma types)
 * - src/utils/errors.ts - Error utilities (needs Prisma types)
 * - src/utils/serialization.ts - Serialization (needs Prisma types)
 * - src/services/authorization/** - Authorization service (queries user/roles)
 * - Explicit infrastructure exceptions in ALLOWED_DIRECT_PRISMA_IMPORTS
 *
 * ## Why Repository Pattern?
 *
 * 1. Centralized query logic - easier to optimize
 * 2. Better testability - mock repositories, not Prisma
 * 3. Type safety - repositories define clear interfaces
 * 4. Change isolation - database changes stay in one place
 */

import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Configuration
// =============================================================================

const SRC_DIR = path.join(__dirname, '..', 'src');

/**
 * Patterns for files that are ALLOWED to import Prisma directly
 */
export const ALLOWED_PATTERNS = [
  // Prisma client initialization
  /^src\/models\/prisma\.ts$/,

  // Repository implementations
  /^src\/repositories\//,

  // Error handling needs Prisma types
  /^src\/errors\//,
  /^src\/utils\/errors\.ts$/,

  // Serialization needs Prisma types
  /^src\/utils\/serialization\.ts$/,

  // Authorization service queries database directly (by design)
  /^src\/services\/authorization\//,

  // Scripts are allowed (not production code)
  /^src\/scripts\//,
];

/**
 * Exact production-code exceptions for runtime Prisma access outside repositories.
 *
 * Keep this list small and tied to infrastructure boundaries that are awkward or
 * misleading to model as normal repositories.
 */
export const ALLOWED_DIRECT_PRISMA_IMPORTS: Record<string, string> = {
  'src/index.ts': 'API process database lifecycle and health-check startup',
  'src/worker.ts': 'Worker process database lifecycle',
  'src/api/health/systemChecks.ts': 'System health diagnostics',
  'src/jobs/definitions/maintenance.ts': 'Worker-owned maintenance job definitions',
  'src/services/backupService/creation.ts': 'Whole-database backup workflow',
  'src/services/backupService/restore.ts': 'Whole-database restore workflow',
  'src/services/migrationService.ts': 'Database migration inspection and execution',
  'src/services/walletImport/walletImportService.ts': 'Atomic wallet import transaction boundary',
  'src/services/bitcoin/transactions/persistTransaction.ts': 'Atomic transaction persistence boundary',
};

/**
 * Pattern that matches runtime imports or re-exports from the Prisma singleton module.
 * Type-only imports and exports are allowed because they do not bypass the
 * repository runtime boundary.
 */
export const RUNTIME_PRISMA_IMPORT_PATTERN = /^\s*(?:import|export)\s+(?!type\b).*?\sfrom\s+['"](?:\.\.?\/)+models\/prisma['"];?(?:\s*\/\/.*)?\s*$/;
export const RUNTIME_PRISMA_DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*['"](?:\.\.?\/)+models\/prisma['"]\s*\)/;

// =============================================================================
// File Scanning
// =============================================================================

export interface Violation {
  file: string;
  line: number;
  content: string;
}

export function getAllowedReason(relativePath: string): string | null {
  if (ALLOWED_DIRECT_PRISMA_IMPORTS[relativePath]) {
    return ALLOWED_DIRECT_PRISMA_IMPORTS[relativePath];
  }

  const pattern = ALLOWED_PATTERNS.find(pattern => pattern.test(relativePath));
  return pattern ? `matches ${pattern}` : null;
}

export function isAllowedFile(relativePath: string): boolean {
  return getAllowedReason(relativePath) !== null;
}

export function scanContent(content: string, filePath: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    if (RUNTIME_PRISMA_IMPORT_PATTERN.test(line) || RUNTIME_PRISMA_DYNAMIC_IMPORT_PATTERN.test(line)) {
      violations.push({
        file: filePath,
        line: index + 1,
        content: line.trim(),
      });
    }
  });

  return violations;
}

export function scanFile(filePath: string): Violation[] {
  return scanContent(fs.readFileSync(filePath, 'utf-8'), filePath);
}

export function walkDir(dir: string, callback: (file: string) => void): void {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      // Skip node_modules and test directories
      if (file !== 'node_modules' && file !== '__tests__') {
        walkDir(filePath, callback);
      }
    } else if (file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts')) {
      callback(filePath);
    }
  }
}

// =============================================================================
// Main
// =============================================================================

export function main(): void {
  const violations: Violation[] = [];
  const checkedFiles: string[] = [];
  const skippedFiles: string[] = [];

  console.log('Checking for direct Prisma imports...\n');

  walkDir(SRC_DIR, (filePath: string) => {
    const relativePath = path.relative(path.join(__dirname, '..'), filePath);

    if (isAllowedFile(relativePath)) {
      skippedFiles.push(relativePath);
      return;
    }

    checkedFiles.push(relativePath);
    const fileViolations = scanFile(filePath);
    violations.push(...fileViolations);
  });

  // Report results
  console.log(`Checked ${checkedFiles.length} files`);
  console.log(`Skipped ${skippedFiles.length} allowed files\n`);

  if (violations.length === 0) {
    console.log('✅ No direct Prisma import violations found!\n');
    console.log('Runtime Prisma access is limited to repositories and documented infrastructure exceptions.');
    process.exit(0);
  }

  console.log(`❌ Found ${violations.length} Prisma import violation(s):\n`);

  // Group by file
  const byFile = new Map<string, Violation[]>();
  for (const v of violations) {
    const relativePath = path.relative(path.join(__dirname, '..'), v.file);
    if (!byFile.has(relativePath)) {
      byFile.set(relativePath, []);
    }
    byFile.get(relativePath)!.push(v);
  }

  for (const [file, fileViolations] of byFile) {
    console.log(`${file}:`);
    for (const v of fileViolations) {
      console.log(`  Line ${v.line}: ${v.content}`);
    }
    console.log();
  }

  console.log('How to fix:');
  console.log('1. Create or use an existing repository in src/repositories/');
  console.log('2. Add the query method to the repository');
  console.log('3. Import and use the repository instead of prisma directly');
  console.log('4. If this is a legitimate infrastructure exception, add an exact entry to ALLOWED_DIRECT_PRISMA_IMPORTS\n');

  // Exit with error code
  process.exit(1);
}

if (require.main === module) {
  main();
}
