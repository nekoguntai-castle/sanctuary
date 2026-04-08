import React, { useState, useEffect, useRef } from 'react';
import { Tag, Plus, X, Check, ChevronDown } from 'lucide-react';
import type { Label } from '../types';
import { useWalletLabels, useCreateWalletLabel } from '../hooks/queries/useWalletLabels';

interface LabelSelectorProps {
  walletId: string;
  selectedLabels: Label[];
  onChange: (labels: Label[]) => void;
  mode?: 'inline' | 'dropdown';
  showCreateOption?: boolean;
  disabled?: boolean;
  className?: string;
}

export const LabelSelector: React.FC<LabelSelectorProps> = ({
  walletId,
  selectedLabels,
  onChange,
  mode = 'dropdown',
  showCreateOption = true,
  disabled = false,
  className = '',
}) => {
  const { data: labels = [], isLoading: loading } = useWalletLabels(walletId);
  const createMutation = useCreateWalletLabel();

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');

  const creating = createMutation.isPending;

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
    const isSelected = selectedLabels.some((l) => l.id === label.id);
    if (isSelected) {
      onChange(selectedLabels.filter((l) => l.id !== label.id));
    } else {
      onChange([...selectedLabels, label]);
    }
  };

  const handleRemoveLabel = (labelId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(selectedLabels.filter((l) => l.id !== labelId));
  };

  const handleCreateLabel = async () => {
    if (!newLabelName.trim()) return;

    try {
      const result = await createMutation.mutateAsync({
        walletId,
        data: { name: newLabelName.trim() },
      });
      onChange([...selectedLabels, result]);
      setNewLabelName('');
      setIsCreating(false);
    } catch {
      // Error surfaces through createMutation.error
    }
  };

  const filteredLabels = labels.filter((label) =>
    label.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const availableLabels = filteredLabels.filter(
    (label) => !selectedLabels.some((l) => l.id === label.id)
  );

  // Inline mode - shows all labels as toggleable chips
  if (mode === 'inline') {
    return (
      <div className={`flex flex-wrap gap-2 ${className}`}>
        {selectedLabels.map((label) => (
          <span
            key={label.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white cursor-pointer hover:opacity-80 transition-opacity"
            style={{ backgroundColor: label.color }}
            onClick={() => !disabled && handleToggleLabel(label)}
          >
            <Tag className="w-3 h-3" />
            {label.name}
            {!disabled && (
              <X
                className="w-3 h-3 hover:scale-110 transition-transform"
                onClick={(e) => handleRemoveLabel(label.id, e)}
              />
            )}
          </span>
        ))}
        {!disabled && availableLabels.length > 0 && (
          <button
            onClick={() => setIsOpen(true)}
            className="inline-flex items-center gap-1 px-2 py-0.5 border border-dashed border-sanctuary-300 dark:border-sanctuary-700 rounded-full text-xs text-sanctuary-500 hover:border-primary-500 hover:text-primary-500 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add Label
          </button>
        )}
      </div>
    );
  }

  // Dropdown mode - button that opens a dropdown
  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`flex items-center justify-between w-full px-3 py-2 surface-elevated border border-sanctuary-300 dark:border-sanctuary-700 rounded-md text-sm transition-colors ${
          disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'hover:border-sanctuary-400 dark:hover:border-sanctuary-600'
        } ${isOpen ? 'ring-2 ring-primary-500' : ''}`}
      >
        <div className="flex items-center gap-2 flex-wrap flex-1 min-h-[24px]">
          {selectedLabels.length === 0 ? (
            <span className="text-sanctuary-400">Select labels...</span>
          ) : (
            selectedLabels.map((label) => (
              <span
                key={label.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                style={{ backgroundColor: label.color }}
              >
                <Tag className="w-3 h-3" />
                {label.name}
                {!disabled && (
                  <X
                    className="w-3 h-3 hover:scale-110 transition-transform cursor-pointer"
                    onClick={(e) => handleRemoveLabel(label.id, e)}
                  />
                )}
              </span>
            ))
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-sanctuary-400 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full surface-elevated border border-sanctuary-200 dark:border-sanctuary-800 rounded-lg shadow-lg overflow-hidden">
          {/* Search Input */}
          <div className="p-2 border-b border-sanctuary-100 dark:border-sanctuary-800">
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search labels..."
              className="w-full px-3 py-1.5 surface-muted border border-sanctuary-200 dark:border-sanctuary-800 rounded text-sm text-sanctuary-900 dark:text-sanctuary-100 placeholder-sanctuary-400 focus:outline-none focus:ring-1 focus:ring-primary-500"
              autoFocus
            />
          </div>

          {/* Labels List */}
          <div className="max-h-48 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-5 w-5 border border-primary-500 border-t-transparent" />
              </div>
            ) : filteredLabels.length === 0 ? (
              <div className="py-4 text-center text-sm text-sanctuary-500">
                {searchQuery ? 'No labels found' : 'No labels available'}
              </div>
            ) : (
              <div className="py-1">
                {filteredLabels.map((label) => {
                  const isSelected = selectedLabels.some((l) => l.id === label.id);
                  return (
                    <button
                      key={label.id}
                      onClick={() => handleToggleLabel(label)}
                      className={`flex items-center justify-between w-full px-3 py-2 text-left hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors ${
                        isSelected ? 'surface-secondary/50' : ''
                      }`}
                    >
                      <span
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: label.color }}
                      >
                        <Tag className="w-3 h-3" />
                        {label.name}
                      </span>
                      {isSelected && (
                        <Check className="w-4 h-4 text-primary-500" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Create New Label */}
          {showCreateOption && (
            <div className="border-t border-sanctuary-100 dark:border-sanctuary-800 p-2">
              {isCreating ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newLabelName}
                    onChange={(e) => setNewLabelName(e.target.value)}
                    placeholder="New label name..."
                    className="flex-1 px-2 py-1 surface-muted border border-sanctuary-200 dark:border-sanctuary-800 rounded text-sm text-sanctuary-900 dark:text-sanctuary-100 placeholder-sanctuary-400 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateLabel();
                      if (e.key === 'Escape') setIsCreating(false);
                    }}
                  />
                  <button
                    onClick={handleCreateLabel}
                    disabled={!newLabelName.trim() || creating}
                    className="p-1.5 bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300 dark:bg-sanctuary-700 dark:hover:bg-sanctuary-600 dark:disabled:bg-sanctuary-800 dark:border dark:border-sanctuary-600 text-white dark:text-sanctuary-100 rounded transition-colors"
                  >
                    {creating ? (
                      <div className="animate-spin rounded-full h-4 w-4 border border-white border-t-transparent" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setIsCreating(false);
                      setNewLabelName('');
                    }}
                    className="p-1.5 text-sanctuary-500 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setIsCreating(true)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-primary-600 dark:text-primary-400 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 rounded transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Create new label
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Compact label display component for showing labels in lists
interface LabelBadgesProps {
  labels: Label[];
  maxDisplay?: number;
  size?: 'sm' | 'md';
  onClick?: () => void;
}

export const LabelBadges: React.FC<LabelBadgesProps> = ({
  labels,
  maxDisplay = 3,
  size = 'sm',
  onClick,
}) => {
  if (!labels || labels.length === 0) return null;

  const displayLabels = labels.slice(0, maxDisplay);
  const remaining = labels.length - maxDisplay;

  const sizeClasses = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-sm';

  return (
    <div
      className={`flex items-center gap-1 flex-wrap ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      {displayLabels.map((label) => (
        <span
          key={label.id}
          className={`inline-flex items-center gap-1 rounded-full font-medium text-white ${sizeClasses}`}
          style={{ backgroundColor: label.color }}
          title={label.name}
        >
          <Tag className={size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
          {label.name}
        </span>
      ))}
      {remaining > 0 && (
        <span
          className={`inline-flex items-center rounded-full font-medium bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-300 ${sizeClasses}`}
        >
          +{remaining}
        </span>
      )}
    </div>
  );
};

export default LabelSelector;
