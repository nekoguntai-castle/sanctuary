import React from 'react';
import { Send } from 'lucide-react';
import { Button } from '../ui/Button';

interface TransferOwnershipActionsProps {
  hasSelectedUser: boolean;
  submitting: boolean;
  onClose: () => void;
}

export const TransferOwnershipActions: React.FC<TransferOwnershipActionsProps> = ({
  hasSelectedUser,
  submitting,
  onClose,
}) => (
  <div className="flex justify-end space-x-3 pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
    <Button
      type="button"
      variant="secondary"
      onClick={onClose}
      disabled={submitting}
    >
      Cancel
    </Button>
    <Button
      type="submit"
      disabled={!hasSelectedUser || submitting}
      isLoading={submitting}
    >
      <Send className="w-4 h-4 mr-2" />
      Initiate Transfer
    </Button>
  </div>
);
