import type { KeyboardEvent, MouseEvent, RefObject } from 'react';
import type { Label } from '../../types';

export interface LabelSelectorProps {
  walletId: string;
  selectedLabels: Label[];
  onChange: (labels: Label[]) => void;
  mode?: 'inline' | 'dropdown';
  showCreateOption?: boolean;
  disabled?: boolean;
  className?: string;
}

export interface LabelBadgesProps {
  labels: Label[];
  maxDisplay?: number;
  size?: 'sm' | 'md';
  onClick?: () => void;
}

export interface LabelSelectorController {
  availableLabels: Label[];
  creating: boolean;
  dropdownRef: RefObject<HTMLDivElement | null>;
  filteredLabels: Label[];
  handleCreateLabel: () => Promise<void>;
  handleCreateKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  handleRemoveLabel: (labelId: string, event: MouseEvent) => void;
  handleToggleLabel: (label: Label) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  isCreating: boolean;
  isOpen: boolean;
  loading: boolean;
  newLabelName: string;
  searchQuery: string;
  cancelCreate: () => void;
  setIsCreating: (isCreating: boolean) => void;
  setIsOpen: (isOpen: boolean) => void;
  setNewLabelName: (name: string) => void;
  setSearchQuery: (query: string) => void;
}
