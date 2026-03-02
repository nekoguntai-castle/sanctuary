/**
 * Tests for contexts/send/stepValidation.ts
 *
 * Tests validation rules for each wizard step.
 */

import { describe, it, expect } from 'vitest';
import {
  validateTypeStep,
  validateOutputsStep,
  validateReviewStep,
  isStepValid,
  canProceedToNextStep,
  getStepErrors,
  isReadyToSign,
  stepValidators,
} from '../../contexts/send/stepValidation';
import type { TransactionState, WizardStep } from '../../contexts/send/types';

describe('stepValidation', () => {
  // Helper to create a minimal transaction state
  const createMockState = (overrides: Partial<TransactionState> = {}): TransactionState => ({
    currentStep: 'type',
    completedSteps: new Set<WizardStep>(),
    transactionType: null,
    outputs: [],
    outputsValid: [],
    scanningOutputIndex: null,
    showCoinControl: false,
    selectedUTXOs: new Set<string>(),
    feeRate: 1,
    rbfEnabled: true,
    subtractFees: false,
    useDecoys: false,
    decoyCount: 0,
    payjoinUrl: null,
    payjoinStatus: 'idle',
    signingDeviceId: null,
    expandedDeviceId: null,
    signedDevices: new Set<string>(),
    unsignedPsbt: null,
    showPsbtOptions: false,
    psbtDeviceId: null,
    draftId: null,
    isDraftMode: false,
    isSubmitting: false,
    error: null,
    ...overrides,
  });

  describe('validateTypeStep', () => {
    it('returns false when transactionType is null', () => {
      const state = createMockState({ transactionType: null });
      expect(validateTypeStep(state)).toBe(false);
    });

    it('returns true when transactionType is standard', () => {
      const state = createMockState({ transactionType: 'standard' });
      expect(validateTypeStep(state)).toBe(true);
    });

    it('returns true when transactionType is consolidation', () => {
      const state = createMockState({ transactionType: 'consolidation' });
      expect(validateTypeStep(state)).toBe(true);
    });

    it('returns true when transactionType is sweep', () => {
      const state = createMockState({ transactionType: 'sweep' });
      expect(validateTypeStep(state)).toBe(true);
    });
  });

  describe('validateOutputsStep', () => {
    it('returns false when outputs array is empty', () => {
      const state = createMockState({ outputs: [], outputsValid: [], feeRate: 1 });
      expect(validateOutputsStep(state)).toBe(false);
    });

    it('returns false when outputsValid contains false', () => {
      const state = createMockState({
        outputs: [{ address: 'bc1q...', amount: '100000' }],
        outputsValid: [false],
        feeRate: 1,
      });
      expect(validateOutputsStep(state)).toBe(false);
    });

    it('returns false when address is empty', () => {
      const state = createMockState({
        outputs: [{ address: '', amount: '100000' }],
        outputsValid: [true],
        feeRate: 1,
      });
      expect(validateOutputsStep(state)).toBe(false);
    });

    it('returns false when address is only whitespace', () => {
      const state = createMockState({
        outputs: [{ address: '   ', amount: '100000' }],
        outputsValid: [true],
        feeRate: 1,
      });
      expect(validateOutputsStep(state)).toBe(false);
    });

    it('returns false when non-sendMax output has no amount', () => {
      const state = createMockState({
        outputs: [{ address: 'bc1q...', amount: '' }],
        outputsValid: [true],
        feeRate: 1,
      });
      expect(validateOutputsStep(state)).toBe(false);
    });

    it('returns false when non-sendMax output has zero amount', () => {
      const state = createMockState({
        outputs: [{ address: 'bc1q...', amount: '0' }],
        outputsValid: [true],
        feeRate: 1,
      });
      expect(validateOutputsStep(state)).toBe(false);
    });

    it('returns false when non-sendMax output has negative amount', () => {
      const state = createMockState({
        outputs: [{ address: 'bc1q...', amount: '-100' }],
        outputsValid: [true],
        feeRate: 1,
      });
      expect(validateOutputsStep(state)).toBe(false);
    });

    it('returns true when sendMax output has no amount', () => {
      const state = createMockState({
        outputs: [{ address: 'bc1q...', amount: '', sendMax: true }],
        outputsValid: [true],
        feeRate: 1,
      });
      expect(validateOutputsStep(state)).toBe(true);
    });

    it('returns false when feeRate is zero', () => {
      const state = createMockState({
        outputs: [{ address: 'bc1q...', amount: '100000' }],
        outputsValid: [true],
        feeRate: 0,
      });
      expect(validateOutputsStep(state)).toBe(false);
    });

    it('returns false when feeRate is negative', () => {
      const state = createMockState({
        outputs: [{ address: 'bc1q...', amount: '100000' }],
        outputsValid: [true],
        feeRate: -1,
      });
      expect(validateOutputsStep(state)).toBe(false);
    });

    it('returns true for valid output with positive feeRate', () => {
      const state = createMockState({
        outputs: [{ address: 'bc1q...', amount: '100000' }],
        outputsValid: [true],
        feeRate: 5,
      });
      expect(validateOutputsStep(state)).toBe(true);
    });

    it('returns true for multiple valid outputs', () => {
      const state = createMockState({
        outputs: [
          { address: 'bc1q...', amount: '100000' },
          { address: 'bc1p...', amount: '50000' },
        ],
        outputsValid: [true, true],
        feeRate: 3,
      });
      expect(validateOutputsStep(state)).toBe(true);
    });

    it('returns false if any output is invalid in multi-output', () => {
      const state = createMockState({
        outputs: [
          { address: 'bc1q...', amount: '100000' },
          { address: 'invalid', amount: '50000' },
        ],
        outputsValid: [true, false],
        feeRate: 3,
      });
      expect(validateOutputsStep(state)).toBe(false);
    });

    it('returns false with outputsValid containing null (pending validation)', () => {
      const state = createMockState({
        outputs: [{ address: 'bc1q...', amount: '100000' }],
        outputsValid: [null],
        feeRate: 1,
      });
      // null means "not yet validated", code requires explicit true
      expect(validateOutputsStep(state)).toBe(false);
    });
  });

  describe('validateReviewStep', () => {
    it('always returns true', () => {
      const state = createMockState();
      expect(validateReviewStep(state)).toBe(true);
    });

    it('returns true regardless of state', () => {
      const state = createMockState({
        transactionType: null,
        outputs: [],
        feeRate: 0,
      });
      expect(validateReviewStep(state)).toBe(true);
    });
  });

  describe('stepValidators', () => {
    it('has validators for all steps', () => {
      expect(stepValidators.type).toBe(validateTypeStep);
      expect(stepValidators.outputs).toBe(validateOutputsStep);
      expect(stepValidators.review).toBe(validateReviewStep);
    });
  });

  describe('isStepValid', () => {
    it('validates type step correctly', () => {
      const validState = createMockState({ transactionType: 'standard' });
      const invalidState = createMockState({ transactionType: null });

      expect(isStepValid('type', validState)).toBe(true);
      expect(isStepValid('type', invalidState)).toBe(false);
    });

    it('validates outputs step correctly', () => {
      const validState = createMockState({
        outputs: [{ address: 'bc1q...', amount: '100000' }],
        outputsValid: [true],
        feeRate: 1,
      });
      const invalidState = createMockState({
        outputs: [],
        feeRate: 1,
      });

      expect(isStepValid('outputs', validState)).toBe(true);
      expect(isStepValid('outputs', invalidState)).toBe(false);
    });

    it('validates review step correctly', () => {
      const state = createMockState();
      expect(isStepValid('review', state)).toBe(true);
    });

    it('returns false for unsupported step keys', () => {
      const state = createMockState();
      expect(isStepValid('unsupported' as WizardStep, state)).toBe(false);
    });
  });

  describe('canProceedToNextStep', () => {
    it('returns true when current step is valid', () => {
      const state = createMockState({
        currentStep: 'type',
        transactionType: 'standard',
      });
      expect(canProceedToNextStep(state)).toBe(true);
    });

    it('returns false when current step is invalid', () => {
      const state = createMockState({
        currentStep: 'type',
        transactionType: null,
      });
      expect(canProceedToNextStep(state)).toBe(false);
    });

    it('checks outputs step correctly', () => {
      const validState = createMockState({
        currentStep: 'outputs',
        outputs: [{ address: 'bc1q...', amount: '100000' }],
        outputsValid: [true],
        feeRate: 1,
      });
      const invalidState = createMockState({
        currentStep: 'outputs',
        outputs: [],
        feeRate: 1,
      });

      expect(canProceedToNextStep(validState)).toBe(true);
      expect(canProceedToNextStep(invalidState)).toBe(false);
    });
  });

  describe('getStepErrors', () => {
    describe('type step errors', () => {
      it('returns error when transactionType is null', () => {
        const state = createMockState({ transactionType: null });
        const errors = getStepErrors('type', state);
        expect(errors).toContain('Please select a transaction type');
      });

      it('returns empty array when transactionType is set', () => {
        const state = createMockState({ transactionType: 'standard' });
        const errors = getStepErrors('type', state);
        expect(errors).toEqual([]);
      });
    });

    describe('outputs step errors', () => {
      it('returns error when no outputs', () => {
        const state = createMockState({ outputs: [], feeRate: 1 });
        const errors = getStepErrors('outputs', state);
        expect(errors).toContain('At least one output is required');
      });

      it('returns error when address is missing', () => {
        const state = createMockState({
          outputs: [{ address: '', amount: '100000' }],
          outputsValid: [true],
          feeRate: 1,
        });
        const errors = getStepErrors('outputs', state);
        expect(errors.some(e => e.includes('Address is required'))).toBe(true);
      });

      it('returns error when address is invalid', () => {
        const state = createMockState({
          outputs: [{ address: 'invalid', amount: '100000' }],
          outputsValid: [false],
          feeRate: 1,
        });
        const errors = getStepErrors('outputs', state);
        expect(errors.some(e => e.includes('Invalid Bitcoin address'))).toBe(true);
      });

      it('returns error when amount is missing (non-sendMax)', () => {
        const state = createMockState({
          outputs: [{ address: 'bc1q...', amount: '' }],
          outputsValid: [true],
          feeRate: 1,
        });
        const errors = getStepErrors('outputs', state);
        expect(errors.some(e => e.includes('Amount is required'))).toBe(true);
      });

      it('does not return amount error for sendMax', () => {
        const state = createMockState({
          outputs: [{ address: 'bc1q...', amount: '', sendMax: true }],
          outputsValid: [true],
          feeRate: 1,
        });
        const errors = getStepErrors('outputs', state);
        expect(errors.some(e => e.includes('Amount is required'))).toBe(false);
      });

      it('returns error when feeRate is zero', () => {
        const state = createMockState({
          outputs: [{ address: 'bc1q...', amount: '100000' }],
          outputsValid: [true],
          feeRate: 0,
        });
        const errors = getStepErrors('outputs', state);
        expect(errors).toContain('Fee rate must be greater than 0');
      });

      it('returns multiple errors for multiple issues', () => {
        const state = createMockState({
          outputs: [
            { address: '', amount: '' },
            { address: 'invalid', amount: '100000' },
          ],
          outputsValid: [null, false],
          feeRate: 0,
        });
        const errors = getStepErrors('outputs', state);
        expect(errors.length).toBeGreaterThan(2);
      });

      it('includes output index in error messages', () => {
        const state = createMockState({
          outputs: [
            { address: 'bc1q...', amount: '100000' },
            { address: '', amount: '' },
          ],
          outputsValid: [true, null],
          feeRate: 1,
        });
        const errors = getStepErrors('outputs', state);
        expect(errors.some(e => e.includes('Output 2:'))).toBe(true);
      });
    });

    describe('review step errors', () => {
      it('returns empty array', () => {
        const state = createMockState();
        const errors = getStepErrors('review', state);
        expect(errors).toEqual([]);
      });
    });
  });

  describe('isReadyToSign', () => {
    it('returns true when type and outputs are valid', () => {
      const state = createMockState({
        transactionType: 'standard',
        outputs: [{ address: 'bc1q...', amount: '100000' }],
        outputsValid: [true],
        feeRate: 1,
      });
      expect(isReadyToSign(state)).toBe(true);
    });

    it('returns false when type is invalid', () => {
      const state = createMockState({
        transactionType: null,
        outputs: [{ address: 'bc1q...', amount: '100000' }],
        outputsValid: [true],
        feeRate: 1,
      });
      expect(isReadyToSign(state)).toBe(false);
    });

    it('returns false when outputs are invalid', () => {
      const state = createMockState({
        transactionType: 'standard',
        outputs: [],
        feeRate: 1,
      });
      expect(isReadyToSign(state)).toBe(false);
    });

    it('returns false when feeRate is invalid', () => {
      const state = createMockState({
        transactionType: 'standard',
        outputs: [{ address: 'bc1q...', amount: '100000' }],
        outputsValid: [true],
        feeRate: 0,
      });
      expect(isReadyToSign(state)).toBe(false);
    });
  });
});
