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
});
