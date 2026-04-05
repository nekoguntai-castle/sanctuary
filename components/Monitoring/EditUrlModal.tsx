import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { MonitoringService } from '../../src/api/admin';
import { Button } from '../ui/Button';
import { ModalWrapper } from '../ui/ModalWrapper';

interface EditUrlModalProps {
  service: MonitoringService | null;
  editUrl: string;
  isSaving: boolean;
  saveError: string | null;
  hostname: string;
  onUrlChange: (url: string) => void;
  onSave: () => void;
  onClose: () => void;
}

/**
 * Modal dialog for configuring a custom URL for a monitoring service.
 */
export const EditUrlModal: React.FC<EditUrlModalProps> = ({
  service,
  editUrl,
  isSaving,
  saveError,
  hostname,
  onUrlChange,
  onSave,
  onClose,
}) => {
  if (!service) return null;

  return (
    <ModalWrapper title={`Configure ${service.name} URL`} onClose={onClose} animation="animate-fade-in">
      <p className="text-sm text-sanctuary-500 mb-4">
        Use a custom URL for reverse proxy setups. Leave empty to use the default port-based URL.
      </p>

      {saveError && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 text-sm flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-1">
            Custom URL
          </label>
          <input
            type="url"
            value={editUrl}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder={`https://${service.id}.yourdomain.com`}
            className="w-full px-3 py-2 rounded-md border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <p className="text-xs text-sanctuary-400 mt-1">
            Default: http://{hostname}:{service.defaultPort}
          </p>
        </div>

        <div className="flex justify-end space-x-3 pt-2">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </Button>
        </div>
      </div>
    </ModalWrapper>
  );
};
