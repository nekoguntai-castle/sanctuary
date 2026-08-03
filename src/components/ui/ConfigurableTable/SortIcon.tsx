import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import type { TableColumnConfig } from '../../../types';

interface SortIconProps {
  column: TableColumnConfig;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function SortIcon({ column, sortBy, sortOrder }: SortIconProps) {
  if (!column.sortable || !column.sortKey) {
    return null;
  }

  if (sortBy !== column.sortKey) {
    return <ArrowUpDown className="w-3 h-3 opacity-30 group-hover:opacity-50 transition-opacity" />;
  }

  if (sortOrder === 'asc') {
    return <ChevronUp className="w-3.5 h-3.5 text-primary-500 transition-transform" />;
  }

  return <ChevronDown className="w-3.5 h-3.5 text-primary-500 transition-transform" />;
}
