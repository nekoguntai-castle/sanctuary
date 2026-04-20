import { Loader2, Upload } from 'lucide-react';
import { Button } from '../../ui/Button';
import type { ValidationResult } from '../../../src/api/admin';

interface RestoreActionButtonProps {
  validationResult: ValidationResult | null;
  isRestoring: boolean;
  setShowConfirmModal: (show: boolean) => void;
}

export function RestoreActionButton({
  validationResult,
  isRestoring,
  setShowConfirmModal,
}: RestoreActionButtonProps) {
  return (
    <Button
      onClick={() => setShowConfirmModal(true)}
      disabled={!validationResult?.valid || isRestoring}
      variant="danger"
      className="w-full"
    >
      {isRestoring ? (
        <>
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          Restoring...
        </>
      ) : (
        <>
          <Upload className="w-4 h-4 mr-2" />
          Restore from Backup
        </>
      )}
    </Button>
  );
}
