/**
 * DeleteModal Component
 *
 * Confirmation dialog for wallet deletion with DELETE typing requirement.
 */

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../../ui/Button';

interface DeleteModalProps {
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export const DeleteModal: React.FC<DeleteModalProps> = ({
  onConfirm,
  onClose,
}) => {
  const [deleteInput, setDeleteInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onConfirm();
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClose = () => {
    setDeleteInput('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="surface-elevated rounded-2xl max-w-md w-full p-6 shadow-xl border border-sanctuary-200 dark:border-sanctuary-700 animate-modal-enter">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-rose-100 dark:bg-rose-900/30 mb-4">
            <AlertTriangle className="h-6 w-6 text-rose-600 dark:text-rose-400" />
          </div>
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
            Delete Wallet?
          </h3>
          <p className="text-sm text-sanctuary-500 mb-6">
            This action cannot be undone. This will permanently remove the wallet
            configuration from Sanctuary. Your funds remain on the blockchain, but
            you will need your seed or backup to access them again.
          </p>

          <div className="mb-6">
            <label className="block text-xs font-medium text-sanctuary-500 mb-1 text-left">
              Type <span className="font-bold text-sanctuary-900 dark:text-sanctuary-100">DELETE</span> to confirm
            </label>
            <input
              type="text"
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              className="w-full px-3 py-2 border border-sanctuary-300 dark:border-sanctuary-700 rounded-lg surface-muted focus:outline-none focus:ring-2 focus:ring-rose-500"
              placeholder="DELETE"
            />
          </div>

          <div className="flex space-x-3">
            <Button variant="ghost" className="flex-1" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              disabled={deleteInput !== 'DELETE' || isDeleting}
              onClick={handleDelete}
            >
              {isDeleting ? 'Deleting...' : 'Delete Forever'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
