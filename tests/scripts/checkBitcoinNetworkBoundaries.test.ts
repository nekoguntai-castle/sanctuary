import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = join(process.cwd(), 'scripts/check-bitcoin-network-boundaries.mjs');

type AllowlistEntry = {
  file: string;
  functionName: string;
  callee: string;
  issue: string;
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
    'scripts/quality/bitcoin-network-boundary-allowlist.json',
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
  return mkdtempSync(join(tmpdir(), 'sanctuary-bitcoin-boundaries-'));
}

describe('check-bitcoin-network-boundaries', () => {
  it('fails on a new default node-client call without an allowlist entry', () => {
    const root = createRoot();
    try {
      writeFile(
        root,
        'server/src/services/bitcoin/example.ts',
        `
        export async function run() {
          await getNodeClient();
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
          callee: 'getNodeClient',
          issue: 'missing-required-network-argument',
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes with an accountable allowlist entry and fails when the entry becomes stale', () => {
    const root = createRoot();
    try {
      const sourcePath = 'server/src/services/bitcoin/example.ts';
      writeFile(
        root,
        sourcePath,
        `
        export async function run() {
          await getNodeClient();
        }
        `,
      );
      writeAllowlist(root, [
        {
          file: sourcePath,
          functionName: 'run',
          callee: 'getNodeClient',
          issue: 'missing-required-network-argument',
        },
      ]);

      expect(runCheckJson(root).allowedFindings).toHaveLength(1);

      writeFile(
        root,
        sourcePath,
        `
        export async function run(network) {
          await getNodeClient(network);
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
          callee: 'getNodeClient',
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags known wrapper calls while ignoring calls on an already selected client', () => {
    const root = createRoot();
    try {
      writeFile(
        root,
        'server/src/api/bitcoin/example.ts',
        `
        export async function route(blockchain, advancedTx, client, rawTx) {
          await blockchain.broadcastTransaction(rawTx);
          await advancedTx.createCPFPTransaction('parent', 0, 5, 'recipient', 'wallet', 'mainnet');
          await client.broadcastTransaction(rawTx);
          await getNodeClient('testnet4');
        }
        `,
      );

      const result = runCheck(root);
      const summary = JSON.parse(result.stdout);

      expect(result.status).toBe(1);
      expect(summary.newFindings).toHaveLength(2);
      expect(summary.newFindings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            callee: 'blockchain.broadcastTransaction',
            issue: 'missing-required-network-argument',
          }),
          expect.objectContaining({
            callee: 'advancedTx.createCPFPTransaction',
            issue: 'hardcoded-mainnet-network',
          }),
        ]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
