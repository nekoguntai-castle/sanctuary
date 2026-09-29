import React from 'react';
import {
  ArrowLeft,
  Check,
  ClipboardCheck,
  Cpu,
  Settings,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { CreateWalletStep } from './types';
import { getChoiceLabelClassName } from '../ui/choiceLabelStyles';

interface StepDescriptor {
  num: CreateWalletStep;
  label: string;
  icon: LucideIcon;
}

interface CreateWalletProgressProps {
  step: CreateWalletStep;
  onBack: () => void;
}

const STEPS: StepDescriptor[] = [
  { num: 1, label: 'Type', icon: Wallet },
  { num: 2, label: 'Signers', icon: Cpu },
  { num: 3, label: 'Config', icon: Settings },
  { num: 4, label: 'Review', icon: ClipboardCheck },
];

function getConnectorClass(isCompleted: boolean, isCurrent: boolean): string {
  const classes = ['w-8 max-[360px]:w-5 h-px mx-1 max-[360px]:mx-0.5 transition-colors duration-300'];
  classes.push(isCompleted ? 'bg-success-500' : 'bg-sanctuary-200 dark:bg-sanctuary-800');
  if (isCurrent) classes.push('bg-gradient-to-r from-success-500 to-sanctuary-200 dark:to-sanctuary-800');
  return classes.join(' ');
}

function getStepCircleClass(isCompleted: boolean, isCurrent: boolean): string {
  const classes = ['flex items-center justify-center rounded-full transition-all duration-300'];

  if (isCompleted) {
    classes.push('w-8 h-8 bg-success-500 text-white');
  } else if (isCurrent) {
    classes.push(`w-9 h-9 border-2 border-primary-500 ${getChoiceLabelClassName(true)} shadow-sm`);
  } else {
    classes.push('w-8 h-8 border border-sanctuary-300 dark:border-sanctuary-700 text-sanctuary-400');
  }

  return classes.join(' ');
}

function getStepLabelClass(isCompleted: boolean, isCurrent: boolean): string {
  const classes = ['text-[10px] mt-1 font-medium transition-colors'];

  if (isCurrent) {
    classes.push(getChoiceLabelClassName(true));
  } else if (isCompleted) {
    classes.push('text-success-700');
  } else {
    classes.push(getChoiceLabelClassName(false));
  }

  return classes.join(' ');
}

export const CreateWalletProgress: React.FC<CreateWalletProgressProps> = ({ step, onBack }) => (
  <div className="flex items-center justify-between mb-8">
    <button
      onClick={onBack}
      className="flex items-center text-sanctuary-500 hover:text-sanctuary-900 dark:hover:text-sanctuary-100 transition-colors"
    >
      <ArrowLeft className="w-4 h-4 mr-1" /> {step === 1 ? 'Cancel' : 'Back'}
    </button>
    <div className="flex items-center">
      {STEPS.map((stepDescriptor, idx) => {
        const isCompleted = stepDescriptor.num < step;
        const isCurrent = stepDescriptor.num === step;
        const StepIcon = stepDescriptor.icon;

        return (
          <React.Fragment key={stepDescriptor.num}>
            {idx > 0 && <div className={getConnectorClass(isCompleted, isCurrent)} />}
            <div className="flex flex-col items-center">
              <div className={getStepCircleClass(isCompleted, isCurrent)}>
                {isCompleted ? <Check className="w-4 h-4" /> : <StepIcon className="w-4 h-4" />}
              </div>
              <span aria-current={isCurrent ? 'step' : undefined} className={getStepLabelClass(isCompleted, isCurrent)}>
                {stepDescriptor.label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  </div>
);
