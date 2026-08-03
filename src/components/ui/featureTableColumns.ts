import type { TableColumnConfig } from '../../types';

/**
 * Merge saved column order with current column definitions.
 * Handles new columns added after a user saved preferences, and removes
 * stale column IDs that no longer exist in the definition.
 */
export function mergeColumnOrder(
  savedOrder: string[] | undefined,
  defaultOrder: string[],
  columns: Record<string, TableColumnConfig>,
): string[] {
  if (!savedOrder?.length) return defaultOrder;

  const validIds = new Set(Object.keys(columns));
  const result: string[] = [];
  const seen = new Set<string>();

  for (const id of savedOrder) {
    if (validIds.has(id) && !seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }

  for (const id of defaultOrder) {
    if (!seen.has(id)) {
      result.push(id);
    }
  }

  return result;
}
