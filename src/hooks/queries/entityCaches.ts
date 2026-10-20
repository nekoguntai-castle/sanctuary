import { getQueryClient } from '../../providers/QueryProvider';
import type { QueryKeys } from './factory';

// A write that reached the server leaves shared caches (sidebar lists, detail
// views) stale even when the route that issued it has since moved on, so these
// run after the await regardless of route ownership.

/** Refetch the entity's lists and its detail after a successful update. */
export function refreshEntityCaches(keys: QueryKeys, id: string): void {
  const queryClient = getQueryClient();
  void queryClient.invalidateQueries({ queryKey: keys.lists() });
  void queryClient.invalidateQueries({ queryKey: keys.detail(id) });
}

/** Drop a deleted entity's detail and refetch its lists. */
export function evictEntityCache(keys: QueryKeys, id: string): void {
  const queryClient = getQueryClient();
  queryClient.removeQueries({ queryKey: keys.detail(id) });
  void queryClient.invalidateQueries({ queryKey: keys.lists() });
}
