import { queryClient } from './QueryProvider';
import { createLogger } from '../utils/logger';

const log = createLogger('queryCacheReset');

/**
 * Clears the shared React Query cache on logout.
 *
 * Query keys (see src/hooks/queries/*) carry no user identity, and the
 * module-scoped queryClient survives logout — so without this, a second
 * user logging in within gcTime (5 min) in the same tab can see the first
 * user's cached wallet data, and within staleTime (30s) with no refetch at
 * all.
 *
 * Cancels in-flight queries first so a slow response for the outgoing user
 * cannot land in the cache after the incoming user has logged in, then
 * clears the cache outright — clear() rather than resetQueries(), since
 * reset would trigger an immediate (unauthenticated) refetch.
 *
 * Must be called from every logout path, AFTER the user state has been
 * cleared, so no authenticated query remounts against the cache before it
 * is cleared. Never throws: a failure here must not block logout.
 */
export async function clearQueryCacheForLogout(): Promise<void> {
  try {
    await queryClient.cancelQueries();
  } catch (error) {
    log.debug('Failed to cancel in-flight queries before logout cache clear', { error });
  }

  try {
    queryClient.clear();
  } catch (error) {
    log.debug('Failed to clear the query cache on logout', { error });
  }
}
