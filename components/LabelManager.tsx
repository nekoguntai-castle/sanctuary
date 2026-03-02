import React, { useState, useEffect } from 'react';
import { Tag, Plus, Edit2, Trash2, X, Check, Palette, Hash } from 'lucide-react';
import * as labelsApi from '../src/api/labels';
import type { Label } from '../src/api/labels';
import { useLoadingState } from '../hooks/useLoadingState';

interface LabelManagerProps {
  walletId: string;
  onLabelsChange?: () => void;
}

// Preset colors for labels
const PRESET_COLORS = [
  '#6366f1', // Indigo (default)
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#64748b', // Slate
  '#78716c', // Stone
];

export const LabelManager: React.FC<LabelManagerProps> = ({ walletId, onLabelsChange }) => {
  const [labels, setLabels] = useState<Label[]>([]);

  // Loading states using hook
  const { loading, error: loadError, execute: runLoad } = useLoadingState({ initialLoading: true });
  const { loading: saving, error: saveError, execute: runSave, clearError } = useLoadingState();

  // Combined error display
  const error = loadError || saveError;

  // Create/Edit state
  const [isCreating, setIsCreating] = useState(false);
  const [editingLabel, setEditingLabel] = useState<Label | null>(null);
  const [formName, setFormName] = useState('');
  const [formColor, setFormColor] = useState(PRESET_COLORS[0]);
  const [formDescription, setFormDescription] = useState('');

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    loadLabels();
  }, [walletId]);

  const loadLabels = () => runLoad(async () => {
    const data = await labelsApi.getLabels(walletId);
    setLabels(data);
  });

  const handleCreate = () => {
    setIsCreating(true);
    setEditingLabel(null);
    setFormName('');
    setFormColor(PRESET_COLORS[0]);
    setFormDescription('');
    clearError();
  };

  const handleEdit = (label: Label) => {
    setEditingLabel(label);
    setIsCreating(false);
    setFormName(label.name);
    setFormColor(label.color);
    setFormDescription(label.description || '');
    clearError();
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingLabel(null);
    setFormName('');
    setFormColor(PRESET_COLORS[0]);
    setFormDescription('');
    clearError();
  };

  const handleSave = async () => {
    const trimmedName = formName.trim();
    const trimmedDescription = formDescription.trim() || undefined;

    const result = await runSave(async () => {
      if (editingLabel) {
        await labelsApi.updateLabel(walletId, editingLabel.id, {
          name: trimmedName,
          color: formColor,
          description: trimmedDescription,
        });
      } else {
        await labelsApi.createLabel(walletId, {
          name: trimmedName,
          color: formColor,
          description: trimmedDescription,
        });
      }
    });

    if (result !== null) {
      handleCancel();
      await loadLabels();
      onLabelsChange?.();
    }
  };

  const handleDelete = async (labelId: string) => {
    const result = await runSave(async () => {
      await labelsApi.deleteLabel(walletId, labelId);
    });

    if (result !== null) {
      setDeleteConfirm(null);
      await loadLabels();
      onLabelsChange?.();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary-500 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
          Labels
        </h3>
        {!isCreating && !editingLabel && (
          <button
            onClick={handleCreate}
            className="flex items-center gap-2 px-3 py-1.5 bg-primary-500 hover:bg-primary-600 dark:bg-sanctuary-700 dark:text-sanctuary-100 dark:hover:bg-sanctuary-600 dark:border dark:border-sanctuary-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Label
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-error-50 dark:bg-error-900/20 border border-error-200 dark:border-error-800 rounded-lg text-error-700 dark:text-error-300 text-sm">
          {error}
        </div>
      )}

      {/* Create/Edit Form */}
      {(isCreating || editingLabel) && (
        <div className="p-4 surface-muted border border-sanctuary-200 dark:border-sanctuary-800 rounded-xl space-y-4">
          <h4 className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
            {editingLabel ? 'Edit Label' : 'Create New Label'}
          </h4>

          {/* Name Input */}
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
              Name
            </label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g., Exchange, Donation, Business"
              className="w-full px-3 py-2 surface-elevated border border-sanctuary-300 dark:border-sanctuary-700 rounded-lg text-sanctuary-900 dark:text-sanctuary-100 placeholder-sanctuary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
              autoFocus
            />
          </div>

          {/* Color Picker */}
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
              Color
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setFormColor(color)}
                  className={`w-8 h-8 rounded-full transition-all ${
                    formColor === color
                      ? 'ring-2 ring-offset-2 ring-sanctuary-500 dark:ring-offset-sanctuary-950'
                      : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          {/* Description Input */}
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
              Description (optional)
            </label>
            <input
              type="text"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Optional description for this label"
              className="w-full px-3 py-2 surface-elevated border border-sanctuary-300 dark:border-sanctuary-700 rounded-lg text-sanctuary-900 dark:text-sanctuary-100 placeholder-sanctuary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Preview */}
          <div>
            <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
              Preview
            </label>
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium text-white"
              style={{ backgroundColor: formColor }}
            >
              <Tag className="w-3.5 h-3.5" />
              {formName || 'Label Name'}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={!formName.trim() || saving}
              className="flex items-center gap-2 px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300 dark:bg-sanctuary-700 dark:hover:bg-sanctuary-600 dark:disabled:bg-sanctuary-800 dark:border dark:border-sanctuary-600 disabled:cursor-not-allowed text-white dark:text-sanctuary-100 rounded-lg text-sm font-medium transition-colors"
            >
              {saving ? (
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {editingLabel ? 'Save Changes' : 'Create Label'}
            </button>
            <button
              onClick={handleCancel}
              disabled={saving}
              className="px-4 py-2 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Labels List */}
      {labels.length === 0 && !isCreating ? (
        <div className="text-center py-8 text-sanctuary-500 dark:text-sanctuary-400">
          <Tag className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No labels created yet.</p>
          <p className="text-sm">Create labels to organize your transactions and addresses.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {labels.map((label) => (
            <div
              key={label.id}
              className="flex items-center justify-between p-3 surface-elevated border border-sanctuary-200 dark:border-sanctuary-800 rounded-lg group hover:border-sanctuary-300 dark:hover:border-sanctuary-700 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium text-white"
                  style={{ backgroundColor: label.color }}
                >
                  <Tag className="w-3.5 h-3.5" />
                  {label.name}
                </span>
                {label.description && (
                  <span className="text-sm text-sanctuary-500 dark:text-sanctuary-400 hidden sm:inline">
                    {label.description}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-4">
                {/* Usage counts */}
                <div className="flex items-center gap-3 text-xs text-sanctuary-500 dark:text-sanctuary-400">
                  {label.transactionCount !== undefined && (
                    <span className="flex items-center gap-1">
                      <Hash className="w-3 h-3" />
                      {label.transactionCount} txs
                    </span>
                  )}
                  {label.addressCount !== undefined && (
                    <span className="flex items-center gap-1">
                      <Hash className="w-3 h-3" />
                      {label.addressCount} addrs
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleEdit(label)}
                    className="p-1.5 text-sanctuary-500 hover:text-primary-500 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded transition-colors"
                    title="Edit label"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>

                  {deleteConfirm === label.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(label.id)}
                        disabled={saving}
                        className="p-1.5 text-white bg-error-500 hover:bg-error-600 rounded transition-colors"
                        title="Confirm delete"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="p-1.5 text-sanctuary-500 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded transition-colors"
                        title="Cancel"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(label.id)}
                      className="p-1.5 text-sanctuary-500 hover:text-error-500 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded transition-colors"
                      title="Delete label"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LabelManager;
