import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = join(process.cwd(), 'scripts/check-safety-catch-guards.mjs');

type AllowlistEntry = {
  file: string;
  functionName: string;
  issue: string;
  count: number;
  reason?: string;
  owner?: string;
  targetRemovalSlice?: string;
};

function writeFile(root: string, relativePath: string, source: string) {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${source.trim()}\n`);
}

function writeAllowlist(root: string, entries: AllowlistEntry[]) {
  writeFile(
    root,
    'scripts/quality/safety-catch-allowlist.json',
    JSON.stringify(
      {
        version: 1,
        entries: entries.map((entry) => ({
          reason: 'fixture reason',
          owner: 'fixture owner',
          targetRemovalSlice: 'fixture slice',
          ...entry,
        })),
      },
      null,
      2,
    ),
  );
}

function runCheck(root: string) {
  return spawnSync(process.execPath, [scriptPath, '--json'], {
    cwd: process.cwd(),
    env: { ...process.env, QUALITY_ROOT: root },
    encoding: 'utf8',
  });
}

function runCheckJson(root: string) {
  const output = execFileSync(process.execPath, [scriptPath, '--json'], {
    cwd: process.cwd(),
    env: { ...process.env, QUALITY_ROOT: root },
    encoding: 'utf8',
  });
  return JSON.parse(output);
}

function createRoot() {
  return mkdtempSync(join(tmpdir(), 'sanctuary-safety-catch-'));
}

describe('check-safety-catch-guards', () => {
  it('fails on a safety catch that swallows an error and continues', () => {
    const root = createRoot();
    try {
      writeFile(
        root,
        'server/src/services/bitcoin/example.ts',
        `
        export async function run() {
          try {
            await buildTransaction();
          } catch (error) {
            log.warn(error);
          }
          await persistTransaction();
        }
        `,
      );

      const result = runCheck(root);
      const summary = JSON.parse(result.stdout);

      expect(result.status).toBe(1);
      expect(summary.newFindings).toEqual([
        expect.objectContaining({
          file: 'server/src/services/bitcoin/example.ts',
          functionName: 'run',
          issue: 'non-terminal-catch',
          count: 1,
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not treat nested callback returns as fail-closed catch handling', () => {
    const root = createRoot();
    try {
      writeFile(
        root,
        'server/src/services/bitcoin/example.ts',
        `
        export async function run() {
          try {
            await buildTransaction();
          } catch (error) {
            [error].forEach(() => {
              return;
            });
            await cleanup();
          }
        }
        `,
      );

      const result = runCheck(root);
      const summary = JSON.parse(result.stdout);

      expect(result.status).toBe(1);
      expect(summary.newFindings[0]).toEqual(
        expect.objectContaining({
          file: 'server/src/services/bitcoin/example.ts',
          functionName: 'run',
          issue: 'non-terminal-catch',
        }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not treat conditional-only returns as deterministic catch handling', () => {
    const root = createRoot();
    try {
      writeFile(
        root,
        'server/src/services/bitcoin/example.ts',
        `
        export async function run(errorCode) {
          try {
            await buildTransaction();
          } catch (error) {
            if (errorCode === 'known') {
              return { ok: false };
            }
            await cleanup();
          }
        }
        `,
      );

      const result = runCheck(root);
      const summary = JSON.parse(result.stdout);

      expect(result.status).toBe(1);
      expect(summary.newFindings[0]).toEqual(
        expect.objectContaining({
          functionName: 'run',
          issue: 'non-terminal-catch',
        }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts throw, return, and explicit fail-closed helper handling', () => {
    const root = createRoot();
    try {
      writeFile(
        root,
        'server/src/api/transactions/example.ts',
        `
        export async function throwingRoute() {
          try {
            await decodePsbt();
          } catch (error) {
            throw new Error('invalid_psbt');
          }
        }

        export async function returningRoute() {
          try {
            await decodePsbt();
          } catch (error) {
            return { ok: false };
          }
        }

        export async function helperRoute() {
          try {
            await decodePsbt();
          } catch (error) {
            failClosedSafetyError(error);
          }
        }

        export async function branchRoute(errorCode) {
          try {
            await decodePsbt();
          } catch (error) {
            if (errorCode === 'known') {
              return { ok: false };
            } else {
              throw error;
            }
          }
        }
        `,
      );

      expect(runCheckJson(root).newFindings).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes with an accountable allowlist entry and fails when it becomes stale', () => {
    const root = createRoot();
    try {
      const sourcePath = 'server/src/services/bitcoin/example.ts';
      writeFile(
        root,
        sourcePath,
        `
        export async function run() {
          try {
            await syncWallet();
          } catch (error) {
            log.warn(error);
          }
        }
        `,
      );
      writeAllowlist(root, [{
        file: sourcePath,
        functionName: 'run',
        issue: 'non-terminal-catch',
        count: 1,
      }]);

      expect(runCheckJson(root).allowedFindings).toHaveLength(1);

      writeFile(
        root,
        sourcePath,
        `
        export async function run() {
          try {
            await syncWallet();
          } catch (error) {
            throw error;
          }
        }
        `,
      );

      const result = runCheck(root);
      const summary = JSON.parse(result.stdout);

      expect(result.status).toBe(1);
      expect(summary.staleAllowlistEntries).toEqual([
        expect.objectContaining({
          file: sourcePath,
          functionName: 'run',
          issue: 'non-terminal-catch',
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores comments, strings, tests, and files outside safety paths', () => {
    const root = createRoot();
    try {
      writeFile(
        root,
        'server/src/services/example.ts',
        `
        const text = "catch (error) { log.warn(error) }";
        // catch (error) { log.warn(error) }
        export function run() {
          return text;
        }
        `,
      );
      writeFile(
        root,
        'server/src/services/bitcoin/example.test.ts',
        `
        export async function testOnly() {
          try {
            await run();
          } catch (error) {
            log.warn(error);
          }
        }
        `,
      );

      expect(runCheckJson(root).newFindings).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
