import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

const vitestConfigPath = path.join(projectRoot, 'vitest.config.ts');
const animatedBackgroundTestPath = path.join(projectRoot, 'tests/components/AnimatedBackground.test.tsx');

const EXPECTED_FRONTEND_COVERAGE_EXCLUDES = [
  '**/*.test.{ts,tsx}',
  '**/tests/**',
  '**/__tests__/**',
  '**/*.d.ts',
  '**/coverage/**',
  '**/dist/**',
  '**/node_modules/**',
  'components/animations/**',
  'src/types/**/*.ts',
  'shared/types/**/*.ts',
];

function readCoverageExcludesFromConfig(): string[] {
  const source = fs.readFileSync(vitestConfigPath, 'utf8');
  const excludeBlockMatch = source.match(/exclude:\s*\[([\s\S]*?)\][\s\S]*?reportsDirectory:/m);

  if (!excludeBlockMatch) {
    throw new Error('Unable to locate coverage.exclude block in vitest.config.ts');
  }

  return Array.from(excludeBlockMatch[1].matchAll(/'([^']+)'/g), match => match[1]);
}

describe('frontend coverage policy', () => {
  it('keeps the explicit allow-list of excluded globs', () => {
    expect(readCoverageExcludesFromConfig()).toEqual(EXPECTED_FRONTEND_COVERAGE_EXCLUDES);
  });

  it('only excludes animation internals and type-only files from product code', () => {
    const sourcePathExcludes = readCoverageExcludesFromConfig().filter(pattern => !pattern.startsWith('**/'));

    expect(sourcePathExcludes).toEqual([
      'components/animations/**',
      'src/types/**/*.ts',
      'shared/types/**/*.ts',
    ]);
  });

  it('retains animation registry coverage through AnimatedBackground tests', () => {
    const animationTestSource = fs.readFileSync(animatedBackgroundTestPath, 'utf8');

    expect(animationTestSource).toContain("vi.mock('../../components/animations'");
    expect(animationTestSource).toContain('Pattern Registry Consistency');
  });
});
