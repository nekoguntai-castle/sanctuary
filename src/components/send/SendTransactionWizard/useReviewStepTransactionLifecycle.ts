import { useEffect, useRef } from 'react';
import type { WizardStep } from '../../../contexts/send';
import type { UseSendTransactionActionsResult } from '../../../hooks/send/useSendTransactionActions';

interface ReviewStepTransactionLifecycleProps {
  actions: UseSendTransactionActionsResult;
  currentStep: WizardStep;
  isDraftMode: boolean;
  isReadyToSign: boolean;
}

function shouldCreateReviewTransaction(
  currentStep: WizardStep,
  isDraftMode: boolean,
  isReadyToSign: boolean,
  txData: UseSendTransactionActionsResult['txData'],
  isCreating: boolean,
  error: string | null
): boolean {
  return (
    currentStep === 'review' &&
    !isDraftMode &&
    !txData &&
    !isCreating &&
    !error &&
    isReadyToSign
  );
}

export function useReviewStepTransactionLifecycle({
  actions,
  currentStep,
  isDraftMode,
  isReadyToSign,
}: ReviewStepTransactionLifecycleProps) {
  const prevStepRef = useRef(currentStep);
  const { createTransaction, error, isCreating, reset, txData } = actions;

  useEffect(() => {
    if (prevStepRef.current === 'review' && currentStep !== 'review' && !isDraftMode) {
      reset();
    }
    prevStepRef.current = currentStep;
  }, [currentStep, isDraftMode, reset]);

  useEffect(() => {
    if (shouldCreateReviewTransaction(currentStep, isDraftMode, isReadyToSign, txData, isCreating, error)) {
      createTransaction();
    }
  }, [currentStep, isDraftMode, txData, isCreating, error, isReadyToSign, createTransaction]);
}
