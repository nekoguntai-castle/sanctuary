import { describe, expect, it } from 'vitest';

import {
  createInitialState,
  transactionReducer,
} from '../../../../contexts/send/reducer';
import type {
  OutputEntry,
  TransactionAction,
} from '../../../../contexts/send/types';

export const registerOutputManagementReducerContracts = () => {
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
      state.outputs = [{ address: 'bc1qtest', amount: '', sendMax: true }];

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
};
