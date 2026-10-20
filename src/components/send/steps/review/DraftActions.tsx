import {
  Send,
  Save,
  Shield,
  ChevronLeft,
  Loader2,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '../../../ui/Button';
import type { ApprovalAction, TransactionData } from '../../../../hooks/send/types';

interface DraftActionsProps {
  isMultiSig: boolean;
  isDraftMode: boolean;
  isReadyToSign: boolean;
  canBroadcast: boolean;
  txData?: TransactionData | null;
  signing: boolean;
  broadcasting: boolean;
  savingDraft: boolean;
  /** A payjoin round in progress: its intents can never be saved as drafts (C-D9). */
  saveDraftLocked?: boolean;
  onSign?: () => void;
  onBroadcast?: () => void;
  onSaveDraft?: () => void;
  approvalMode?: ApprovalAction;
  onBroadcastSigned?: () => Promise<boolean>;
  prevStep: () => void;
}

type PrimaryActionProps = Pick<
  DraftActionsProps,
  | 'isMultiSig' | 'isReadyToSign' | 'canBroadcast' | 'txData' | 'signing' | 'broadcasting'
  | 'savingDraft' | 'onSign' | 'onBroadcast' | 'onBroadcastSigned' | 'onSaveDraft'
>;

function SubmitForApprovalButton({
  txData,
  signing,
  broadcasting,
  savingDraft,
  onSaveDraft,
}: PrimaryActionProps) {
  return (
    <Button
      variant="primary"
      onClick={onSaveDraft}
      disabled={!txData || signing || broadcasting}
      isLoading={savingDraft}
      className="flex-1"
    >
      <ShieldCheck className="w-4 h-4 mr-2" />
      Submit for approval
    </Button>
  );
}

function MultiSigPrimaryButton({
  isReadyToSign,
  canBroadcast,
  txData,
  signing,
  broadcasting,
  savingDraft,
  onSign,
  onBroadcastSigned,
}: PrimaryActionProps) {
  // Multi-sig: Show broadcast if enough signatures
  if (canBroadcast) {
    return (
      <Button
        variant="primary"
        onClick={onBroadcastSigned}
        disabled={!canBroadcast || savingDraft}
        isLoading={broadcasting}
        className="flex-1"
      >
        <Send className="w-4 h-4 mr-2" />
        Broadcast Transaction
      </Button>
    );
  }

  return (
    <Button
      variant="primary"
      onClick={onSign}
      disabled={!isReadyToSign || !txData || savingDraft}
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
  );
}

function SingleSigPrimaryButton({
  isReadyToSign,
  canBroadcast,
  signing,
  broadcasting,
  savingDraft,
  onBroadcast,
}: PrimaryActionProps) {
  // Single-sig: Sign & Broadcast
  return (
    <Button
      variant="primary"
      onClick={onBroadcast}
      disabled={!isReadyToSign || savingDraft}
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
  );
}

function PrimaryAction(props: PrimaryActionProps & { submitForApproval: boolean }) {
  if (props.submitForApproval) return <SubmitForApprovalButton {...props} />;
  return props.isMultiSig ? <MultiSigPrimaryButton {...props} /> : <SingleSigPrimaryButton {...props} />;
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
  saveDraftLocked = false,
  onSign,
  onBroadcast,
  onSaveDraft,
  approvalMode = null,
  onBroadcastSigned,
  prevStep,
}: DraftActionsProps) {
  const submitForApproval = approvalMode === 'submit';
  return (
    <>
      {/* Validation Warnings */}
      {!isReadyToSign && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 dark:text-amber-200">
            Please complete all required fields before signing.
          </div>
        </div>
      )}

      {submitForApproval && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <ShieldCheck className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 dark:text-amber-200">
            A vault policy requires approval before this transaction can be broadcast.
            Submit it for approval; it can be broadcast once approved.
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
              disabled={signing || broadcasting || savingDraft}
              className="flex-shrink-0"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          )}

          <PrimaryAction
            submitForApproval={submitForApproval}
            isMultiSig={isMultiSig}
            isReadyToSign={isReadyToSign}
            canBroadcast={canBroadcast}
            txData={txData}
            signing={signing}
            broadcasting={broadcasting}
            savingDraft={savingDraft}
            onSign={onSign}
            onBroadcast={onBroadcast}
            onBroadcastSigned={onBroadcastSigned}
            onSaveDraft={onSaveDraft}
          />
        </div>

        {/* Save Draft Button */}
        {onSaveDraft && !submitForApproval && (
          <Button
            variant="secondary"
            onClick={onSaveDraft}
            disabled={signing || broadcasting || saveDraftLocked}
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
