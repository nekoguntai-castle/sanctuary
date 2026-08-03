/**
 * Tests for src/contexts/send/types.ts
 *
 * Tests state serialization/deserialization and wizard step navigation helpers.
 */

import { describe,expect,it } from 'vitest';
import {
canJumpToStep,
deserializeState,
getNextStep,
getPrevStep,
serializeState,
STEP_LABELS,
WIZARD_STEPS,
type SerializableTransactionState,
type TransactionState,
type WizardStep,
} from '../../src/contexts/send/types';

describe('send/types', () => {
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

  describe('WIZARD_STEPS and STEP_LABELS', () => {
    it('has correct wizard steps order', () => {
      expect(WIZARD_STEPS).toEqual(['type', 'outputs', 'review']);
    });

    it('has labels for all steps', () => {
      expect(STEP_LABELS.type).toBe('Type');
      expect(STEP_LABELS.outputs).toBe('Compose');
      expect(STEP_LABELS.review).toBe('Review');
    });
  });

  describe('serializeState', () => {
    it('converts Sets to arrays', () => {
      const state = createMockState({
        completedSteps: new Set(['type', 'outputs'] as WizardStep[]),
        selectedUTXOs: new Set(['utxo1', 'utxo2']),
        signedDevices: new Set(['device1']),
      });

      const serialized = serializeState(state);

      expect(Array.isArray(serialized.completedSteps)).toBe(true);
      expect(Array.isArray(serialized.selectedUTXOs)).toBe(true);
      expect(Array.isArray(serialized.signedDevices)).toBe(true);
    });

    it('preserves completedSteps contents', () => {
      const state = createMockState({
        completedSteps: new Set(['type', 'outputs'] as WizardStep[]),
      });

      const serialized = serializeState(state);

      expect(serialized.completedSteps).toContain('type');
      expect(serialized.completedSteps).toContain('outputs');
      expect(serialized.completedSteps.length).toBe(2);
    });

    it('preserves selectedUTXOs contents', () => {
      const state = createMockState({
        selectedUTXOs: new Set(['abc:0', 'def:1']),
      });

      const serialized = serializeState(state);

      expect(serialized.selectedUTXOs).toContain('abc:0');
      expect(serialized.selectedUTXOs).toContain('def:1');
    });

    it('preserves signedDevices contents', () => {
      const state = createMockState({
        signedDevices: new Set(['device-abc', 'device-def']),
      });

      const serialized = serializeState(state);

      expect(serialized.signedDevices).toContain('device-abc');
      expect(serialized.signedDevices).toContain('device-def');
    });

    it('preserves all other properties unchanged', () => {
      const state = createMockState({
        currentStep: 'outputs',
        transactionType: 'standard',
        feeRate: 5,
        rbfEnabled: false,
        payjoinUrl: 'https://payjoin.example.com',
        error: 'Some error',
      });

      const serialized = serializeState(state);

      expect(serialized.currentStep).toBe('outputs');
      expect(serialized.transactionType).toBe('standard');
      expect(serialized.feeRate).toBe(5);
      expect(serialized.rbfEnabled).toBe(false);
      expect(serialized.payjoinUrl).toBe('https://payjoin.example.com');
      expect(serialized.error).toBe('Some error');
    });

    it('handles empty Sets', () => {
      const state = createMockState();

      const serialized = serializeState(state);

      expect(serialized.completedSteps).toEqual([]);
      expect(serialized.selectedUTXOs).toEqual([]);
      expect(serialized.signedDevices).toEqual([]);
    });
  });

  describe('deserializeState', () => {
    it('converts arrays back to Sets', () => {
      const data: Partial<SerializableTransactionState> = {
        completedSteps: ['type', 'outputs'],
        selectedUTXOs: ['utxo1', 'utxo2'],
        signedDevices: ['device1'],
      };

      const deserialized = deserializeState(data);

      expect(deserialized.completedSteps instanceof Set).toBe(true);
      expect(deserialized.selectedUTXOs instanceof Set).toBe(true);
      expect(deserialized.signedDevices instanceof Set).toBe(true);
    });

    it('preserves Set contents after deserialization', () => {
      const data: Partial<SerializableTransactionState> = {
        completedSteps: ['type', 'outputs'],
        selectedUTXOs: ['utxo1', 'utxo2'],
        signedDevices: ['device1', 'device2'],
      };

      const deserialized = deserializeState(data);

      expect(deserialized.completedSteps?.has('type')).toBe(true);
      expect(deserialized.completedSteps?.has('outputs')).toBe(true);
      expect(deserialized.selectedUTXOs?.has('utxo1')).toBe(true);
      expect(deserialized.selectedUTXOs?.has('utxo2')).toBe(true);
      expect(deserialized.signedDevices?.has('device1')).toBe(true);
      expect(deserialized.signedDevices?.has('device2')).toBe(true);
    });

    it('handles partial data without Set properties', () => {
      const data: Partial<SerializableTransactionState> = {
        currentStep: 'review',
        feeRate: 10,
      };

      const deserialized = deserializeState(data);

      expect(deserialized.currentStep).toBe('review');
      expect(deserialized.feeRate).toBe(10);
      expect(deserialized.completedSteps).toBeUndefined();
    });

    it('preserves non-Set properties', () => {
      const data: Partial<SerializableTransactionState> = {
        currentStep: 'outputs',
        transactionType: 'consolidation',
        feeRate: 3,
        rbfEnabled: true,
        outputs: [{ address: 'bc1q...', amount: '100000' }],
      };

      const deserialized = deserializeState(data);

      expect(deserialized.currentStep).toBe('outputs');
      expect(deserialized.transactionType).toBe('consolidation');
      expect(deserialized.feeRate).toBe(3);
      expect(deserialized.rbfEnabled).toBe(true);
      expect(deserialized.outputs).toEqual([{ address: 'bc1q...', amount: '100000' }]);
    });

    it('handles empty data', () => {
      const deserialized = deserializeState({});
      expect(Object.keys(deserialized).length).toBe(0);
    });
  });

  describe('serializeState and deserializeState roundtrip', () => {
    it('roundtrips successfully', () => {
      const original = createMockState({
        currentStep: 'outputs',
        completedSteps: new Set(['type'] as WizardStep[]),
        transactionType: 'standard',
        selectedUTXOs: new Set(['utxo1', 'utxo2']),
        signedDevices: new Set(['device1']),
        feeRate: 5,
        rbfEnabled: false,
      });

      const serialized = serializeState(original);
      const deserialized = deserializeState(serialized);

      // Check Set properties
      expect(deserialized.completedSteps?.has('type')).toBe(true);
      expect(deserialized.selectedUTXOs?.has('utxo1')).toBe(true);
      expect(deserialized.selectedUTXOs?.has('utxo2')).toBe(true);
      expect(deserialized.signedDevices?.has('device1')).toBe(true);

      // Check non-Set properties
      expect(deserialized.currentStep).toBe('outputs');
      expect(deserialized.transactionType).toBe('standard');
      expect(deserialized.feeRate).toBe(5);
      expect(deserialized.rbfEnabled).toBe(false);
    });
  });

  describe('getNextStep', () => {
    it('returns next step from type', () => {
      expect(getNextStep('type')).toBe('outputs');
    });

    it('returns next step from outputs', () => {
      expect(getNextStep('outputs')).toBe('review');
    });

    it('returns null for last step (review)', () => {
      expect(getNextStep('review')).toBe(null);
    });
  });

  describe('getPrevStep', () => {
    it('returns null for first step (type)', () => {
      expect(getPrevStep('type')).toBe(null);
    });

    it('returns previous step from outputs', () => {
      expect(getPrevStep('outputs')).toBe('type');
    });

    it('returns previous step from review', () => {
      expect(getPrevStep('review')).toBe('outputs');
    });
  });

  describe('canJumpToStep', () => {
    it('allows jumping to current step', () => {
      const currentStep: WizardStep = 'outputs';
      const completedSteps = new Set<WizardStep>();

      expect(canJumpToStep('outputs', currentStep, completedSteps)).toBe(true);
    });

    it('allows jumping to completed step', () => {
      const currentStep: WizardStep = 'review';
      const completedSteps = new Set<WizardStep>(['type', 'outputs']);

      expect(canJumpToStep('type', currentStep, completedSteps)).toBe(true);
      expect(canJumpToStep('outputs', currentStep, completedSteps)).toBe(true);
    });

    it('disallows jumping to incomplete step', () => {
      const currentStep: WizardStep = 'type';
      const completedSteps = new Set<WizardStep>();

      expect(canJumpToStep('outputs', currentStep, completedSteps)).toBe(false);
      expect(canJumpToStep('review', currentStep, completedSteps)).toBe(false);
    });

    it('allows jumping to partially completed steps', () => {
      const currentStep: WizardStep = 'review';
      const completedSteps = new Set<WizardStep>(['type']); // outputs not completed

      expect(canJumpToStep('type', currentStep, completedSteps)).toBe(true);
      expect(canJumpToStep('outputs', currentStep, completedSteps)).toBe(false);
    });
  });
});
