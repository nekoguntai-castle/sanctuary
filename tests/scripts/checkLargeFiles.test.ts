import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = join(process.cwd(), 'scripts/quality/check-large-files.mjs');

function writeLines(filePath: string, lines: number) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(
    filePath,
    Array.from({ length: lines }, (_value, index) => `line${index + 1}`).join(
      '\n',
    ) + '\n',
  );
}

function createQualityRoot() {
  const root = mkdtempSync(join(tmpdir(), 'sanctuary-large-files-'));
  mkdirSync(join(root, 'scripts/quality'), { recursive: true });
  writeFileSync(
    join(root, 'scripts/quality/large-file-classification.json'),
    JSON.stringify(
      {
        lineLimit: 5,
        warningLimit: 3,
        classifications: {
          'scripts/perf/proof.mjs': {
            category: 'proof-harness',
            reason: 'Cohesive proof harness kept together for auditability.',
            owner: 'performance-proof',
            reviewWhenTouched: true,
            lastReviewed: '2026-04-29',
          },
        },
      },
      null,
      2,
    ),
  );
  return root;
}

function runLargeFiles(root: string) {
  const output = execFileSync(process.execPath, [scriptPath, '--json'], {
    cwd: process.cwd(),
    env: { ...process.env, QUALITY_ROOT: root },
    encoding: 'utf8',
  });
  return JSON.parse(output);
}

describe('check-large-files', () => {
  it('reports production source, tests, and classified files separately', () => {
    const root = createQualityRoot();
    try {
      writeLines(join(root, 'src/source.ts'), 4);
      writeLines(join(root, 'tests/source.test.ts'), 4);
      writeLines(join(root, 'scripts/perf/proof.mjs'), 6);

      const summary = runLargeFiles(root);

      expect(summary.source).toMatchObject({
        warningCount: 1,
        overLimitCount: 0,
        largest: { filePath: 'src/source.ts', lines: 4, role: 'source' },
      });
      expect(summary.tests).toMatchObject({
        warningCount: 1,
        overLimitCount: 0,
        largest: {
          filePath: 'tests/source.test.ts',
          lines: 4,
          role: 'test',
        },
      });
      expect(summary.classified).toMatchObject({
        warningCount: 1,
        overLimitCount: 1,
        largest: {
          filePath: 'scripts/perf/proof.mjs',
          lines: 6,
          category: 'proof-harness',
        },
      });
      expect(summary.errors).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails JSON mode for oversized production source and tests', () => {
    const root = createQualityRoot();
    try {
      writeLines(join(root, 'src/source.ts'), 6);
      writeLines(join(root, 'tests/source.test.ts'), 6);

      const result = spawnSync(process.execPath, [scriptPath, '--json'], {
        cwd: process.cwd(),
        env: { ...process.env, QUALITY_ROOT: root },
        encoding: 'utf8',
      });
      const summary = JSON.parse(result.stdout);

      expect(result.status).toBe(1);
      expect(summary.errors).toHaveLength(3);
      expect(summary.errors).toEqual(
        expect.arrayContaining([
          'oversized production source file: src/source.ts (6 lines > 5)',
          'oversized unclassified test file: tests/source.test.ts (6 lines > 5)',
          'classified file does not exist: scripts/perf/proof.mjs',
        ]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
