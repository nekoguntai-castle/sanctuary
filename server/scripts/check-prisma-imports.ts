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
const ALLOWED_PATTERNS = [
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
 * Patterns for Prisma imports we're looking for
 */
const PRISMA_IMPORT_PATTERNS = [
  // Direct prisma client import
  /from ['"]\.\..*models\/prisma['"]/,
  /from ['"]\.\/models\/prisma['"]/,

  // @prisma/client imports (type imports are OK in some files)
  // We allow type imports: `import type { ... } from '../src/generated/prisma/client'`
  // We disallow value imports that aren't types
];

/**
 * Pattern that matches importing the prisma singleton (not just types)
 */
const PRISMA_SINGLETON_PATTERN = /import\s+(?!type\s).*prisma.*from\s+['"]\..*models\/prisma['"]/;

// =============================================================================
// File Scanning
// =============================================================================

interface Violation {
  file: string;
  line: number;
  content: string;
}

function isAllowedFile(relativePath: string): boolean {
  return ALLOWED_PATTERNS.some(pattern => pattern.test(relativePath));
}

function scanFile(filePath: string): Violation[] {
  const violations: Violation[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    // Check for prisma singleton imports
    if (PRISMA_SINGLETON_PATTERN.test(line)) {
      violations.push({
        file: filePath,
        line: index + 1,
        content: line.trim(),
      });
    }
  });

  return violations;
}

function walkDir(dir: string, callback: (file: string) => void): void {
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

function main(): void {
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
    console.log('All database access goes through repositories as expected.');
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
  console.log('4. If this is a legitimate exception, add it to ALLOWED_PATTERNS\n');

  // Exit with error code
  process.exit(1);
}

main();
