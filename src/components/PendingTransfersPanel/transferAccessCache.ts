import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { createLogger } from '../../utils/logger';

interface ResourceListItem {
  id: string;
}

const log = createLogger('TransferAccessCache');

/** Remove a transferred resource from every cache surface before navigation. */
export async function removeTransferredResourceAccess(
  queryClient: QueryClient,
  resourceId: string,
  listKey: QueryKey,
  detailKey: QueryKey,
): Promise<void> {
  queryClient.setQueriesData<unknown>({ queryKey: listKey }, (current: unknown) => {
    if (!Array.isArray(current)) return current;
    return (current as ResourceListItem[]).filter(resource => resource.id !== resourceId);
  });
  queryClient.removeQueries({ queryKey: detailKey, exact: true });
  try {
    await queryClient.invalidateQueries({ queryKey: listKey });
  } catch (error) {
    // The synchronous filter remains safe after a bounded API refetch fails;
    // navigation should not strand the former owner on inaccessible detail.
    log.warn('Failed to refresh resource list after access removal', { error });
  }
}
