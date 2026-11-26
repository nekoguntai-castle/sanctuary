import { expect, it, vi } from 'vitest';
import { runWorkerCleanup } from '../../../src/worker/shutdownLifecycle';

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({ error: logError }),
}));

it('logs a failed cleanup and lets shutdown continue with the next resource', async () => {
  await runWorkerCleanup('Error shutting down Electrum pool', async () => {
    throw new Error('connection lost');
  });

  expect(logError).toHaveBeenCalledWith('Error shutting down Electrum pool', {
    error: 'connection lost',
  });
});
