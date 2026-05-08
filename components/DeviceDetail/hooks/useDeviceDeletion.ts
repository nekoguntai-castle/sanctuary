import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteDevice } from '../../../src/api/devices';
import { extractErrorMessage } from '../../../utils/errorHandler';
import { createLogger } from '../../../utils/logger';

const log = createLogger('DeviceDetail');

interface UseDeviceDeletionInput {
  deviceId: string;
  attachedWalletCount: number;
  isOwner: boolean;
}

export function useDeviceDeletion({
  deviceId,
  attachedWalletCount,
  isOwner,
}: UseDeviceDeletionInput) {
  const navigate = useNavigate();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const canDelete = isOwner && attachedWalletCount === 0;

  const confirmDelete = async () => {
    try {
      setDeletePending(true);
      setDeleteError(null);
      await deleteDevice(deviceId);
      navigate('/devices', { replace: true });
    } catch (error) {
      log.error('Failed to delete device', { error });
      setDeleteError(extractErrorMessage(error, 'Failed to delete device'));
      setDeletePending(false);
    }
  };

  const requestDelete = () => {
    setDeleteConfirmOpen(true);
    setDeleteError(null);
  };

  const cancelDelete = () => {
    setDeleteConfirmOpen(false);
    setDeleteError(null);
  };

  return {
    canDelete,
    deleteConfirmOpen,
    deletePending,
    deleteError,
    confirmDelete,
    requestDelete,
    cancelDelete,
  };
}
