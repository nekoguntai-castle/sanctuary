/**
 * Tests for SendTransactionContext
 *
 * Tests the transaction wizard context provider and hooks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import {
  SendTransactionProvider,
  useSendTransaction,
  useSendTransactionDispatch,
} from '../../../contexts/send/SendTransactionContext';
import type { Wallet, Device, UTXO, FeeEstimate } from '../../../types';

// Test fixtures
const mockWallet: Wallet = {
  id: 'wallet-1',
  name: 'Test Wallet',
  type: 'single_sig',
  scriptType: 'native_segwit',
  network: 'mainnet',
  balance: 1000000,
};

const mockDevices: Device[] = [
  {
    id: 'device-1',
    type: 'Trezor',
    label: 'My Trezor',
    fingerprint: 'abc123',
  },
];

const mockUtxos: UTXO[] = [
  {
    txid: 'tx1',
    vout: 0,
    amount: 500000,
    address: 'bc1qtest1',
    confirmations: 6,
    frozen: false,
    spent: false,
  },
  {
    txid: 'tx2',
    vout: 1,
    amount: 500000,
    address: 'bc1qtest2',
    confirmations: 3,
    frozen: false,
    spent: false,
  },
];

const mockFees: FeeEstimate = {
  fastestFee: 50,
  halfHourFee: 25,
  hourFee: 10,
  economyFee: 5,
  minimumFee: 1,
};

const mockWalletAddresses = [
  { address: 'bc1qreceive1', used: false, index: 0 },
  { address: 'bc1qreceive2', used: true, index: 1 },
];

// Test component that exposes context values
function TestConsumer({ onMount }: { onMount?: (ctx: ReturnType<typeof useSendTransaction>) => void }) {
  const ctx = useSendTransaction();

  React.useEffect(() => {
    if (onMount) onMount(ctx);
  }, []);

  return (
    <div>
      <span data-testid="current-step">{ctx.currentStep}</span>
      <span data-testid="can-go-next">{ctx.canGoNext.toString()}</span>
      <span data-testid="can-go-back">{ctx.canGoBack.toString()}</span>
      <span data-testid="selected-total">{ctx.selectedTotal}</span>
      <span data-testid="tx-type">{ctx.state.transactionType || 'none'}</span>
      <span data-testid="outputs-count">{ctx.state.outputs.length}</span>
      <span data-testid="fee-rate">{ctx.state.feeRate}</span>
      <span data-testid="rbf-enabled">{ctx.state.rbfEnabled.toString()}</span>
      <span data-testid="show-coin-control">{ctx.state.showCoinControl.toString()}</span>
      <span data-testid="selected-utxos-count">{ctx.state.selectedUTXOs.size}</span>
      <span data-testid="first-output-sendmax">{ctx.state.outputs[0]?.sendMax?.toString() || 'false'}</span>
      <span data-testid="first-output-address">{ctx.state.outputs[0]?.address || ''}</span>
      <span data-testid="first-output-amount">{ctx.state.outputs[0]?.amount || ''}</span>
      <span data-testid="subtract-fees">{ctx.state.subtractFees.toString()}</span>
      <span data-testid="use-decoys">{ctx.state.useDecoys.toString()}</span>
      <span data-testid="decoy-count">{ctx.state.decoyCount}</span>
      <span data-testid="can-jump-outputs">{ctx.canJumpTo('outputs').toString()}</span>
      <span data-testid="is-send-max">{ctx.isSendMax.toString()}</span>
      <span data-testid="is-type-step-complete">{ctx.isStepComplete('type').toString()}</span>
      <button data-testid="next" onClick={ctx.nextStep}>Next</button>
      <button data-testid="prev" onClick={ctx.prevStep}>Prev</button>
      <button data-testid="go-to-type" onClick={() => ctx.goToStep('type')}>Go To Type</button>
      <button data-testid="go-to-outputs" onClick={() => ctx.goToStep('outputs')}>Go To Outputs</button>
      <button data-testid="set-standard" onClick={() => ctx.setTransactionType('standard')}>Standard</button>
      <button data-testid="set-consolidation" onClick={() => ctx.setTransactionType('consolidation')}>Consolidation</button>
      <button data-testid="add-output" onClick={ctx.addOutput}>Add Output</button>
      <button data-testid="remove-output" onClick={() => ctx.removeOutput(0)}>Remove Output</button>
      <button data-testid="set-output-address" onClick={() => ctx.updateOutputAddress(0, 'bc1qupdated')}>Set Address</button>
      <button data-testid="set-output-amount" onClick={() => ctx.updateOutputAmount(0, '12345', '0.00012345')}>Set Amount</button>
      <button data-testid="toggle-send-max" onClick={() => ctx.toggleSendMax(0)}>Toggle Send Max</button>
      <button data-testid="set-fee-rate" onClick={() => ctx.setFeeRate(42)}>Set Fee Rate</button>
      <button data-testid="toggle-rbf" onClick={ctx.toggleRbf}>Toggle RBF</button>
      <button data-testid="toggle-subtract-fees" onClick={ctx.toggleSubtractFees}>Toggle Subtract Fees</button>
      <button data-testid="toggle-decoys" onClick={ctx.toggleDecoys}>Toggle Decoys</button>
      <button data-testid="set-decoy-count" onClick={() => ctx.setDecoyCount(5)}>Set Decoy Count</button>
      <button data-testid="toggle-coin-control" onClick={ctx.toggleCoinControl}>Toggle Coin Control</button>
      <button data-testid="toggle-utxo" onClick={() => ctx.toggleUtxo('tx1:0')}>Toggle UTXO</button>
      <button data-testid="select-all" onClick={ctx.selectAllUtxos}>Select All UTXOs</button>
      <button data-testid="clear-selection" onClick={ctx.clearUtxoSelection}>Clear Selection</button>
      <button
        data-testid="load-draft"
        onClick={() =>
          ctx.loadDraft({
            transactionType: 'standard',
            outputs: [{ address: 'bc1qdraft', amount: '777', sendMax: false }],
            feeRate: 9,
          })
        }
      >
        Load Draft
      </button>
      <button data-testid="reset" onClick={ctx.reset}>Reset</button>
    </div>
  );
}

function DispatchOnlyConsumer() {
  const dispatch = useSendTransactionDispatch();
  return (
    <button
      data-testid="dispatch-standard"
      onClick={() => dispatch({ type: 'SET_TRANSACTION_TYPE', txType: 'standard' })}
    >
      Dispatch Standard
    </button>
  );
}

function renderWithProvider(ui: React.ReactNode, props?: Partial<React.ComponentProps<typeof SendTransactionProvider>>) {
  return render(
    <SendTransactionProvider
      wallet={mockWallet}
      devices={mockDevices}
      utxos={mockUtxos}
      walletAddresses={mockWalletAddresses}
      fees={mockFees}
      {...props}
    >
      {ui}
    </SendTransactionProvider>
  );
}

describe('SendTransactionContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Provider initialization', () => {
    it('initializes with default state', () => {
      renderWithProvider(<TestConsumer />);

      expect(screen.getByTestId('current-step')).toHaveTextContent('type');
      expect(screen.getByTestId('tx-type')).toHaveTextContent('none');
      expect(screen.getByTestId('outputs-count')).toHaveTextContent('1');
      expect(screen.getByTestId('rbf-enabled')).toHaveTextContent('true');
    });

    it('uses halfHourFee as default fee rate', () => {
      renderWithProvider(<TestConsumer />);

      expect(screen.getByTestId('fee-rate')).toHaveTextContent('25');
    });

    it('falls back to fee rate 1 when fee estimates are unavailable', () => {
      renderWithProvider(<TestConsumer />, { fees: null });

      expect(screen.getByTestId('fee-rate')).toHaveTextContent('1');
    });

    it('calculates selected total from spendable UTXOs', () => {
      renderWithProvider(<TestConsumer />);

      // Total of both UTXOs (500000 + 500000)
      expect(screen.getByTestId('selected-total')).toHaveTextContent('1000000');
    });

    it('filters out frozen UTXOs from spendable', () => {
      const frozenUtxos: UTXO[] = [
        { ...mockUtxos[0], frozen: true },
        mockUtxos[1],
      ];

      renderWithProvider(<TestConsumer />, { utxos: frozenUtxos });

      // Only non-frozen UTXO
      expect(screen.getByTestId('selected-total')).toHaveTextContent('500000');
    });

    it('filters out spent UTXOs from spendable', () => {
      const spentUtxos: UTXO[] = [
        { ...mockUtxos[0], spent: true },
        mockUtxos[1],
      ];

      renderWithProvider(<TestConsumer />, { utxos: spentUtxos });

      expect(screen.getByTestId('selected-total')).toHaveTextContent('500000');
    });
  });

  describe('Navigation', () => {
    it('cannot go back from first step', () => {
      renderWithProvider(<TestConsumer />);

      expect(screen.getByTestId('can-go-back')).toHaveTextContent('false');
    });

    it('cannot proceed without selecting transaction type', () => {
      renderWithProvider(<TestConsumer />);

      expect(screen.getByTestId('can-go-next')).toHaveTextContent('false');
    });

    it('can proceed after selecting transaction type', async () => {
      const user = userEvent.setup();
      renderWithProvider(<TestConsumer />);

      await user.click(screen.getByTestId('set-standard'));

      expect(screen.getByTestId('can-go-next')).toHaveTextContent('true');
    });

    it('moves to next step on nextStep()', async () => {
      const user = userEvent.setup();
      renderWithProvider(<TestConsumer />);

      await user.click(screen.getByTestId('set-standard'));
      await user.click(screen.getByTestId('next'));

      expect(screen.getByTestId('current-step')).toHaveTextContent('outputs');
    });

    it('can go back after moving forward', async () => {
      const user = userEvent.setup();
      renderWithProvider(<TestConsumer />);

      await user.click(screen.getByTestId('set-standard'));
      await user.click(screen.getByTestId('next'));

      expect(screen.getByTestId('can-go-back')).toHaveTextContent('true');

      await user.click(screen.getByTestId('prev'));
      expect(screen.getByTestId('current-step')).toHaveTextContent('type');
    });

    it('blocks next-step progression from outputs when no spendable UTXOs are available', async () => {
      const user = userEvent.setup();
      renderWithProvider(<TestConsumer />, { utxos: [] });

      await user.click(screen.getByTestId('set-standard'));
      await user.click(screen.getByTestId('next'));

      expect(screen.getByTestId('current-step')).toHaveTextContent('outputs');
      expect(screen.getByTestId('can-go-next')).toHaveTextContent('false');
    });
  });

  describe('Transaction type selection', () => {
    it('sets standard transaction type', async () => {
      const user = userEvent.setup();
      renderWithProvider(<TestConsumer />);

      await user.click(screen.getByTestId('set-standard'));

      expect(screen.getByTestId('tx-type')).toHaveTextContent('standard');
    });

    it('sets consolidation transaction type with sendMax output', async () => {
      const user = userEvent.setup();
      renderWithProvider(<TestConsumer />);

      await user.click(screen.getByTestId('set-consolidation'));

      expect(screen.getByTestId('tx-type')).toHaveTextContent('consolidation');
      // Consolidation creates a single sendMax output - check via rendered DOM
      expect(screen.getByTestId('first-output-sendmax')).toHaveTextContent('true');
    });
  });

  describe('Output management', () => {
    it('starts with one empty output', () => {
      renderWithProvider(<TestConsumer />);

      expect(screen.getByTestId('outputs-count')).toHaveTextContent('1');
    });

    it('adds new output', async () => {
      const user = userEvent.setup();
      renderWithProvider(<TestConsumer />);

      await user.click(screen.getByTestId('add-output'));

      expect(screen.getByTestId('outputs-count')).toHaveTextContent('2');
    });

    it('removes output but keeps at least one', async () => {
      const user = userEvent.setup();
      renderWithProvider(<TestConsumer />);

      // Add then remove
      await user.click(screen.getByTestId('add-output'));
      expect(screen.getByTestId('outputs-count')).toHaveTextContent('2');

      await user.click(screen.getByTestId('remove-output'));
      expect(screen.getByTestId('outputs-count')).toHaveTextContent('1');

      // Cannot remove last output
      await user.click(screen.getByTestId('remove-output'));
      expect(screen.getByTestId('outputs-count')).toHaveTextContent('1');
    });
  });

  describe('Fee and RBF settings', () => {
    it('toggles RBF', async () => {
      const user = userEvent.setup();
      renderWithProvider(<TestConsumer />);

      expect(screen.getByTestId('rbf-enabled')).toHaveTextContent('true');

      await user.click(screen.getByTestId('toggle-rbf'));
      expect(screen.getByTestId('rbf-enabled')).toHaveTextContent('false');

      await user.click(screen.getByTestId('toggle-rbf'));
      expect(screen.getByTestId('rbf-enabled')).toHaveTextContent('true');
    });
  });

  describe('Coin control', () => {
    it('selects all UTXOs', async () => {
      const user = userEvent.setup();
      renderWithProvider(<TestConsumer />);

      await user.click(screen.getByTestId('select-all'));

      // Check that coin control is enabled and UTXOs are selected via DOM
      expect(screen.getByTestId('show-coin-control')).toHaveTextContent('true');
      expect(screen.getByTestId('selected-utxos-count')).toHaveTextContent('2');
    });

    it('clears UTXO selection', async () => {
      const user = userEvent.setup();
      renderWithProvider(<TestConsumer />);

      await user.click(screen.getByTestId('select-all'));
      await user.click(screen.getByTestId('clear-selection'));

      expect(screen.getByTestId('selected-utxos-count')).toHaveTextContent('0');
    });

    it('toggles coin control visibility', async () => {
      const user = userEvent.setup();
      renderWithProvider(<TestConsumer />);

      expect(screen.getByTestId('show-coin-control')).toHaveTextContent('false');

      await user.click(screen.getByTestId('toggle-coin-control'));
      expect(screen.getByTestId('show-coin-control')).toHaveTextContent('true');
    });
  });

  describe('Reset', () => {
    it('resets state to initial values', async () => {
      const user = userEvent.setup();
      renderWithProvider(<TestConsumer />);

      // Make changes
      await user.click(screen.getByTestId('set-standard'));
      await user.click(screen.getByTestId('add-output'));
      await user.click(screen.getByTestId('toggle-rbf'));

      expect(screen.getByTestId('tx-type')).toHaveTextContent('standard');
      expect(screen.getByTestId('outputs-count')).toHaveTextContent('2');
      expect(screen.getByTestId('rbf-enabled')).toHaveTextContent('false');

      // Reset
      await user.click(screen.getByTestId('reset'));

      expect(screen.getByTestId('tx-type')).toHaveTextContent('none');
      expect(screen.getByTestId('outputs-count')).toHaveTextContent('1');
      expect(screen.getByTestId('rbf-enabled')).toHaveTextContent('true');
    });
  });

  describe('Draft loading', () => {
    it('loads initial state from draft', () => {
      const initialState = {
        transactionType: 'standard' as const,
        outputs: [{ address: 'bc1qtest', amount: '50000', sendMax: false }],
        feeRate: 15,
      };

      let contextValue: ReturnType<typeof useSendTransaction> | undefined;
      renderWithProvider(
        <TestConsumer onMount={(ctx) => { contextValue = ctx; }} />,
        { initialState }
      );

      expect(contextValue?.state.transactionType).toBe('standard');
      expect(contextValue?.state.outputs[0].address).toBe('bc1qtest');
      expect(contextValue?.state.feeRate).toBe(15);
    });
  });

  describe('useSendTransactionDispatch hook', () => {
    it('throws when used outside provider', () => {
      // Component that uses the hook without provider
      const TestComponent = () => {
        useSendTransactionDispatch();
        return null;
      };

      // Suppress console.error for expected error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => render(<TestComponent />)).toThrow(
        'useSendTransactionDispatch must be used within a SendTransactionProvider'
      );

      consoleSpy.mockRestore();
    });

    it('returns dispatch function when used inside provider', async () => {
      const user = userEvent.setup();
      renderWithProvider(
        <>
          <TestConsumer />
          <DispatchOnlyConsumer />
        </>
      );

      await user.click(screen.getByTestId('dispatch-standard'));
      expect(screen.getByTestId('tx-type')).toHaveTextContent('standard');
    });
  });

  describe('useSendTransaction hook', () => {
    it('throws when used outside provider', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => render(<TestConsumer />)).toThrow(
        'useSendTransaction must be used within a SendTransactionProvider'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Computed values', () => {
    it('calculates estimated fee based on inputs and outputs', () => {
      let contextValue: ReturnType<typeof useSendTransaction> | undefined;
      renderWithProvider(
        <TestConsumer onMount={(ctx) => { contextValue = ctx; }} />
      );

      // Fee calculation uses default rate (25) and estimates based on UTXO count
      expect(contextValue?.estimatedFee).toBeGreaterThan(0);
    });

    it('calculates max sendable amount', () => {
      let contextValue: ReturnType<typeof useSendTransaction> | undefined;
      renderWithProvider(
        <TestConsumer onMount={(ctx) => { contextValue = ctx; }} />
      );

      // Max sendable = total - fee
      expect(contextValue?.maxSendableAmount).toBeLessThan(1000000);
      expect(contextValue?.maxSendableAmount).toBeGreaterThan(0);
    });

    it('identifies sendMax state', async () => {
      const user = userEvent.setup();
      renderWithProvider(<TestConsumer />);

      expect(screen.getByTestId('is-send-max')).toHaveTextContent('false');

      await user.click(screen.getByTestId('set-consolidation'));

      expect(screen.getByTestId('is-send-max')).toHaveTextContent('true');
    });
  });

  describe('Step validation', () => {
    it('reports step completion status', async () => {
      const user = userEvent.setup();
      renderWithProvider(<TestConsumer />);

      expect(screen.getByTestId('is-type-step-complete')).toHaveTextContent('false');

      await user.click(screen.getByTestId('set-standard'));

      expect(screen.getByTestId('is-type-step-complete')).toHaveTextContent('true');
    });

    it('reports step errors', () => {
      let contextValue: ReturnType<typeof useSendTransaction> | undefined;
      renderWithProvider(
        <TestConsumer onMount={(ctx) => { contextValue = ctx; }} />
      );

      // On type step without selection
      expect(contextValue?.stepErrors).toContain('Please select a transaction type');
    });
  });

  describe('Serialization', () => {
    it('returns serializable state', async () => {
      const user = userEvent.setup();

      let contextValue: ReturnType<typeof useSendTransaction> | undefined;
      renderWithProvider(
        <TestConsumer onMount={(ctx) => { contextValue = ctx; }} />
      );

      await user.click(screen.getByTestId('set-standard'));

      const serialized = contextValue?.getSerializableState();

      // Sets should be converted to arrays
      expect(Array.isArray(serialized?.completedSteps)).toBe(true);
      expect(Array.isArray(serialized?.selectedUTXOs)).toBe(true);
      expect(Array.isArray(serialized?.signedDevices)).toBe(true);

      // Should be JSON serializable
      expect(() => JSON.stringify(serialized)).not.toThrow();
    });
  });

  describe('Custom fee calculation', () => {
    it('uses provided calculateFee function', () => {
      const customCalculateFee = vi.fn().mockReturnValue(1000);

      let contextValue: ReturnType<typeof useSendTransaction> | undefined;
      renderWithProvider(
        <TestConsumer onMount={(ctx) => { contextValue = ctx; }} />,
        { calculateFee: customCalculateFee }
      );

      // Estimated fee should use custom calculation
      expect(contextValue?.estimatedFee).toBe(1000);
      expect(customCalculateFee).toHaveBeenCalled();
    });
  });

  describe('Additional callbacks', () => {
    it('covers navigation and convenience action wrappers', async () => {
      const user = userEvent.setup();
      renderWithProvider(<TestConsumer />);

      expect(screen.getByTestId('can-jump-outputs')).toHaveTextContent('false');
      await user.click(screen.getByTestId('go-to-outputs'));
      expect(screen.getByTestId('current-step')).toHaveTextContent('type');

      await user.click(screen.getByTestId('set-standard'));
      await user.click(screen.getByTestId('next'));
      expect(screen.getByTestId('can-jump-outputs')).toHaveTextContent('true');
      await user.click(screen.getByTestId('go-to-type'));
      expect(screen.getByTestId('current-step')).toHaveTextContent('type');

      await user.click(screen.getByTestId('set-output-address'));
      expect(screen.getByTestId('first-output-address')).toHaveTextContent('bc1qupdated');

      await user.click(screen.getByTestId('set-output-amount'));
      expect(screen.getByTestId('first-output-amount')).toHaveTextContent('12345');

      await user.click(screen.getByTestId('toggle-send-max'));
      expect(screen.getByTestId('first-output-sendmax')).toHaveTextContent('true');

      await user.click(screen.getByTestId('set-fee-rate'));
      expect(screen.getByTestId('fee-rate')).toHaveTextContent('42');

      await user.click(screen.getByTestId('toggle-subtract-fees'));
      expect(screen.getByTestId('subtract-fees')).toHaveTextContent('true');

      await user.click(screen.getByTestId('toggle-decoys'));
      expect(screen.getByTestId('use-decoys')).toHaveTextContent('true');

      await user.click(screen.getByTestId('set-decoy-count'));
      expect(screen.getByTestId('decoy-count')).toHaveTextContent('5');

      await user.click(screen.getByTestId('toggle-utxo'));
      expect(screen.getByTestId('selected-utxos-count')).toHaveTextContent('1');
      expect(screen.getByTestId('show-coin-control')).toHaveTextContent('true');

      await user.click(screen.getByTestId('load-draft'));
      expect(screen.getByTestId('fee-rate')).toHaveTextContent('9');
      expect(screen.getByTestId('first-output-address')).toHaveTextContent('bc1qdraft');
      expect(screen.getByTestId('first-output-amount')).toHaveTextContent('777');
    });
  });
});
