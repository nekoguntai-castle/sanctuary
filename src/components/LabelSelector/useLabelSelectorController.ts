import { useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import type { Label } from '../../types';
import { useCreateWalletLabel, useWalletLabels } from '../../hooks/queries/useWalletLabels';
import { createLogger } from '../../utils/logger';
import type { LabelSelectorController } from './types';

const log = createLogger('LabelSelector');

interface UseLabelSelectorControllerProps {
  walletId: string;
  selectedLabels: Label[];
  onChange: (labels: Label[]) => void;
}

export function useLabelSelectorController({
  onChange,
  selectedLabels,
  walletId,
}: UseLabelSelectorControllerProps): LabelSelectorController {
  const { data: labels = [], isLoading: loading } = useWalletLabels(walletId);
  const createMutation = useCreateWalletLabel();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsCreating(false);
        setSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggleLabel = (label: Label) => {
    const isSelected = selectedLabels.some((selectedLabel) => selectedLabel.id === label.id);
    const nextLabels = isSelected
      ? selectedLabels.filter((selectedLabel) => selectedLabel.id !== label.id)
      : [...selectedLabels, label];

    onChange(nextLabels);
  };

  const handleRemoveLabel = (labelId: string, event: ReactMouseEvent) => {
    event.stopPropagation();
    onChange(selectedLabels.filter((label) => label.id !== labelId));
  };

  const handleCreateLabel = async () => {
    const trimmedName = newLabelName.trim();
    if (!trimmedName) return;

    try {
      const result = await createMutation.mutateAsync({
        walletId,
        data: { name: trimmedName },
      });
      onChange([...selectedLabels, result]);
      setNewLabelName('');
      setIsCreating(false);
    } catch (error) {
      log.debug('Label create mutation surfaced through hook state', { error });
    }
  };

  const handleCreateKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') void handleCreateLabel();
    if (event.key === 'Escape') setIsCreating(false);
  };

  const cancelCreate = () => {
    setIsCreating(false);
    setNewLabelName('');
  };

  const filteredLabels = labels.filter((label) =>
    label.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const availableLabels = filteredLabels.filter(
    (label) => !selectedLabels.some((selectedLabel) => selectedLabel.id === label.id)
  );

  return {
    availableLabels,
    cancelCreate,
    creating: createMutation.isPending,
    dropdownRef,
    filteredLabels,
    handleCreateKeyDown,
    handleCreateLabel,
    handleRemoveLabel,
    handleToggleLabel,
    inputRef,
    isCreating,
    isOpen,
    loading,
    newLabelName,
    searchQuery,
    setIsCreating,
    setIsOpen,
    setNewLabelName,
    setSearchQuery,
  };
}
