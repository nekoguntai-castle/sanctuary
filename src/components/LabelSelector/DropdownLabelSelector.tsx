import { Check, ChevronDown, Plus, Tag, X } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { Label } from '../../types';
import { LabelChip } from './LabelChip';
import type { LabelSelectorController } from './types';

interface DropdownLabelSelectorProps {
  className: string;
  controller: LabelSelectorController;
  disabled: boolean;
  selectedLabels: Label[];
  showCreateOption: boolean;
}

export function DropdownLabelSelector({
  className,
  controller,
  disabled,
  selectedLabels,
  showCreateOption,
}: DropdownLabelSelectorProps) {
  return (
    <div className={`relative ${className}`} ref={controller.dropdownRef}>
      <DropdownTrigger
        disabled={disabled}
        isOpen={controller.isOpen}
        onRemoveLabel={controller.handleRemoveLabel}
        onToggleOpen={() => !disabled && controller.setIsOpen(!controller.isOpen)}
        selectedLabels={selectedLabels}
      />
      {controller.isOpen && (
        <DropdownMenu
          controller={controller}
          selectedLabels={selectedLabels}
          showCreateOption={showCreateOption}
        />
      )}
    </div>
  );
}

function DropdownTrigger({
  disabled,
  isOpen,
  onRemoveLabel,
  onToggleOpen,
  selectedLabels,
}: {
  disabled: boolean;
  isOpen: boolean;
  onRemoveLabel: (labelId: string, event: MouseEvent) => void;
  onToggleOpen: () => void;
  selectedLabels: Label[];
}) {
  const disabledClass = disabled
    ? 'opacity-50 cursor-not-allowed'
    : 'hover:border-sanctuary-400 dark:hover:border-sanctuary-600';

  return (
    <button
      onClick={onToggleOpen}
      disabled={disabled}
      className={`flex items-center justify-between w-full px-3 py-2 surface-elevated border border-sanctuary-300 dark:border-sanctuary-700 rounded-md text-sm transition-colors ${disabledClass} ${isOpen ? 'ring-2 ring-primary-500' : ''}`}
    >
      <div className="flex items-center gap-2 flex-wrap flex-1 min-h-[24px]">
        {selectedLabels.length === 0 ? (
          <span className="text-sanctuary-400">Select labels...</span>
        ) : (
          selectedLabels.map((label) => (
            <LabelChip
              key={label.id}
              label={label}
              removable={!disabled}
              removeClassName="cursor-pointer"
              onRemove={(event) => onRemoveLabel(label.id, event)}
            />
          ))
        )}
      </div>
      <ChevronDown
        className={`w-4 h-4 text-sanctuary-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
      />
    </button>
  );
}

function DropdownMenu({
  controller,
  selectedLabels,
  showCreateOption,
}: {
  controller: LabelSelectorController;
  selectedLabels: Label[];
  showCreateOption: boolean;
}) {
  return (
    <div className="absolute z-50 mt-1 w-full surface-elevated border border-sanctuary-200 dark:border-sanctuary-800 rounded-lg shadow-lg overflow-hidden">
      <SearchInput controller={controller} />
      <LabelsList controller={controller} selectedLabels={selectedLabels} />
      <CreateLabelSection controller={controller} showCreateOption={showCreateOption} />
    </div>
  );
}

function SearchInput({ controller }: { controller: LabelSelectorController }) {
  return (
    <div className="p-2 border-b border-sanctuary-100 dark:border-sanctuary-800">
      <input
        ref={controller.inputRef}
        type="text"
        value={controller.searchQuery}
        onChange={(event) => controller.setSearchQuery(event.target.value)}
        placeholder="Search labels..."
        className="w-full px-3 py-1.5 surface-muted border border-sanctuary-200 dark:border-sanctuary-800 rounded text-sm text-sanctuary-900 dark:text-sanctuary-100 placeholder-sanctuary-400 focus:outline-none focus:ring-1 focus:ring-primary-500"
        autoFocus
      />
    </div>
  );
}

function LabelsList({
  controller,
  selectedLabels,
}: {
  controller: LabelSelectorController;
  selectedLabels: Label[];
}) {
  if (controller.loading) {
    return (
      <div className="max-h-48 overflow-y-auto">
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-5 w-5 border border-primary-500 border-t-transparent" />
        </div>
      </div>
    );
  }

  if (controller.filteredLabels.length === 0) {
    return (
      <div className="max-h-48 overflow-y-auto">
        <div className="py-4 text-center text-sm text-sanctuary-500">
          {controller.searchQuery ? 'No labels found' : 'No labels available'}
        </div>
      </div>
    );
  }

  return (
    <div className="max-h-48 overflow-y-auto">
      <div className="py-1">
        {controller.filteredLabels.map((label) => (
          <LabelOption
            key={label.id}
            isSelected={selectedLabels.some((selectedLabel) => selectedLabel.id === label.id)}
            label={label}
            onToggle={() => controller.handleToggleLabel(label)}
          />
        ))}
      </div>
    </div>
  );
}

function LabelOption({
  isSelected,
  label,
  onToggle,
}: {
  isSelected: boolean;
  label: Label;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center justify-between w-full px-3 py-2 text-left hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors ${isSelected ? 'surface-secondary/50' : ''}`}
    >
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-white"
        style={{ backgroundColor: label.color }}
      >
        <Tag className="w-3 h-3" />
        {label.name}
      </span>
      {isSelected && <Check className="w-4 h-4 text-primary-500" />}
    </button>
  );
}

function CreateLabelSection({
  controller,
  showCreateOption,
}: {
  controller: LabelSelectorController;
  showCreateOption: boolean;
}) {
  if (!showCreateOption) return null;

  return (
    <div className="border-t border-sanctuary-100 dark:border-sanctuary-800 p-2">
      {controller.isCreating ? (
        <CreateLabelForm controller={controller} />
      ) : (
        <button
          onClick={() => controller.setIsCreating(true)}
          className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-primary-600 dark:text-primary-400 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 rounded transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create new label
        </button>
      )}
    </div>
  );
}

function CreateLabelForm({ controller }: { controller: LabelSelectorController }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={controller.newLabelName}
        onChange={(event) => controller.setNewLabelName(event.target.value)}
        placeholder="New label name..."
        className="flex-1 px-2 py-1 surface-muted border border-sanctuary-200 dark:border-sanctuary-800 rounded text-sm text-sanctuary-900 dark:text-sanctuary-100 placeholder-sanctuary-400 focus:outline-none focus:ring-1 focus:ring-primary-500"
        autoFocus
        onKeyDown={controller.handleCreateKeyDown}
      />
      <button
        onClick={controller.handleCreateLabel}
        disabled={!controller.newLabelName.trim() || controller.creating}
        className="p-1.5 bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300 dark:bg-sanctuary-700 dark:hover:bg-sanctuary-600 dark:disabled:bg-sanctuary-800 dark:border dark:border-sanctuary-600 text-white dark:text-sanctuary-100 rounded transition-colors"
      >
        {controller.creating ? (
          <div className="animate-spin rounded-full h-4 w-4 border border-white border-t-transparent" />
        ) : (
          <Check className="w-4 h-4" />
        )}
      </button>
      <button
        onClick={controller.cancelCreate}
        className="p-1.5 text-sanctuary-500 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
