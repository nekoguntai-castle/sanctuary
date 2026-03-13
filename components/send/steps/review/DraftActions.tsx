import {
  Send,
  Save,
  Shield,
  ChevronLeft,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '../../../ui/Button';
import type { TransactionData } from '../../../../hooks/send/useSendTransactionActions';

interface DraftActionsProps {
  isMultiSig: boolean;
  isDraftMode: boolean;
  isReadyToSign: boolean;
  canBroadcast: boolean;
  txData?: TransactionData | null;
  signing: boolean;
  broadcasting: boolean;
  savingDraft: boolean;
  onSign?: () => void;
  onBroadcast?: () => void;
  onSaveDraft?: () => void;
  onBroadcastSigned?: () => Promise<boolean>;
  prevStep: () => void;
}

export function DraftActions({
  isMultiSig,
  isDraftMode,
  isReadyToSign,
  canBroadcast,
  txData,
  signing,
  broadcasting,
  savingDraft,
  onSign,
  onBroadcast,
  onSaveDraft,
  onBroadcastSigned,
  prevStep,
}: DraftActionsProps) {
  return (
    <>
      {/* Validation Warnings */}
      {!isReadyToSign && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 dark:text-amber-200">
            Please complete all required fields before signing.
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-3 pt-4 border-t border-sanctuary-200 dark:border-sanctuary-700">
        {/* Primary Action */}
        <div className="flex gap-3">
          {!isDraftMode && (
            <Button
              variant="secondary"
              onClick={prevStep}
              className="flex-shrink-0"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          )}

          {isMultiSig ? (
            // Multi-sig: Show broadcast if enough signatures
            canBroadcast ? (
              <Button
                variant="primary"
                onClick={onBroadcastSigned}
                disabled={!canBroadcast}
                isLoading={broadcasting}
                className="flex-1"
              >
                <Send className="w-4 h-4 mr-2" />
                Broadcast Transaction
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={onSign}
                disabled={!isReadyToSign || !txData}
                isLoading={signing || broadcasting}
                className="flex-1"
              >
                {!txData ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Preparing...
                  </>
                ) : (
                  <>
                    <Shield className="w-4 h-4 mr-2" />
                    Sign Transaction
                  </>
                )}
              </Button>
            )
          ) : (
            // Single-sig: Sign & Broadcast
            <Button
              variant="primary"
              onClick={onBroadcast}
              disabled={!isReadyToSign}
              isLoading={signing || broadcasting}
              className="flex-1"
            >
              {canBroadcast ? (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Broadcast
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Sign & Broadcast
                </>
              )}
            </Button>
          )}
        </div>

        {/* Save Draft Button */}
        {onSaveDraft && (
          <Button
            variant="secondary"
            onClick={onSaveDraft}
            isLoading={savingDraft}
            className="w-full"
          >
            <Save className="w-4 h-4 mr-2" />
            Save as Draft
          </Button>
        )}
      </div>
    </>
  );
}
