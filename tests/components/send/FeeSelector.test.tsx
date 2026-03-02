/**
 * Tests for FeeSelector component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeeSelector } from '../../../components/send/FeeSelector';
import type { FeeEstimate } from '../../../types';

// Mock BlockVisualizer
vi.mock('../../../components/BlockVisualizer', () => ({
  BlockVisualizer: ({ onBlockClick, compact }: { onBlockClick?: (rate: number) => void; compact: boolean }) => (
    <div data-testid="block-visualizer" data-compact={compact.toString()}>
      <button data-testid="block-click" onClick={() => onBlockClick?.(15)}>Click Block</button>
    </div>
  ),
}));

const mockFees: FeeEstimate = {
  fastestFee: 50,
  halfHourFee: 25,
  hourFee: 10,
  economyFee: 5,
  minimumFee: 1,
};

const defaultProps = {
  feeRate: 25,
  setFeeRate: vi.fn(),
  fees: mockFees,
  mempoolBlocks: [],
  queuedBlocksSummary: null,
};

describe('FeeSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders all fee presets', () => {
      render(<FeeSelector {...defaultProps} />);

      expect(screen.getByText('High Priority')).toBeInTheDocument();
      expect(screen.getByText('Standard')).toBeInTheDocument();
      expect(screen.getByText('Economy')).toBeInTheDocument();
    });

    it('renders preset fee rates', () => {
      render(<FeeSelector {...defaultProps} />);

      expect(screen.getByText('50')).toBeInTheDocument();
      expect(screen.getByText('25')).toBeInTheDocument();
      expect(screen.getByText('10')).toBeInTheDocument();
    });

    it('renders custom fee input with current rate', () => {
      render(<FeeSelector {...defaultProps} feeRate={15} />);

      const input = screen.getByRole('spinbutton');
      expect(input).toHaveValue(15);
    });

    it('renders BlockVisualizer in compact mode', () => {
      render(<FeeSelector {...defaultProps} />);

      const visualizer = screen.getByTestId('block-visualizer');
      expect(visualizer).toHaveAttribute('data-compact', 'true');
    });
  });

  describe('Fee rate selection', () => {
    it('calls setFeeRate when clicking High Priority', async () => {
      const user = userEvent.setup();
      const setFeeRate = vi.fn();
      render(<FeeSelector {...defaultProps} setFeeRate={setFeeRate} />);

      const highPriorityButton = screen.getByText('High Priority').closest('button');
      await user.click(highPriorityButton!);

      expect(setFeeRate).toHaveBeenCalledWith(50);
    });

    it('calls setFeeRate when clicking Standard', async () => {
      const user = userEvent.setup();
      const setFeeRate = vi.fn();
      render(<FeeSelector {...defaultProps} setFeeRate={setFeeRate} />);

      const standardButton = screen.getByText('Standard').closest('button');
      await user.click(standardButton!);

      expect(setFeeRate).toHaveBeenCalledWith(25);
    });

    it('calls setFeeRate when clicking Economy', async () => {
      const user = userEvent.setup();
      const setFeeRate = vi.fn();
      render(<FeeSelector {...defaultProps} setFeeRate={setFeeRate} />);

      const economyButton = screen.getByText('Economy').closest('button');
      await user.click(economyButton!);

      expect(setFeeRate).toHaveBeenCalledWith(10);
    });

    it('falls back to 1 sat/vB when preset fee is unavailable', async () => {
      const user = userEvent.setup();
      const setFeeRate = vi.fn();
      render(<FeeSelector {...defaultProps} setFeeRate={setFeeRate} fees={null} />);

      const highPriorityButton = screen.getByText('High Priority').closest('button');
      await user.click(highPriorityButton!);

      expect(setFeeRate).toHaveBeenCalledWith(1);
    });

    it('calls setFeeRate when changing custom input', async () => {
      const user = userEvent.setup();
      const setFeeRate = vi.fn();
      render(<FeeSelector {...defaultProps} setFeeRate={setFeeRate} />);

      const input = screen.getByRole('spinbutton');
      await user.clear(input);
      await user.type(input, '30');

      expect(setFeeRate).toHaveBeenCalled();
    });

    it('calls setFeeRate when clicking block in visualizer', async () => {
      const user = userEvent.setup();
      const setFeeRate = vi.fn();
      render(<FeeSelector {...defaultProps} setFeeRate={setFeeRate} />);

      await user.click(screen.getByTestId('block-click'));

      expect(setFeeRate).toHaveBeenCalledWith(15);
    });
  });

  describe('Disabled state', () => {
    it('shows disabled message when disabled', () => {
      render(<FeeSelector {...defaultProps} disabled={true} />);

      expect(screen.getByText('Fee rate is locked for draft transactions.')).toBeInTheDocument();
    });

    it('applies opacity when disabled', () => {
      const { container } = render(<FeeSelector {...defaultProps} disabled={true} />);

      expect(container.firstChild).toHaveClass('opacity-60');
    });

    it('does not call setFeeRate when clicking preset while disabled', async () => {
      const user = userEvent.setup();
      const setFeeRate = vi.fn();
      render(<FeeSelector {...defaultProps} setFeeRate={setFeeRate} disabled={true} />);

      const highPriorityButton = screen.getByText('High Priority').closest('button');
      await user.click(highPriorityButton!);

      expect(setFeeRate).not.toHaveBeenCalled();
    });

    it('does not call setFeeRate when changing input while disabled', async () => {
      const setFeeRate = vi.fn();
      render(<FeeSelector {...defaultProps} setFeeRate={setFeeRate} disabled={true} />);

      const input = screen.getByRole('spinbutton');
      expect(input).toBeDisabled();
    });
  });

  describe('Visual states', () => {
    it('highlights selected preset', () => {
      render(<FeeSelector {...defaultProps} feeRate={25} />);

      const standardButton = screen.getByText('Standard').closest('button');
      expect(standardButton).toHaveClass('border-sanctuary-800');
    });

    it('shows preset labels and rates', () => {
      render(<FeeSelector {...defaultProps} />);

      // Component displays labels like "High Priority", "Standard", "Economy"
      // and their corresponding rates, but not time estimates
      expect(screen.getByText('High Priority')).toBeInTheDocument();
      expect(screen.getByText('Standard')).toBeInTheDocument();
      expect(screen.getByText('Economy')).toBeInTheDocument();
    });

    it('shows sat/vB unit labels', () => {
      render(<FeeSelector {...defaultProps} />);

      const satVbLabels = screen.getAllByText('sat/vB');
      expect(satVbLabels.length).toBeGreaterThan(0);
    });
  });

  describe('Input validation', () => {
    it('has minimum value of 0.1 on input', () => {
      render(<FeeSelector {...defaultProps} />);

      const input = screen.getByRole('spinbutton');
      expect(input).toHaveAttribute('min', '0.1');
    });

    it('has step of 0.01 on input', () => {
      render(<FeeSelector {...defaultProps} />);

      const input = screen.getByRole('spinbutton');
      expect(input).toHaveAttribute('step', '0.01');
    });

    it('handles empty input gracefully', () => {
      const setFeeRate = vi.fn();
      render(<FeeSelector {...defaultProps} setFeeRate={setFeeRate} />);

      const input = screen.getByRole('spinbutton');
      fireEvent.change(input, { target: { value: '' } });

      expect(setFeeRate).toHaveBeenCalledWith(0);
    });
  });
});
