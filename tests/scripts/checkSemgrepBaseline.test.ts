import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = join(process.cwd(), 'scripts/quality/check-semgrep-baseline.mjs');

type Finding = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: string;
};

function normalizeSource(source: string) {
  return source.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

function hashFinding(finding: Finding) {
  return createHash('sha256')
    .update([finding.id, finding.path, normalizeSource(finding.source)].join('\0'))
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
    id: finding.id,
    path: finding.path,
    startLine: finding.startLine,
    endLine: finding.endLine,
    sha256: hashFinding(finding),
    reason: 'fixture baseline',
  };
}

function writeSource(finding: Finding) {
  const lines = Array.from({ length: finding.endLine }, () => '// filler');
  const sourceLines = finding.source.split(/\r?\n/);
  lines.splice(finding.startLine - 1, sourceLines.length, ...sourceLines);
  mkdirSync(dirname(finding.path), { recursive: true });
  writeFileSync(finding.path, `${lines.join('\n')}\n`);
}

function writeFixture(root: string, findings: Finding[], baseline: Finding[]) {
  const reportPath = join(root, 'semgrep.json');
  const baselinePath = join(root, 'baseline.json');

  for (const finding of findings) {
    writeSource(finding);
  }

  writeFileSync(
    reportPath,
    JSON.stringify({ results: findings.map(semgrepResult) }, null, 2),
  );
  writeFileSync(
    baselinePath,
    JSON.stringify({ version: 2, entries: baseline.map(baselineEntry) }, null, 2),
  );

  return { reportPath, baselinePath };
}

describe('check-semgrep-baseline', () => {
  it('accepts findings that are covered by the baseline', () => {
    const root = mkdtempSync(join(tmpdir(), 'sanctuary-semgrep-baseline-'));
    try {
      const finding = {
        id: 'typescript.security.fixture',
        path: join(root, 'src/example.ts'),
        startLine: 12,
        endLine: 14,
        source: 'dangerousCall({\n  shell: true,\n});',
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

  it('accepts a baseline finding when only the line numbers changed', () => {
    const root = mkdtempSync(join(tmpdir(), 'sanctuary-semgrep-baseline-'));
    try {
      const source = 'dangerousCall({ shell: true });';
      const currentFinding = {
        id: 'typescript.security.fixture',
        path: join(root, 'src/example.ts'),
        startLine: 30,
        endLine: 30,
        source,
      };
      const baselineFinding = {
        ...currentFinding,
        startLine: 12,
        endLine: 12,
      };
      const { reportPath, baselinePath } = writeFixture(
        root,
        [currentFinding],
        [baselineFinding],
      );

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
        path: join(root, 'src/old.ts'),
        startLine: 5,
        endLine: 5,
        source: 'oldDanger();',
      };
      const newFinding = {
        id: 'typescript.security.new',
        path: join(root, 'src/new.ts'),
        startLine: 9,
        endLine: 9,
        source: 'newDanger();',
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

  it('fails when a covered finding changes source text', () => {
    const root = mkdtempSync(join(tmpdir(), 'sanctuary-semgrep-baseline-'));
    try {
      const currentFinding = {
        id: 'typescript.security.fixture',
        path: join(root, 'src/example.ts'),
        startLine: 12,
        endLine: 12,
        source: 'dangerousCall({ shell: true, changed: true });',
      };
      const baselineFinding = {
        ...currentFinding,
        source: 'dangerousCall({ shell: true });',
      };
      const { reportPath, baselinePath } = writeFixture(
        root,
        [currentFinding],
        [baselineFinding],
      );

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

  it('rejects old coordinate-hash baselines', () => {
    const root = mkdtempSync(join(tmpdir(), 'sanctuary-semgrep-baseline-'));
    try {
      const finding = {
        id: 'typescript.security.fixture',
        path: join(root, 'src/example.ts'),
        startLine: 12,
        endLine: 12,
        source: 'dangerousCall({ shell: true });',
      };
      const { reportPath, baselinePath } = writeFixture(root, [finding], [finding]);

      writeFileSync(
        baselinePath,
        JSON.stringify({ version: 1, entries: [baselineEntry(finding)] }, null, 2),
      );

      const result = spawnSync(process.execPath, [scriptPath, reportPath, baselinePath], {
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('baseline version must be 2');
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
        path: join(root, 'src/example.ts'),
        startLine: 12,
        endLine: 14,
        source: 'dangerousCall({\n  shell: true,\n});',
      };

      writeSource(finding);
      writeFileSync(
        reportPath,
        JSON.stringify({ results: [semgrepResult(finding)] }, null, 2),
      );
      writeFileSync(
        baselinePath,
        JSON.stringify({
          version: 2,
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
