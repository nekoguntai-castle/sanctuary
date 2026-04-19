import { ArrowLeft } from 'lucide-react';

export function ImportWalletProgress({
  step,
  onBack,
}: {
  step: number;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-8">
      <button
        onClick={onBack}
        className="flex items-center text-sanctuary-500 hover:text-sanctuary-900 dark:hover:text-sanctuary-100 transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        {step === 1 ? 'Cancel' : 'Back'}
      </button>
      <div className="flex space-x-2">
        {[1, 2, 3, 4].map((indicatorStep) => (
          <StepIndicator
            key={indicatorStep}
            indicatorStep={indicatorStep}
            currentStep={step}
          />
        ))}
      </div>
    </div>
  );
}

function StepIndicator({
  indicatorStep,
  currentStep,
}: {
  indicatorStep: number;
  currentStep: number;
}) {
  return (
    <div
      className={`h-2 rounded-full transition-all duration-300 ${stepIndicatorClass(indicatorStep, currentStep)}`}
    />
  );
}

function stepIndicatorClass(indicatorStep: number, currentStep: number): string {
  if (indicatorStep === currentStep) {
    return 'w-8 bg-sanctuary-800 dark:bg-sanctuary-200';
  }

  if (indicatorStep < currentStep) {
    return 'w-2 bg-success-500';
  }

  return 'w-2 bg-sanctuary-200 dark:bg-sanctuary-800';
}
