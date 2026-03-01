import React from 'react';
import { X, AlertCircle, Loader2 } from 'lucide-react';
import type { MonitoringService } from '../../src/api/admin';
import { Button } from '../ui/Button';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative surface-elevated rounded-2xl shadow-xl border border-sanctuary-200 dark:border-sanctuary-700 max-w-md w-full animate-fade-in">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
              Configure {service.name} URL
            </h3>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-sanctuary-400 hover:text-sanctuary-600 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

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
                className="w-full px-3 py-2 rounded-lg border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
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
        </div>
      </div>
    </div>
  );
};
