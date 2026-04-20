import { AlertTriangle } from 'lucide-react';
import { Button } from '../../ui/Button';
import type { SanctuaryBackup } from '../../../src/api/admin';

interface RestoreConfirmModalProps {
  showConfirmModal: boolean;
  uploadedBackup: SanctuaryBackup | null;
  confirmText: string;
  setShowConfirmModal: (show: boolean) => void;
  setConfirmText: (text: string) => void;
  handleRestore: () => void;
  formatDate: (dateStr: string) => string;
}

export function RestoreConfirmModal({
  showConfirmModal,
  uploadedBackup,
  confirmText,
  setShowConfirmModal,
  setConfirmText,
  handleRestore,
  formatDate,
}: RestoreConfirmModalProps) {
  if (!showConfirmModal) {
    return null;
  }

  const handleCancel = () => {
    setShowConfirmModal(false);
    setConfirmText('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 w-full max-w-md mx-4 overflow-hidden">
        <div className="p-6 border-b border-sanctuary-100 dark:border-sanctuary-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-rose-100 dark:bg-rose-900/30 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
            </div>
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">
              Confirm Database Restore
            </h3>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
            This action will:
          </p>
          <ul className="text-sm text-sanctuary-600 dark:text-sanctuary-400 list-disc list-inside space-y-1">
            <li><strong className="text-rose-600 dark:text-rose-400">Delete ALL current data</strong></li>
            <li>Replace with backup from {uploadedBackup?.meta && formatDate(uploadedBackup.meta.createdAt)}</li>
            <li>Log you out (you'll need to log in again)</li>
          </ul>

          <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mt-4">
            Type <span className="font-mono bg-sanctuary-100 dark:bg-sanctuary-800 px-2 py-0.5 rounded">RESTORE</span> to confirm:
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value.toUpperCase())}
            placeholder="Type RESTORE"
            className="w-full px-3 py-2 rounded-md surface-muted border border-sanctuary-200 dark:border-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 placeholder-sanctuary-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
            autoFocus
          />

          <div className="flex space-x-3 pt-2">
            <Button variant="secondary" onClick={handleCancel} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleRestore}
              disabled={confirmText !== 'RESTORE'}
              className="flex-1"
            >
              Confirm Restore
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
