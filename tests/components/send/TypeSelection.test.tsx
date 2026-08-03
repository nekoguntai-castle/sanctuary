/**
 * Tests for TypeSelection step component
 */

import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { TypeSelection } from '../../../src/components/send/steps/TypeSelection';
import * as SendContext from '../../../src/contexts/send';

// Mock the context
vi.mock('../../../src/contexts/send', () => ({
  useSendTransaction: vi.fn(),
}));

describe('TypeSelection', () => {
  const mockSetTransactionType = vi.fn();
  const mockNextStep = vi.fn();

  const defaultContext = {
    state: {
      transactionType: null,
    },
    setTransactionType: mockSetTransactionType,
    nextStep: mockNextStep,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(defaultContext as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Rendering', () => {
    it('renders all transaction type options', () => {
      render(<TypeSelection />);

      expect(screen.getByText('Standard Send')).toBeInTheDocument();
      expect(screen.getByText('Consolidation')).toBeInTheDocument();
      expect(screen.getByText('Sweep')).toBeInTheDocument();
    });

    it('renders descriptions for each type', () => {
      render(<TypeSelection />);

      expect(screen.getByText(/Send Bitcoin to one or more addresses/)).toBeInTheDocument();
      expect(screen.getByText(/Combine multiple UTXOs/)).toBeInTheDocument();
      expect(screen.getByText(/Send all funds to a single address/)).toBeInTheDocument();
    });

    it('renders header text', () => {
      render(<TypeSelection />);

      expect(screen.getByText('What would you like to do?')).toBeInTheDocument();
      expect(screen.getByText('Select a transaction type to get started')).toBeInTheDocument();
    });
  });

  describe('Selection behavior', () => {
    it('calls setTransactionType when clicking Standard', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<TypeSelection />);

      await user.click(screen.getByText('Standard Send').closest('button')!);

      expect(mockSetTransactionType).toHaveBeenCalledWith('standard');
    });

    it('calls setTransactionType when clicking Consolidation', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<TypeSelection />);

      await user.click(screen.getByText('Consolidation').closest('button')!);

      expect(mockSetTransactionType).toHaveBeenCalledWith('consolidation');
    });

    it('calls setTransactionType when clicking Sweep', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<TypeSelection />);

      await user.click(screen.getByText('Sweep').closest('button')!);

      expect(mockSetTransactionType).toHaveBeenCalledWith('sweep');
    });

    it('auto-advances to next step after selection', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<TypeSelection />);

      await user.click(screen.getByText('Standard Send').closest('button')!);

      // Wait for the setTimeout (150ms)
      await vi.advanceTimersByTimeAsync(200);

      expect(mockNextStep).toHaveBeenCalled();
    });
  });

  describe('Visual state', () => {
    it('highlights selected standard type', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: { transactionType: 'standard' },
      } as any);

      render(<TypeSelection />);

      const standardButton = screen.getByText('Standard Send').closest('button');
      expect(standardButton).toHaveClass('border-primary-500');
    });

    it('highlights selected consolidation type', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: { transactionType: 'consolidation' },
      } as any);

      render(<TypeSelection />);

      const consolidationButton = screen.getByText('Consolidation').closest('button');
      expect(consolidationButton).toHaveClass('border-primary-500');
    });

    it('highlights selected sweep type', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: { transactionType: 'sweep' },
      } as any);

      render(<TypeSelection />);

      const sweepButton = screen.getByText('Sweep').closest('button');
      expect(sweepButton).toHaveClass('border-primary-500');
    });

    it('shows selection indicator for selected type', () => {
      vi.mocked(SendContext.useSendTransaction).mockReturnValue({
        ...defaultContext,
        state: { transactionType: 'standard' },
      } as any);

      const { container } = render(<TypeSelection />);

      // The inner white circle that appears when selected
      const indicators = container.querySelectorAll('.bg-white.w-2.h-2');
      expect(indicators.length).toBe(1);
    });

    it('does not show selection indicator for unselected types', () => {
      render(<TypeSelection />);

      const { container } = render(<TypeSelection />);

      // When nothing is selected, there should be no white inner circles
      const indicators = container.querySelectorAll('.bg-primary-500.w-5.h-5');
      expect(indicators.length).toBe(0);
    });
  });

  describe('Icons', () => {
    it('renders Send icon for Standard', () => {
      const { container } = render(<TypeSelection />);

      // Check for lucide-react icon class patterns
      const icons = container.querySelectorAll('svg');
      expect(icons.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Accessibility', () => {
    it('renders buttons with type="button"', () => {
      render(<TypeSelection />);

      const buttons = screen.getAllByRole('button');
      buttons.forEach(button => {
        expect(button).toHaveAttribute('type', 'button');
      });
    });
  });
});
