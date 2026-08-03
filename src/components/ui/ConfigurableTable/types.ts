import type React from 'react';
import type { TableColumnConfig } from '../../../types';

export interface CellRendererProps<T> {
  item: T;
  column: TableColumnConfig;
}

export type CellRenderers<T> = Record<string, React.FC<CellRendererProps<T>>>;
