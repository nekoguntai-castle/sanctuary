import React from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '../ui/Button';
import type { CreateWalletStep } from './types';

interface CreateWalletFooterProps {
  step: CreateWalletStep;
  canContinue: boolean;
  isSubmitting: boolean;
  onNext: () => void;
  onCreate: () => void;
}

export const CreateWalletFooter: React.FC<CreateWalletFooterProps> = ({
  step,
  canContinue,
  isSubmitting,
  onNext,
  onCreate,
}) => (
  <div className="mt-8 pt-8 border-t border-sanctuary-200 dark:border-sanctuary-800 flex justify-end">
    {step < 4 ? (
      <Button size="lg" onClick={onNext} disabled={!canContinue}>
        Next Step <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
    ) : (
      <Button
        size="lg"
        onClick={onCreate}
        isLoading={isSubmitting}
        className="bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-600 dark:hover:bg-emerald-700"
      >
        <Check className="w-4 h-4 mr-2" /> Construct Wallet
      </Button>
    )}
  </div>
);
