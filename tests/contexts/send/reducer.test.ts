import { describe,expect,it } from 'vitest';
import {
createInitialState,
transactionReducer,
} from '../../../contexts/send/reducer';
import type {
OutputEntry,
TransactionAction,
WizardStep
} from '../../../contexts/send/types';

describe('transactionReducer', () => {
  describe('createInitialState', () => {
    it('should create initial state with default fee rate', () => {
      const state = createInitialState(10);

      expect(state.currentStep).toBe('type');
      expect(state.feeRate).toBe(10);
      expect(state.outputs).toHaveLength(1);
      expect(state.transactionType).toBeNull();
      expect(state.rbfEnabled).toBe(true);
    });

    it('should create state with default outputs', () => {
      const state = createInitialState();

      expect(state.outputs[0]).toEqual({
        address: '',
        amount: '',
        sendMax: false,
      });
    });

    it('should initialize sets correctly', () => {
      const state = createInitialState();

      expect(state.completedSteps).toBeInstanceOf(Set);
      expect(state.selectedUTXOs).toBeInstanceOf(Set);
      expect(state.signedDevices).toBeInstanceOf(Set);
      expect(state.completedSteps.size).toBe(0);
    });
  });

  describe('Navigation actions', () => {
    it('should go to next step', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'NEXT_STEP' };

      const newState = transactionReducer(state, action);

      expect(newState.currentStep).toBe('outputs');
      expect(newState.completedSteps.has('type')).toBe(true);
    });

    it('should not go to next step when already on last step', () => {
      const state = { ...createInitialState(), currentStep: 'success' as WizardStep };
      const action: TransactionAction = { type: 'NEXT_STEP' };

      const newState = transactionReducer(state, action);

      expect(newState).toBe(state);
    });

    it('should go to previous step', () => {
      const state = { ...createInitialState(), currentStep: 'outputs' as WizardStep };
      const action: TransactionAction = { type: 'PREV_STEP' };

      const newState = transactionReducer(state, action);

      expect(newState.currentStep).toBe('type');
    });

    it('should not go to previous step when already on first step', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'PREV_STEP' };

      const newState = transactionReducer(state, action);

      expect(newState).toBe(state);
    });

    it('should jump to specific step if allowed', () => {
      const state = createInitialState();
      state.completedSteps.add('outputs');

      const action: TransactionAction = { type: 'GO_TO_STEP', step: 'outputs' };

      const newState = transactionReducer(state, action);

      expect(newState.currentStep).toBe('outputs');
    });

    it('should not jump to uncompleted future step', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'GO_TO_STEP', step: 'review' };

      const newState = transactionReducer(state, action);

      // Should remain on current step
      expect(newState.currentStep).toBe('type');
    });

    it('should mark step as completed', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'MARK_STEP_COMPLETED', step: 'type' };

      const newState = transactionReducer(state, action);

      expect(newState.completedSteps.has('type')).toBe(true);
    });

    it('should unmark step as completed', () => {
      const state = createInitialState();
      state.completedSteps.add('type');

      const action: TransactionAction = { type: 'UNMARK_STEP_COMPLETED', step: 'type' };

      const newState = transactionReducer(state, action);

      expect(newState.completedSteps.has('type')).toBe(false);
    });
  });

  describe('Transaction type actions', () => {
    it('should set transaction type to standard', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_TRANSACTION_TYPE', txType: 'standard' };

      const newState = transactionReducer(state, action);

      expect(newState.transactionType).toBe('standard');
      expect(newState.outputs).toHaveLength(1);
      expect(newState.outputs[0].sendMax).toBe(false);
    });

    it('should not reset outputs when already standard', () => {
      const state = createInitialState();
      state.transactionType = 'standard';
      state.outputs = [{ address: 'bc1qalready', amount: '21000', sendMax: false }];
      state.outputsValid = [true];

      const action: TransactionAction = { type: 'SET_TRANSACTION_TYPE', txType: 'standard' };
      const newState = transactionReducer(state, action);

      expect(newState.outputs).toEqual([{ address: 'bc1qalready', amount: '21000', sendMax: false }]);
      expect(newState.outputsValid).toEqual([true]);
    });

    it('should set transaction type to consolidation with sendMax', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_TRANSACTION_TYPE', txType: 'consolidation' };

      const newState = transactionReducer(state, action);

      expect(newState.transactionType).toBe('consolidation');
      expect(newState.outputs).toHaveLength(1);
      expect(newState.outputs[0].sendMax).toBe(true);
    });

    it('should set transaction type to sweep with sendMax', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_TRANSACTION_TYPE', txType: 'sweep' };

      const newState = transactionReducer(state, action);

      expect(newState.transactionType).toBe('sweep');
      expect(newState.outputs[0].sendMax).toBe(true);
    });
  });

  describe('Output management actions', () => {
    it('should add new output', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'ADD_OUTPUT' };

      const newState = transactionReducer(state, action);

      expect(newState.outputs).toHaveLength(2);
      expect(newState.outputs[1]).toEqual({
        address: '',
        amount: '',
        sendMax: false,
      });
      expect(newState.outputsValid).toHaveLength(2);
    });

    it('should remove output', () => {
      const state = createInitialState();
      state.outputs = [
        { address: 'addr1', amount: '1000', sendMax: false },
        { address: 'addr2', amount: '2000', sendMax: false },
      ];
      state.outputsValid = [true, true];

      const action: TransactionAction = { type: 'REMOVE_OUTPUT', index: 0 };

      const newState = transactionReducer(state, action);

      expect(newState.outputs).toHaveLength(1);
      expect(newState.outputs[0].address).toBe('addr2');
      expect(newState.outputsValid).toHaveLength(1);
    });

    it('should not remove last output', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'REMOVE_OUTPUT', index: 0 };

      const newState = transactionReducer(state, action);

      expect(newState.outputs).toHaveLength(1);
    });

    it('should update output field', () => {
      const state = createInitialState();
      const action: TransactionAction = {
        type: 'UPDATE_OUTPUT',
        index: 0,
        field: 'address',
        value: 'bc1qtest',
      };

      const newState = transactionReducer(state, action);

      expect(newState.outputs[0].address).toBe('bc1qtest');
    });

    it('should clear amount and disable sendMax on other outputs via UPDATE_OUTPUT sendMax', () => {
      const state = createInitialState();
      state.outputs = [
        { address: 'bc1q1', amount: '1000', sendMax: true },
        { address: 'bc1q2', amount: '2000', sendMax: false },
      ];

      const action: TransactionAction = {
        type: 'UPDATE_OUTPUT',
        index: 1,
        field: 'sendMax',
        value: true,
      };

      const newState = transactionReducer(state, action);

      expect(newState.outputs[0].sendMax).toBe(false);
      expect(newState.outputs[1].sendMax).toBe(true);
      expect(newState.outputs[1].amount).toBe('');
    });

    it('should set output address', () => {
      const state = createInitialState();
      const action: TransactionAction = {
        type: 'SET_OUTPUT_ADDRESS',
        index: 0,
        address: 'bc1qnewaddress',
      };

      const newState = transactionReducer(state, action);

      expect(newState.outputs[0].address).toBe('bc1qnewaddress');
    });

    it('should set output amount', () => {
      const state = createInitialState();
      const action: TransactionAction = {
        type: 'SET_OUTPUT_AMOUNT',
        index: 0,
        amount: '50000',
        displayValue: '50000',
      };

      const newState = transactionReducer(state, action);

      expect(newState.outputs[0].amount).toBe('50000');
      expect(newState.outputs[0].displayValue).toBe('50000');
    });

    it('should toggle sendMax', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'TOGGLE_SEND_MAX', index: 0 };

      const newState = transactionReducer(state, action);

      expect(newState.outputs[0].sendMax).toBe(true);
      expect(newState.outputs[0].amount).toBe('');
    });

    it('should disable sendMax on other outputs when enabling', () => {
      const state = createInitialState();
      state.outputs = [
        { address: '', amount: '', sendMax: true },
        { address: '', amount: '', sendMax: false },
      ];

      const action: TransactionAction = { type: 'TOGGLE_SEND_MAX', index: 1 };

      const newState = transactionReducer(state, action);

      expect(newState.outputs[0].sendMax).toBe(false);
      expect(newState.outputs[1].sendMax).toBe(true);
    });

    it('should allow toggling sendMax off without clearing amount', () => {
      const state = createInitialState();
      state.outputs = [{ address: 'bc1qtoggle', amount: '3000', sendMax: true }];

      const action: TransactionAction = { type: 'TOGGLE_SEND_MAX', index: 0 };
      const newState = transactionReducer(state, action);

      expect(newState.outputs[0].sendMax).toBe(false);
      expect(newState.outputs[0].amount).toBe('3000');
    });

    it('should set all outputs', () => {
      const state = createInitialState();
      const newOutputs: OutputEntry[] = [
        { address: 'addr1', amount: '1000', sendMax: false },
        { address: 'addr2', amount: '2000', sendMax: false },
      ];
      const action: TransactionAction = { type: 'SET_OUTPUTS', outputs: newOutputs };

      const newState = transactionReducer(state, action);

      expect(newState.outputs).toEqual(newOutputs);
      expect(newState.outputsValid).toHaveLength(2);
    });

    it('should set outputs validation', () => {
      const state = createInitialState();
      const action: TransactionAction = {
        type: 'SET_OUTPUTS_VALID',
        valid: [true, false, true],
      };

      const newState = transactionReducer(state, action);

      expect(newState.outputsValid).toEqual([true, false, true]);
    });

    it('should clear sendMax when manually setting amount via UPDATE_OUTPUT', () => {
      const state = createInitialState();
      // First enable sendMax
      state.outputs = [{ address: 'bc1qtest', amount: '', sendMax: true }];

      // Then set an amount manually
      const action: TransactionAction = {
        type: 'UPDATE_OUTPUT',
        index: 0,
        field: 'amount',
        value: '50000',
      };

      const newState = transactionReducer(state, action);

      expect(newState.outputs[0].amount).toBe('50000');
      expect(newState.outputs[0].sendMax).toBe(false);
    });

    it('should not clear sendMax when setting empty amount via UPDATE_OUTPUT', () => {
      const state = createInitialState();
      state.outputs = [{ address: 'bc1qtest', amount: '1000', sendMax: true }];

      const action: TransactionAction = {
        type: 'UPDATE_OUTPUT',
        index: 0,
        field: 'amount',
        value: '',
      };

      const newState = transactionReducer(state, action);

      expect(newState.outputs[0].amount).toBe('');
      expect(newState.outputs[0].sendMax).toBe(true);
    });

    it('should clear sendMax when setting amount via SET_OUTPUT_AMOUNT', () => {
      const state = createInitialState();
      state.outputs = [{ address: 'bc1qtest', amount: '', sendMax: true }];

      const action: TransactionAction = {
        type: 'SET_OUTPUT_AMOUNT',
        index: 0,
        amount: '75000',
        displayValue: '75000',
      };

      const newState = transactionReducer(state, action);

      expect(newState.outputs[0].amount).toBe('75000');
      expect(newState.outputs[0].sendMax).toBe(false);
    });

    it('should not clear sendMax when setting empty amount via SET_OUTPUT_AMOUNT', () => {
      const state = createInitialState();
      state.outputs = [{ address: 'bc1qtest', amount: '1000', sendMax: true }];

      const action: TransactionAction = {
        type: 'SET_OUTPUT_AMOUNT',
        index: 0,
        amount: '',
        displayValue: '',
      };

      const newState = transactionReducer(state, action);

      expect(newState.outputs[0].amount).toBe('');
      expect(newState.outputs[0].sendMax).toBe(true);
    });

    it('should set scanning output index', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_SCANNING_OUTPUT_INDEX', index: 1 };

      const newState = transactionReducer(state, action);

      expect(newState.scanningOutputIndex).toBe(1);
    });
  });

  describe('Payjoin actions', () => {
    it('should set payjoin URL', () => {
      const state = createInitialState();
      const action: TransactionAction = {
        type: 'SET_PAYJOIN_URL',
        url: 'https://example.com/payjoin',
      };

      const newState = transactionReducer(state, action);

      expect(newState.payjoinUrl).toBe('https://example.com/payjoin');
    });

    it('should set payjoin status', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_PAYJOIN_STATUS', status: 'success' };

      const newState = transactionReducer(state, action);

      expect(newState.payjoinStatus).toBe('success');
    });
  });

  describe('Coin control actions', () => {
    it('should toggle coin control', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'TOGGLE_COIN_CONTROL' };

      const newState = transactionReducer(state, action);

      expect(newState.showCoinControl).toBe(true);
    });

    it('should set coin control visibility', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_SHOW_COIN_CONTROL', show: true };

      const newState = transactionReducer(state, action);

      expect(newState.showCoinControl).toBe(true);
    });

    it('should select UTXO', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SELECT_UTXO', utxoId: 'utxo-1' };

      const newState = transactionReducer(state, action);

      expect(newState.selectedUTXOs.has('utxo-1')).toBe(true);
      expect(newState.showCoinControl).toBe(true);
    });

    it('should deselect UTXO', () => {
      const state = createInitialState();
      state.selectedUTXOs.add('utxo-1');

      const action: TransactionAction = { type: 'DESELECT_UTXO', utxoId: 'utxo-1' };

      const newState = transactionReducer(state, action);

      expect(newState.selectedUTXOs.has('utxo-1')).toBe(false);
    });

    it('should toggle UTXO selection', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'TOGGLE_UTXO', utxoId: 'utxo-1' };

      const newState = transactionReducer(state, action);
      expect(newState.selectedUTXOs.has('utxo-1')).toBe(true);

      const newState2 = transactionReducer(newState, action);
      expect(newState2.selectedUTXOs.has('utxo-1')).toBe(false);
    });

    it('should select all UTXOs', () => {
      const state = createInitialState();
      const action: TransactionAction = {
        type: 'SELECT_ALL_UTXOS',
        utxoIds: ['utxo-1', 'utxo-2', 'utxo-3'],
      };

      const newState = transactionReducer(state, action);

      expect(newState.selectedUTXOs.size).toBe(3);
      expect(newState.selectedUTXOs.has('utxo-1')).toBe(true);
      expect(newState.selectedUTXOs.has('utxo-2')).toBe(true);
      expect(newState.selectedUTXOs.has('utxo-3')).toBe(true);
    });

    it('should clear UTXO selection', () => {
      const state = createInitialState();
      state.selectedUTXOs.add('utxo-1');
      state.selectedUTXOs.add('utxo-2');

      const action: TransactionAction = { type: 'CLEAR_UTXO_SELECTION' };

      const newState = transactionReducer(state, action);

      expect(newState.selectedUTXOs.size).toBe(0);
    });

    it('should set selected UTXOs from provided list', () => {
      const state = createInitialState();
      const action: TransactionAction = {
        type: 'SET_SELECTED_UTXOS',
        utxoIds: ['utxo-a', 'utxo-b'],
      };

      const newState = transactionReducer(state, action);

      expect(newState.selectedUTXOs.has('utxo-a')).toBe(true);
      expect(newState.selectedUTXOs.has('utxo-b')).toBe(true);
      expect(newState.selectedUTXOs.size).toBe(2);
    });
  });

  describe('Fee actions', () => {
    it('should set fee rate', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_FEE_RATE', rate: 25 };

      const newState = transactionReducer(state, action);

      expect(newState.feeRate).toBe(25);
    });

    it('should toggle RBF', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'TOGGLE_RBF' };

      const newState = transactionReducer(state, action);

      expect(newState.rbfEnabled).toBe(false);
    });

    it('should set RBF enabled', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_RBF_ENABLED', enabled: false };

      const newState = transactionReducer(state, action);

      expect(newState.rbfEnabled).toBe(false);
    });

    it('should toggle subtract fees', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'TOGGLE_SUBTRACT_FEES' };

      const newState = transactionReducer(state, action);

      expect(newState.subtractFees).toBe(true);
    });

    it('should set subtract fees', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_SUBTRACT_FEES', enabled: true };

      const newState = transactionReducer(state, action);

      expect(newState.subtractFees).toBe(true);
    });
  });

  describe('Decoy actions', () => {
    it('should toggle decoys', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'TOGGLE_DECOYS' };

      const newState = transactionReducer(state, action);

      expect(newState.useDecoys).toBe(true);
    });

    it('should set use decoys', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_USE_DECOYS', enabled: true };

      const newState = transactionReducer(state, action);

      expect(newState.useDecoys).toBe(true);
    });

    it('should set decoy count', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_DECOY_COUNT', count: 3 };

      const newState = transactionReducer(state, action);

      expect(newState.decoyCount).toBe(3);
    });
  });

  describe('Signing actions', () => {
    it('should set signing device', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_SIGNING_DEVICE', deviceId: 'device-1' };

      const newState = transactionReducer(state, action);

      expect(newState.signingDeviceId).toBe('device-1');
    });

    it('should set expanded device', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_EXPANDED_DEVICE', deviceId: 'device-1' };

      const newState = transactionReducer(state, action);

      expect(newState.expandedDeviceId).toBe('device-1');
    });

    it('should mark device as signed', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'MARK_DEVICE_SIGNED', deviceId: 'device-1' };

      const newState = transactionReducer(state, action);

      expect(newState.signedDevices.has('device-1')).toBe(true);
    });

    it('should set unsigned PSBT', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_UNSIGNED_PSBT', psbt: 'cHNidP8...' };

      const newState = transactionReducer(state, action);

      expect(newState.unsignedPsbt).toBe('cHNidP8...');
    });

    it('should toggle PSBT options', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'TOGGLE_PSBT_OPTIONS' };

      const newState = transactionReducer(state, action);

      expect(newState.showPsbtOptions).toBe(true);
    });

    it('should set PSBT options visibility explicitly', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_SHOW_PSBT_OPTIONS', show: true };

      const newState = transactionReducer(state, action);

      expect(newState.showPsbtOptions).toBe(true);
    });

    it('should set PSBT device id', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_PSBT_DEVICE_ID', deviceId: 'device-psbt' };

      const newState = transactionReducer(state, action);

      expect(newState.psbtDeviceId).toBe('device-psbt');
    });

    it('should clear signatures', () => {
      const state = createInitialState();
      state.signedDevices.add('device-1');
      state.unsignedPsbt = 'psbt';
      state.signingDeviceId = 'device-1';

      const action: TransactionAction = { type: 'CLEAR_SIGNATURES' };

      const newState = transactionReducer(state, action);

      expect(newState.signedDevices.size).toBe(0);
      expect(newState.unsignedPsbt).toBeNull();
      expect(newState.signingDeviceId).toBeNull();
    });

    it('should set signed devices', () => {
      const state = createInitialState();
      const action: TransactionAction = {
        type: 'SET_SIGNED_DEVICES',
        deviceIds: ['device-1', 'device-2'],
      };

      const newState = transactionReducer(state, action);

      expect(newState.signedDevices.size).toBe(2);
      expect(newState.signedDevices.has('device-1')).toBe(true);
      expect(newState.signedDevices.has('device-2')).toBe(true);
    });
  });

  describe('Draft actions', () => {
    it('should set draft ID', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_DRAFT_ID', id: 'draft-123' };

      const newState = transactionReducer(state, action);

      expect(newState.draftId).toBe('draft-123');
    });

    it('should set draft mode', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_DRAFT_MODE', isDraft: true };

      const newState = transactionReducer(state, action);

      expect(newState.isDraftMode).toBe(true);
    });

    it('should load draft', () => {
      const state = createInitialState();
      const action: TransactionAction = {
        type: 'LOAD_DRAFT',
        draft: {
          outputs: [{ address: 'bc1qtest', amount: '50000', sendMax: false }],
          feeRate: 15,
          rbfEnabled: false,
          selectedUTXOs: ['utxo-1', 'utxo-2'],
        },
      };

      const newState = transactionReducer(state, action);

      expect(newState.outputs).toEqual([
        { address: 'bc1qtest', amount: '50000', sendMax: false },
      ]);
      expect(newState.feeRate).toBe(15);
      expect(newState.rbfEnabled).toBe(false);
      expect(newState.selectedUTXOs.size).toBe(2);
      expect(newState.isDraftMode).toBe(true);
    });
  });

  describe('UI actions', () => {
    it('should set submitting state', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_SUBMITTING', isSubmitting: true };

      const newState = transactionReducer(state, action);

      expect(newState.isSubmitting).toBe(true);
    });

    it('should set error', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SET_ERROR', error: 'Test error' };

      const newState = transactionReducer(state, action);

      expect(newState.error).toBe('Test error');
    });

    it('should reset state', () => {
      const state = createInitialState(15);
      state.outputs = [{ address: 'bc1qtest', amount: '50000', sendMax: false }];
      state.error = 'Test error';
      state.currentStep = 'review';

      const action: TransactionAction = { type: 'RESET' };

      const newState = transactionReducer(state, action);

      expect(newState.currentStep).toBe('type');
      expect(newState.error).toBeNull();
      expect(newState.feeRate).toBe(15); // Preserves fee rate
      expect(newState.outputs).toEqual([
        { address: '', amount: '', sendMax: false },
      ]);
    });
  });

  describe('Immutability', () => {
    it('should not mutate original state', () => {
      const state = createInitialState();
      const originalOutputs = state.outputs;
      const originalSelectedUTXOs = state.selectedUTXOs;

      const action: TransactionAction = {
        type: 'SET_OUTPUT_ADDRESS',
        index: 0,
        address: 'bc1qtest',
      };

      const newState = transactionReducer(state, action);

      expect(state.outputs).toBe(originalOutputs);
      expect(state.selectedUTXOs).toBe(originalSelectedUTXOs);
      expect(newState.outputs).not.toBe(originalOutputs);
    });

    it('should create new Set instances', () => {
      const state = createInitialState();
      const action: TransactionAction = { type: 'SELECT_UTXO', utxoId: 'utxo-1' };

      const newState = transactionReducer(state, action);

      expect(newState.selectedUTXOs).not.toBe(state.selectedUTXOs);
    });

    it('should not mutate output entries when sendMax exclusivity changes', () => {
      const state = createInitialState();
      const firstOutput: OutputEntry = { address: 'bc1q1', amount: '1000', sendMax: true };
      const secondOutput: OutputEntry = { address: 'bc1q2', amount: '2000', sendMax: false };
      state.outputs = [firstOutput, secondOutput];

      const action: TransactionAction = {
        type: 'UPDATE_OUTPUT',
        index: 1,
        field: 'sendMax',
        value: true,
      };

      const newState = transactionReducer(state, action);

      expect(firstOutput.sendMax).toBe(true);
      expect(secondOutput.sendMax).toBe(false);
      expect(newState.outputs[0].sendMax).toBe(false);
      expect(newState.outputs[1].sendMax).toBe(true);
      expect(newState.outputs[0]).not.toBe(firstOutput);
      expect(newState.outputs[1]).not.toBe(secondOutput);
    });
  });

  describe('Default case', () => {
    it('should return unchanged state for unknown action', () => {
      const state = createInitialState();
      const action = { type: 'UNKNOWN_ACTION' } as any;

      const newState = transactionReducer(state, action);

      expect(newState).toBe(state);
    });
  });
});
