import type { TransactionAction, TransactionState } from '../types';
import { WIZARD_STEPS, getNextStep, getPrevStep } from '../types';
import type { ReducerResult } from './types';

export function reduceNavigation(
  state: TransactionState,
  action: TransactionAction
): ReducerResult {
  if (action.type === 'GO_TO_STEP') {
    const targetIndex = WIZARD_STEPS.indexOf(action.step);
    const currentIndex = WIZARD_STEPS.indexOf(state.currentStep);

    // Can only go to completed steps or steps before/at current
    if (targetIndex > currentIndex && !state.completedSteps.has(action.step)) {
      return state;
    }

    return { ...state, currentStep: action.step };
  }

  if (action.type === 'NEXT_STEP') {
    const nextStep = getNextStep(state.currentStep);
    if (!nextStep) return state;

    // Mark current step as completed
    const newCompleted = new Set(state.completedSteps);
    newCompleted.add(state.currentStep);

    return {
      ...state,
      currentStep: nextStep,
      completedSteps: newCompleted,
    };
  }

  if (action.type === 'PREV_STEP') {
    const prevStep = getPrevStep(state.currentStep);
    if (!prevStep) return state;
    return { ...state, currentStep: prevStep };
  }

  if (action.type === 'MARK_STEP_COMPLETED') {
    const newCompleted = new Set(state.completedSteps);
    newCompleted.add(action.step);
    return { ...state, completedSteps: newCompleted };
  }

  if (action.type === 'UNMARK_STEP_COMPLETED') {
    const newCompleted = new Set(state.completedSteps);
    newCompleted.delete(action.step);
    return { ...state, completedSteps: newCompleted };
  }

  return undefined;
}
