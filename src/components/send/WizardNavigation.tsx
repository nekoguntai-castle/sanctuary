/**
 * WizardNavigation Component
 *
 * Step indicator and navigation controls for the transaction wizard.
 * Supports hybrid navigation: linear progression with ability to jump back.
 */

import React from 'react';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { Button } from '../ui/Button';
import { useSendTransaction } from '../../contexts/send';
import { WIZARD_STEPS, STEP_LABELS } from '../../contexts/send/types';
import type { WizardStep } from '../../contexts/send/types';

export interface WizardNavigationProps {
  // Optional: hide the bottom navigation buttons
  hideButtons?: boolean;
  // Optional: custom next button text
  nextButtonText?: string;
  // Optional: custom next button action (for final step)
  onNextClick?: () => void;
  // Optional: show loading state on next button
  nextLoading?: boolean;
  // Optional: disable next button
  nextDisabled?: boolean;
}

export function WizardNavigation({
  hideButtons = false,
  nextButtonText,
  onNextClick,
  nextLoading = false,
  nextDisabled = false,
}: WizardNavigationProps) {
  const {
    currentStep,
    canGoNext,
    canGoBack,
    canJumpTo,
    goToStep,
    nextStep,
    prevStep,
    state,
  } = useSendTransaction();

  const currentIndex = WIZARD_STEPS.indexOf(currentStep);
  const isLastStep = currentIndex === WIZARD_STEPS.length - 1;

  // Handle next button click
  const handleNext = () => {
    if (onNextClick) {
      onNextClick();
    } else {
      nextStep();
    }
  };

  // Get step status for styling
  const getStepStatus = (step: WizardStep, index: number) => {
    if (step === currentStep) return 'current';
    if (state.completedSteps.has(step)) return 'completed';
    if (index < currentIndex) return 'passed';
    return 'upcoming';
  };

  return (
    <div className="space-y-4">
      {/* Step Indicators */}
      <div className="flex items-center justify-between">
        {WIZARD_STEPS.map((step, index) => {
          const status = getStepStatus(step, index);
          const isClickable = canJumpTo(step);

          return (
            <React.Fragment key={step}>
              {/* Step Circle */}
              <button
                type="button"
                onClick={() => isClickable && goToStep(step)}
                disabled={!isClickable}
                aria-current={status === 'current' ? 'step' : undefined}
                aria-label={
                  isClickable && status !== 'current'
                    ? `Edit step ${index + 1}: ${STEP_LABELS[step]}`
                    : undefined
                }
                className={`
                  relative flex flex-col items-center group
                  ${isClickable ? 'cursor-pointer' : 'cursor-default'}
                `}
              >
                {/* Circle */}
                <div
                  className={`
                    w-10 h-10 rounded-full flex items-center justify-center
                    border-2 transition-all duration-200
                    ${status === 'current'
                      ? 'border-primary-500 bg-primary-500 text-white'
                      : status === 'completed'
                        ? 'border-green-500 bg-green-500 text-white'
                        : status === 'passed'
                          ? 'border-sanctuary-400 bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-300'
                          : 'border-sanctuary-300 dark:border-sanctuary-600 bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-400'
                    }
                    ${isClickable && status !== 'current' ? 'hover:border-primary-400 hover:scale-105' : ''}
                  `}
                >
                  {status === 'completed' ? (
                    <Check className="w-5 h-5" aria-hidden="true" />
                  ) : (
                    <span className="text-sm font-semibold">{index + 1}</span>
                  )}
                </div>

                {/* Label */}
                <span
                  className={`
                    mt-2 text-xs font-medium transition-colors
                    ${status === 'current'
                      ? 'text-primary-600 dark:text-primary-400'
                      : status === 'completed'
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-sanctuary-500'
                    }
                  `}
                >
                  {STEP_LABELS[step]}
                </span>

                {/* Tooltip on hover for clickable steps */}
                {isClickable && status !== 'current' && (
                  <div className="absolute -bottom-8 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
                    <span className="text-[10px] text-sanctuary-500 whitespace-nowrap">
                      Click to edit
                    </span>
                  </div>
                )}
              </button>

              {/* Connector Line */}
              {index < WIZARD_STEPS.length - 1 && (
                <div className="flex-1 mx-2">
                  <div
                    className={`
                      h-0.5 rounded-full transition-colors
                      ${index < currentIndex || state.completedSteps.has(WIZARD_STEPS[index + 1])
                        ? 'bg-primary-500'
                        : 'bg-sanctuary-200 dark:bg-sanctuary-700'
                      }
                    `}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Navigation Buttons */}
      {!hideButtons && (
        <div className="flex justify-between pt-4 border-t border-sanctuary-200 dark:border-sanctuary-700">
          {/* Back Button */}
          <Button
            variant="secondary"
            onClick={prevStep}
            disabled={!canGoBack}
            className={!canGoBack ? 'invisible' : ''}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>

          {/* Next Button */}
          {!isLastStep && (
            <Button
              variant="primary"
              onClick={handleNext}
              disabled={!canGoNext || nextDisabled}
              isLoading={nextLoading}
            >
              {nextButtonText || 'Continue'}
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
