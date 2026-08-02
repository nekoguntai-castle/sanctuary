/** Deployment-wide lease preventing overlapping support-package generations. */
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { getRedisClient, isRedisConnected } from '../../infrastructure/redis';

const LEASE_KEY = 'sanctuary:diagnostics:support-package:v2:generation-lease';
// Collectors run in parallel with a 15s deadline and 1s cleanup budget. Keep the
// lease well beyond that bounded lifecycle so another API replica cannot overlap
// an active generation; Redis expiry remains crash recovery, not normal release.
const LEASE_TTL_MS = 90_000;
const LEASE_COMMAND_TIMEOUT_MS = 500;
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export type SupportPackageLeaseResult =
  | { status: 'acquired'; release: () => Promise<void> }
  | { status: 'busy' }
  | { status: 'unavailable' };

function boundedLeaseCommand<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('support_package_lease_timeout')),
      LEASE_COMMAND_TIMEOUT_MS,
    );
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Acquire an owner-token lease; release can delete only the caller's token. */
export async function acquireSupportPackageGenerationLease(
  client: Redis | null = getRedisClient(),
  connected = isRedisConnected(),
): Promise<SupportPackageLeaseResult> {
  if (!client || !connected) return { status: 'unavailable' };
  const token = randomUUID();
  try {
    const acquired = await boundedLeaseCommand(
      client.set(LEASE_KEY, token, 'PX', LEASE_TTL_MS, 'NX'),
    );
    if (acquired !== 'OK') return { status: 'busy' };
    return {
      status: 'acquired',
      release: async () => {
        await boundedLeaseCommand(
          client.eval(RELEASE_SCRIPT, 1, LEASE_KEY, token),
        ).then(() => undefined);
      },
    };
  } catch {
    return { status: 'unavailable' };
  }
}
