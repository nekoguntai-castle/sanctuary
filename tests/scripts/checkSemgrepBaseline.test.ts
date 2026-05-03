import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = join(process.cwd(), 'scripts/quality/check-semgrep-baseline.mjs');

type Finding = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
};

function hashFinding(finding: Finding) {
  return createHash('sha256')
    .update([finding.id, finding.path, finding.startLine, finding.endLine].join('\0'))
    .digest('hex');
}

function semgrepResult(finding: Finding) {
  return {
    check_id: finding.id,
    path: finding.path,
    start: { line: finding.startLine, col: 1 },
    end: { line: finding.endLine, col: 10 },
    extra: {
      severity: 'ERROR',
      message: 'fixture finding',
    },
  };
}

function baselineEntry(finding: Finding) {
  return {
    ...finding,
    sha256: hashFinding(finding),
    reason: 'fixture baseline',
  };
}

function writeFixture(root: string, findings: Finding[], baseline: Finding[]) {
  const reportPath = join(root, 'semgrep.json');
  const baselinePath = join(root, 'baseline.json');

  writeFileSync(
    reportPath,
    JSON.stringify({ results: findings.map(semgrepResult) }, null, 2),
  );
  writeFileSync(
    baselinePath,
    JSON.stringify({ version: 1, entries: baseline.map(baselineEntry) }, null, 2),
  );

  return { reportPath, baselinePath };
}

describe('check-semgrep-baseline', () => {
  it('accepts findings that are covered by the baseline', () => {
    const root = mkdtempSync(join(tmpdir(), 'sanctuary-semgrep-baseline-'));
    try {
      const finding = {
        id: 'typescript.security.fixture',
        path: 'src/example.ts',
        startLine: 12,
        endLine: 14,
      };
      const { reportPath, baselinePath } = writeFixture(root, [finding], [finding]);

      const output = execFileSync(process.execPath, [scriptPath, reportPath, baselinePath], {
        encoding: 'utf8',
      });

      expect(output).toContain('all covered');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails on new findings and stale baseline entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'sanctuary-semgrep-baseline-'));
    try {
      const oldFinding = {
        id: 'typescript.security.old',
        path: 'src/old.ts',
        startLine: 5,
        endLine: 5,
      };
      const newFinding = {
        id: 'typescript.security.new',
        path: 'src/new.ts',
        startLine: 9,
        endLine: 9,
      };
      const { reportPath, baselinePath } = writeFixture(root, [newFinding], [oldFinding]);

      const result = spawnSync(process.execPath, [scriptPath, reportPath, baselinePath], {
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('new finding');
      expect(result.stderr).toContain('stale baseline entry');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects baseline entries with invalid hashes', () => {
    const root = mkdtempSync(join(tmpdir(), 'sanctuary-semgrep-baseline-'));
    try {
      mkdirSync(root, { recursive: true });
      const reportPath = join(root, 'semgrep.json');
      const baselinePath = join(root, 'baseline.json');
      const finding = {
        id: 'typescript.security.fixture',
        path: 'src/example.ts',
        startLine: 12,
        endLine: 14,
      };

      writeFileSync(
        reportPath,
        JSON.stringify({ results: [semgrepResult(finding)] }, null, 2),
      );
      writeFileSync(
        baselinePath,
        JSON.stringify({
          version: 1,
          entries: [{ ...baselineEntry(finding), sha256: 'bad' }],
        }),
      );

      const result = spawnSync(process.execPath, [scriptPath, reportPath, baselinePath], {
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('invalid sha256');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
