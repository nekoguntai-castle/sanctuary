import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function workerServiceBlock(): string {
  const compose = readFileSync('docker-compose.yml', 'utf8');
  const match = compose.match(/\n  worker:\n([\s\S]*?)\n  mcp:\n/);
  if (!match?.[1]) throw new Error('docker-compose.yml has no worker service block');
  return match[1];
}

describe('worker database timeout contract', () => {
  it('bounds statements and interactive transactions outside the sync execution timer', () => {
    const worker = workerServiceBlock();

    expect(worker).toContain('&statement_timeout=30000');
    expect(worker).toContain('PRISMA_TRANSACTION_MAX_WAIT_MS: 10000');
    expect(worker).toContain('PRISMA_TRANSACTION_TIMEOUT_MS: 30000');
  });

  it('gives the bundled worker an authoritative stable replica identity', () => {
    const worker = workerServiceBlock();

    expect(worker).toContain(
      'WORKER_REPLICA_ID: ${WORKER_REPLICA_ID:-sanctuary-worker-1}',
    );
    expect(worker).not.toContain('WORKER_REPLICA_ID: ${WORKER_REPLICA_ID:-}');
  });
});
