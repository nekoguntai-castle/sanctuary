import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadSupportPackageGenerator,
  resolveSupportPackageModulePath,
  supportPackageModuleCandidates,
  writeSupportPackageJson,
} from '../../scripts/support-package-runner.mjs';

describe('support-package-runner', () => {
  it('keeps the compiled module path candidates ordered from newest to oldest layouts', () => {
    expect(supportPackageModuleCandidates).toEqual([
      './dist/app/src/services/supportPackage',
      './dist/server/src/services/supportPackage',
      './dist/services/supportPackage',
    ]);
  });

  it('resolves the first available compiled module path', () => {
    const attempted: string[] = [];

    const resolved = resolveSupportPackageModulePath((candidate) => {
      attempted.push(candidate);

      if (candidate === supportPackageModuleCandidates[1]) {
        return `/app/${candidate}`;
      }

      throw new Error('missing');
    });

    expect(resolved).toBe(supportPackageModuleCandidates[1]);
    expect(attempted).toEqual([
      supportPackageModuleCandidates[0],
      supportPackageModuleCandidates[1],
    ]);
  });

  it('throws a clear error when no compiled module path exists', () => {
    expect(() => loadSupportPackageGenerator({
      resolveCandidate: () => {
        throw new Error('missing');
      },
    })).toThrow('could not locate compiled support package module');
  });

  it('writes JSON using the generator from the first resolved module path', async () => {
    const chunks: string[] = [];

    await writeSupportPackageJson(
      {
        write(chunk: string) {
          chunks.push(chunk);
          return true;
        },
      } as NodeJS.WritableStream,
      {
        resolveCandidate: (candidate: string) => {
          if (candidate === supportPackageModuleCandidates[2]) {
            return `/app/${candidate}`;
          }

          throw new Error('missing');
        },
        loadModule: (modulePath: string) => ({
          generateSupportPackage: async () => ({ modulePath }),
        }),
      },
    );

    expect(chunks.join('')).toBe(JSON.stringify({
      modulePath: supportPackageModuleCandidates[2],
    }, null, 2));
  });

  it('suppresses incidental stdout noise while generating the support package', async () => {
    const chunks: string[] = [];
    const observedStdout: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);

    process.stdout.write = ((chunk: string | Uint8Array) => {
      observedStdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      await writeSupportPackageJson(
        {
          write(chunk: string) {
            chunks.push(chunk);
            return true;
          },
        } as NodeJS.WritableStream,
        {
          resolveCandidate: () => '/app/dist/app/src/services/supportPackage',
          loadModule: () => ({
            generateSupportPackage: async () => {
              process.stdout.write('◇ injected env (0) from dist/app/.env');
              return { ok: true };
            },
          }),
        },
      );
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(observedStdout).toEqual([]);
    expect(chunks.join('')).toBe(JSON.stringify({ ok: true }, null, 2));
  });

  it('runs when the source is piped over stdin, as scripts/support-package.sh does', () => {
    // The backend image has no scripts/lib, so a cwd-relative helper import must not be needed.
    const cwd = mkdtempSync(path.join(tmpdir(), 'support-package-stdin-'));
    try {
      const moduleDir = path.join(cwd, 'dist/server/src/services');
      mkdirSync(moduleDir, { recursive: true });
      writeFileSync(
        path.join(moduleDir, 'supportPackage.js'),
        'exports.generateSupportPackage = async () => ({ ok: 1 });\n',
      );

      const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
        cwd,
        input: readFileSync(path.resolve(__dirname, '../../scripts/support-package-runner.mjs')),
        encoding: 'utf8',
      });

      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ ok: 1 });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
