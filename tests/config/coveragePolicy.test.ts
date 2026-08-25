import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe,expect,it } from 'vitest';
import { loadConfigFromFile } from 'vite';

import { coverageReporters } from '../../config/tooling/coverageReporters';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

const vitestConfigPath = path.join(projectRoot, 'config/tooling/vitest.config.ts');
const sharedCoverageConfigPaths = [
  vitestConfigPath,
  path.join(projectRoot, 'gateway/vitest.config.ts'),
  path.join(projectRoot, 'llm-egress-proxy/vitest.config.ts'),
];
const backendVitestConfigPath = path.join(projectRoot, 'server/vitest.config.ts');
const coverageShardConfigPath = path.join(projectRoot, 'config/tooling/vitest.coverage-shard.config.ts');
const animatedBackgroundTestPath = path.join(projectRoot, 'tests/components/AnimatedBackground.test.tsx');

const EXPECTED_FRONTEND_COVERAGE_EXCLUDES = [
  '**/*.test.{ts,tsx}',
  '**/tests/**',
  '**/__tests__/**',
  '**/*.d.ts',
  '**/coverage/**',
  '**/dist/**',
  '**/node_modules/**',
  'llm-egress-proxy/src/**',
  'src/components/animations/**',
  'src/types/ui.ts',
  'src/types/user.ts',
  'shared/types/**/*.ts',
  'server/**',
  'shared/schemas/mobileApiRequests.ts',
  'shared/utils/gatewayAuth.ts',
  'src/components/**/types.ts',
  'src/components/**/index.ts',
  'src/components/**/index.tsx',
  'src/contexts/**/index.ts',
  'src/hooks/**/types.ts',
  'src/hooks/**/index.ts',
  'src/hooks/queries/useWalletLabels.ts',
  'src/services/**/types.ts',
  'src/services/**/index.ts',
  'src/themes/types.ts',
  'src/api/**/types.ts',
  'src/api/**/index.ts',
];

function readCoverageExcludesFromConfig(): string[] {
  const source = fs.readFileSync(vitestConfigPath, 'utf8');
  const excludeBlockMatch = source.match(/exclude:\s*\[([\s\S]*?)\][\s\S]*?reportsDirectory:/m);

  if (!excludeBlockMatch) {
    throw new Error('Unable to locate coverage.exclude block in config/tooling/vitest.config.ts');
  }

  return Array.from(excludeBlockMatch[1].matchAll(/'([^']+)'/g), match => match[1]);
}

describe('frontend coverage policy', () => {
  it('keeps rich local reports while CI emits only the consumed summary', () => {
    expect(coverageReporters(false)).toEqual(['text', 'html', 'json-summary', 'lcov']);
    expect(coverageReporters(true)).toEqual(['text', 'json-summary']);
  });

  it('keeps the reporter policy consistent across every package coverage gate', () => {
    for (const configPath of sharedCoverageConfigPaths) {
      expect(fs.readFileSync(configPath, 'utf8')).toContain(
        'reporter: coverageReporters(Boolean(process.env.CI))',
      );
    }

    const backendConfigSource = fs.readFileSync(backendVitestConfigPath, 'utf8');
    expect(backendConfigSource).not.toContain("from '../config/tooling/coverageReporters'");
    expect(backendConfigSource).toContain('reporter: coverageReporters');
  });

  it('keeps the backend config loadable from a Stryker-style package sandbox', async () => {
    const sandboxRoot = fs.mkdtempSync(path.join(projectRoot, 'server', '.vitest-config-sandbox-'));
    const originalCi = process.env.CI;

    try {
      for (const testCase of [
        { ci: '', name: 'local', reporters: ['text', 'html', 'json-summary', 'lcov'] },
        { ci: 'true', name: 'ci', reporters: ['text', 'json-summary'] },
      ]) {
        process.env.CI = testCase.ci;
        const sandboxConfigPath = path.join(sandboxRoot, `vitest.${testCase.name}.config.ts`);
        fs.copyFileSync(backendVitestConfigPath, sandboxConfigPath);

        const loadedConfig = await loadConfigFromFile(
          { command: 'serve', mode: 'test' },
          sandboxConfigPath,
          sandboxRoot,
          'silent',
        );
        const loadedTestConfig = loadedConfig?.config as {
          test?: { coverage?: { reporter?: string[] } };
        };

        expect(loadedTestConfig.test?.coverage?.reporter).toEqual(testCase.reporters);
      }
    } finally {
      if (originalCi === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = originalCi;
      }
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
    }
  });

  it('keeps the explicit allow-list of excluded globs', () => {
    expect(readCoverageExcludesFromConfig()).toEqual(EXPECTED_FRONTEND_COVERAGE_EXCLUDES);
  });

  it('only excludes package-owned internals, animation internals, non-frontend contracts, type-only, and barrel-export files from product code', () => {
    const sourcePathExcludes = readCoverageExcludesFromConfig().filter(pattern => !pattern.startsWith('**/'));

    expect(sourcePathExcludes).toEqual([
      'llm-egress-proxy/src/**',
      'src/components/animations/**',
      'src/types/ui.ts',
      'src/types/user.ts',
      'shared/types/**/*.ts',
      'server/**',
      'shared/schemas/mobileApiRequests.ts',
      'shared/utils/gatewayAuth.ts',
      'src/components/**/types.ts',
      'src/components/**/index.ts',
      'src/components/**/index.tsx',
      'src/contexts/**/index.ts',
      'src/hooks/**/types.ts',
      'src/hooks/**/index.ts',
      'src/hooks/queries/useWalletLabels.ts',
      'src/services/**/types.ts',
      'src/services/**/index.ts',
      'src/themes/types.ts',
      'src/api/**/types.ts',
      'src/api/**/index.ts',
    ]);
  });

  it('retains animation registry coverage through AnimatedBackground tests', () => {
    const animationTestSource = fs.readFileSync(animatedBackgroundTestPath, 'utf8');

    expect(animationTestSource).toMatch(/vi\.mock\('\.\.\/\.\.\/src\/components\/animations\/[^']+'/);
    expect(animationTestSource).toContain('Pattern Registry Consistency');
  });

  it('gives Forgejo coverage shard fork workers enough teardown time', () => {
    const shardConfigSource = fs.readFileSync(coverageShardConfigPath, 'utf8');

    expect(shardConfigSource).toContain('teardownTimeout: 60_000');
  });
});
