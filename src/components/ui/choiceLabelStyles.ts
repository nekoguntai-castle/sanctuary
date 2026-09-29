/** Readable foregrounds for enabled selectable labels. */
export function getChoiceLabelClassName(selected: boolean): string {
  return selected ? 'text-primary-700' : 'text-sanctuary-600 dark:text-sanctuary-300';
}
