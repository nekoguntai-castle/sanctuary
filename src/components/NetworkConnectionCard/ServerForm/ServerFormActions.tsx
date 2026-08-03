import { Loader2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import type { PresetServer } from '../types';

type ServerFormActionsProps = {
  editingServerId: string | null;
  isSubmitting: boolean;
  submitDisabled: boolean;
  presets: PresetServer[];
  onAddPreset: (preset: PresetServer) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

export function ServerFormActions({
  editingServerId,
  isSubmitting,
  submitDisabled,
  presets,
  onAddPreset,
  onCancel,
  onSubmit,
}: ServerFormActionsProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-wrap gap-1">
        {presets.map((preset) => (
          <button
            key={preset.name}
            onClick={() => onAddPreset(preset)}
            className="px-2 py-1 text-xs rounded bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-500 hover:bg-sanctuary-200"
          >
            {preset.name}
          </button>
        ))}
      </div>
      <div className="flex space-x-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onSubmit}
          disabled={submitDisabled}
        >
          <SubmitButtonContent editingServerId={editingServerId} isSubmitting={isSubmitting} />
        </Button>
      </div>
    </div>
  );
}

function SubmitButtonContent({
  editingServerId,
  isSubmitting,
}: {
  editingServerId: string | null;
  isSubmitting: boolean;
}) {
  if (isSubmitting) {
    return (
      <>
        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
        {editingServerId ? 'Updating' : 'Adding'}
      </>
    );
  }

  return editingServerId ? 'Update Server' : 'Add Server';
}
