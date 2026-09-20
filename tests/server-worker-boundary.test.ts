import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checker = path.join(repoRoot, 'scripts/check-architecture-boundaries.mjs');

function runFixture(files: Record<string, string>): { ok: boolean; output: string } {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'sanctuary-worker-boundary-'));
  for (const [relativePath, source] of Object.entries(files)) {
    const target = path.join(fixtureRoot, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  try {
    const output = execFileSync(process.execPath, [checker], {
      cwd: repoRoot,
      env: { ...process.env, QUALITY_ROOT: fixtureRoot },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, output };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe('server worker architecture boundary', () => {
  it('allows services and workers to share the neutral sync contract', () => {
    const result = runFixture({
      'server/src/jobs/syncJobContract.ts': 'export interface SyncWalletJobData {}',
      'server/src/services/producer.ts': "import type { SyncWalletJobData } from '../jobs/syncJobContract';\n",
      'server/src/services/workerSyncQueue.ts': 'export const enqueueFullResyncBatch = () => undefined;\n',
      'server/src/worker.ts': "import { enqueueFullResyncBatch } from './services/workerSyncQueue';\nvoid enqueueFullResyncBatch;\n",
      'server/src/worker/consumer.ts': "import type { SyncWalletJobData } from '../../jobs/syncJobContract';\n",
    });

    expect(result.ok, result.output).toBe(true);
  });

  it.each([
    [
      'a direct worker job type import',
      'server/src/services/producer.ts',
      "import type { SyncWalletJobData } from '../worker/jobs/types';\n",
      'server/src/worker/jobs/types.ts',
    ],
    [
      'a worker barrel type import',
      'server/src/services/producer.ts',
      "import type { SyncWalletJobData } from '../worker';\n",
      'server/src/worker/index.ts',
    ],
    [
      'a worker implementation queue import',
      'server/src/worker/jobs/syncJobs.ts',
      "import { enqueueFullResyncBatch } from '../../services/workerSyncQueue';\n",
      'server/src/services/workerSyncQueue.ts',
    ],
    [
      'a top-level worker dynamic queue import',
      'server/src/worker.ts',
      "void import('./services/workerSyncQueue');\n",
      'server/src/services/workerSyncQueue.ts',
    ],
    [
      'an API dynamic repository import with an emitted extension',
      'server/src/api/intelligence.ts',
      "void import('../repositories/intelligenceRepository.js');\n",
      'server/src/repositories/intelligenceRepository.ts',
    ],
  ])('rejects %s', (_label, sourcePath, source, targetPath) => {
    const result = runFixture({
      [sourcePath]: source,
      [targetPath]: 'export interface SyncWalletJobData {}\nexport const enqueueFullResyncBatch = () => undefined;\n',
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('architecture-boundaries: failed');
  });

  it('matches extensionless exceptions against emitted .js specifiers', () => {
    const result = runFixture({
      'server/src/api/intelligence.ts': "void import('../repositories/intelligenceRepository.js');\n",
      'server/src/repositories/intelligenceRepository.ts': 'export const intelligenceRepository = {} as const;\n',
      'server/src/api/notifications.ts': "import { notifyNewTransactions } from '../infrastructure/notificationDispatcher.js';\nvoid notifyNewTransactions;\n",
      'server/src/infrastructure/notificationDispatcher.ts': 'export const notifyNewTransactions = () => undefined;\n',
      'scripts/quality/architecture-boundary-exceptions.json': JSON.stringify([
        {
          rule: 'server-api-runtime-repositories',
          file: 'server/src/api/intelligence.ts',
          target: 'server/src/repositories/intelligenceRepository.ts',
          specifier: '../repositories/intelligenceRepository',
          owner: 'test',
          reason: 'Fixture exception.',
          removeWhen: 'The route delegates repository access through a service.',
        },
        {
          rule: 'server-notification-dispatch-only',
          file: 'server/src/api/notifications.ts',
          target: 'server/src/infrastructure/notificationDispatcher.ts',
          specifier: '../infrastructure/notificationDispatcher :: notifyNewTransactions',
          owner: 'test',
          reason: 'Fixture exception.',
          removeWhen: 'The route delegates notification dispatch through the dispatch service.',
        },
      ]),
    });

    expect(result.ok, result.output).toBe(true);
  });
});
