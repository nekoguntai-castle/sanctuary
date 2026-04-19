import { Check, Edit2, Hash, Plus, Tag, Trash2, X } from 'lucide-react';
import type { Label } from '../../types';
import { PRESET_COLORS } from './constants';
import type { LabelManagerController } from './types';

interface LabelManagerViewProps {
  controller: LabelManagerController;
}

export const LabelManagerView = ({ controller }: LabelManagerViewProps) => {
  if (controller.loading) {
    return <LabelManagerLoading />;
  }

  return (
    <div className="space-y-4">
      <LabelManagerHeader controller={controller} />
      <LabelManagerError error={controller.error} />
      <LabelForm controller={controller} />
      <LabelList controller={controller} />
    </div>
  );
};

const LabelManagerLoading = () => (
  <div className="flex items-center justify-center py-8">
    <div className="animate-spin rounded-full h-6 w-6 border border-primary-500 border-t-transparent"></div>
  </div>
);

const LabelManagerHeader = ({ controller }: LabelManagerViewProps) => (
  <div className="flex items-center justify-between">
    <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
      Labels
    </h3>
    {!controller.isCreating && !controller.editingLabel && (
      <button
        onClick={controller.handleCreate}
        className="flex items-center gap-2 px-3 py-1.5 bg-primary-500 hover:bg-primary-600 dark:bg-sanctuary-700 dark:text-sanctuary-100 dark:hover:bg-sanctuary-600 dark:border dark:border-sanctuary-600 text-white rounded-lg text-sm font-medium transition-colors"
      >
        <Plus className="w-4 h-4" />
        New Label
      </button>
    )}
  </div>
);

const LabelManagerError = ({ error }: { error: string | null }) => {
  if (!error) return null;

  return (
    <div className="p-3 bg-error-50 dark:bg-error-900/20 border border-error-200 dark:border-error-800 rounded-lg text-error-700 dark:text-error-300 text-sm">
      {error}
    </div>
  );
};

const LabelForm = ({ controller }: LabelManagerViewProps) => {
  if (!controller.isCreating && !controller.editingLabel) return null;

  return (
    <div className="p-4 surface-muted border border-sanctuary-200 dark:border-sanctuary-800 rounded-lg space-y-4">
      <h4 className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
        {controller.editingLabel ? 'Edit Label' : 'Create New Label'}
      </h4>
      <LabelNameInput controller={controller} />
      <ColorPicker controller={controller} />
      <LabelDescriptionInput controller={controller} />
      <LabelPreview controller={controller} />
      <LabelFormActions controller={controller} />
    </div>
  );
};

const LabelNameInput = ({ controller }: LabelManagerViewProps) => (
  <div>
    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
      Name
    </label>
    <input
      type="text"
      value={controller.formName}
      onChange={(event) => controller.setFormName(event.target.value)}
      placeholder="e.g., Exchange, Donation, Business"
      className="w-full px-3 py-2 surface-elevated border border-sanctuary-300 dark:border-sanctuary-700 rounded-md text-sanctuary-900 dark:text-sanctuary-100 placeholder-sanctuary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
      autoFocus
    />
  </div>
);

const ColorPicker = ({ controller }: LabelManagerViewProps) => (
  <div>
    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
      Color
    </label>
    <div className="flex flex-wrap gap-2">
      {PRESET_COLORS.map((color) => (
        <button
          key={color}
          onClick={() => controller.setFormColor(color)}
          className={`w-8 h-8 rounded-full transition-all ${
            controller.formColor === color
              ? 'ring-2 ring-offset-2 ring-sanctuary-500 dark:ring-offset-sanctuary-950'
              : 'hover:scale-110'
          }`}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  </div>
);

const LabelDescriptionInput = ({ controller }: LabelManagerViewProps) => (
  <div>
    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
      Description (optional)
    </label>
    <input
      type="text"
      value={controller.formDescription}
      onChange={(event) => controller.setFormDescription(event.target.value)}
      placeholder="Optional description for this label"
      className="w-full px-3 py-2 surface-elevated border border-sanctuary-300 dark:border-sanctuary-700 rounded-md text-sanctuary-900 dark:text-sanctuary-100 placeholder-sanctuary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
    />
  </div>
);

const LabelPreview = ({ controller }: LabelManagerViewProps) => (
  <div>
    <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
      Preview
    </label>
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium text-white"
      style={{ backgroundColor: controller.formColor }}
    >
      <Tag className="w-3.5 h-3.5" />
      {controller.formName || 'Label Name'}
    </span>
  </div>
);

const LabelFormActions = ({ controller }: LabelManagerViewProps) => (
  <div className="flex items-center gap-2 pt-2">
    <button
      onClick={controller.handleSave}
      disabled={!controller.formName.trim() || controller.saving}
      className="flex items-center gap-2 px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300 dark:bg-sanctuary-700 dark:hover:bg-sanctuary-600 dark:disabled:bg-sanctuary-800 dark:border dark:border-sanctuary-600 disabled:cursor-not-allowed text-white dark:text-sanctuary-100 rounded-lg text-sm font-medium transition-colors"
    >
      {controller.saving ? (
        <div className="animate-spin rounded-full h-4 w-4 border border-white border-t-transparent" />
      ) : (
        <Check className="w-4 h-4" />
      )}
      {controller.editingLabel ? 'Save Changes' : 'Create Label'}
    </button>
    <button
      onClick={controller.handleCancel}
      disabled={controller.saving}
      className="px-4 py-2 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded-lg text-sm font-medium transition-colors"
    >
      Cancel
    </button>
  </div>
);

const LabelList = ({ controller }: LabelManagerViewProps) => {
  if (controller.labels.length === 0 && !controller.isCreating) {
    return <EmptyLabels />;
  }

  return (
    <div className="space-y-2">
      {controller.labels.map((label) => (
        <LabelRow key={label.id} label={label} controller={controller} />
      ))}
    </div>
  );
};

const EmptyLabels = () => (
  <div className="text-center py-8 text-sanctuary-500 dark:text-sanctuary-400">
    <Tag className="w-8 h-8 mx-auto mb-2 opacity-50" />
    <p>No labels created yet.</p>
    <p className="text-sm">Create labels to organize your transactions and addresses.</p>
  </div>
);

const LabelRow = ({ label, controller }: { label: Label; controller: LabelManagerController }) => (
  <div className="flex items-center justify-between p-3 surface-elevated border border-sanctuary-200 dark:border-sanctuary-800 rounded-lg group hover:border-sanctuary-300 dark:hover:border-sanctuary-700 transition-colors">
    <LabelIdentity label={label} />
    <div className="flex items-center gap-4">
      <UsageCounts label={label} />
      <LabelActions label={label} controller={controller} />
    </div>
  </div>
);

const LabelIdentity = ({ label }: { label: Label }) => (
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
);

const UsageCounts = ({ label }: { label: Label }) => (
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
);

const LabelActions = ({ label, controller }: { label: Label; controller: LabelManagerController }) => (
  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
    <button
      onClick={() => controller.handleEdit(label)}
      className="p-1.5 text-sanctuary-500 hover:text-primary-500 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded transition-colors"
      title="Edit label"
    >
      <Edit2 className="w-4 h-4" />
    </button>
    <DeleteAction label={label} controller={controller} />
  </div>
);

const DeleteAction = ({ label, controller }: { label: Label; controller: LabelManagerController }) => {
  if (controller.deleteConfirm !== label.id) {
    return (
      <button
        onClick={() => controller.requestDeleteConfirm(label.id)}
        className="p-1.5 text-sanctuary-500 hover:text-error-500 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded transition-colors"
        title="Delete label"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => controller.handleDelete(label.id)}
        disabled={controller.saving}
        className="p-1.5 text-white bg-error-500 hover:bg-error-600 rounded transition-colors"
        title="Confirm delete"
      >
        <Check className="w-4 h-4" />
      </button>
      <button
        onClick={controller.clearDeleteConfirm}
        className="p-1.5 text-sanctuary-500 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded transition-colors"
        title="Cancel"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
