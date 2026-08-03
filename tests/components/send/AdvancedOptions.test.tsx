/**
 * Tests for AdvancedOptions component
 */

import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { AdvancedOptions } from '../../../src/components/send/AdvancedOptions';

describe('AdvancedOptions', () => {
  const defaultProps = {
    showAdvanced: false,
    setShowAdvanced: vi.fn(),
    enableRBF: true,
    setEnableRBF: vi.fn(),
    subtractFeesFromAmount: false,
    setSubtractFeesFromAmount: vi.fn(),
    enableDecoyOutputs: false,
    setEnableDecoyOutputs: vi.fn(),
    decoyCount: 2,
    setDecoyCount: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Collapsed state', () => {
    it('renders toggle button when collapsed', () => {
      render(<AdvancedOptions {...defaultProps} />);

      expect(screen.getByText('Advanced Options')).toBeInTheDocument();
    });

    it('does not show options content when collapsed', () => {
      render(<AdvancedOptions {...defaultProps} />);

      expect(screen.queryByText('Enable RBF')).not.toBeInTheDocument();
    });

    it('calls setShowAdvanced when clicking toggle', async () => {
      const user = userEvent.setup();
      const setShowAdvanced = vi.fn();
      render(<AdvancedOptions {...defaultProps} setShowAdvanced={setShowAdvanced} />);

      await user.click(screen.getByText('Advanced Options'));

      expect(setShowAdvanced).toHaveBeenCalledWith(true);
    });
  });

  describe('Expanded state', () => {
    it('shows all options when expanded', () => {
      render(<AdvancedOptions {...defaultProps} showAdvanced={true} />);

      expect(screen.getByText('Enable RBF')).toBeInTheDocument();
      expect(screen.getByText('Subtract fees from amount')).toBeInTheDocument();
      expect(screen.getByText('Stonewall-like Decoy Outputs')).toBeInTheDocument();
    });

    it('shows option descriptions', () => {
      render(<AdvancedOptions {...defaultProps} showAdvanced={true} />);

      expect(screen.getByText(/Replace-by-Fee allows you to bump the fee/)).toBeInTheDocument();
      expect(screen.getByText(/Deduct network fees from the amount sent/)).toBeInTheDocument();
      expect(screen.getByText(/Split change into multiple outputs/)).toBeInTheDocument();
    });

    it('collapses when clicking toggle again', async () => {
      const user = userEvent.setup();
      const setShowAdvanced = vi.fn();
      render(<AdvancedOptions {...defaultProps} showAdvanced={true} setShowAdvanced={setShowAdvanced} />);

      await user.click(screen.getByText('Advanced Options'));

      expect(setShowAdvanced).toHaveBeenCalledWith(false);
    });
  });

  describe('RBF toggle', () => {
    it('shows RBF as checked when enabled', () => {
      render(<AdvancedOptions {...defaultProps} showAdvanced={true} enableRBF={true} />);

      const checkbox = screen.getByRole('checkbox', { name: /Enable RBF/i });
      expect(checkbox).toBeChecked();
    });

    it('shows RBF as unchecked when disabled', () => {
      render(<AdvancedOptions {...defaultProps} showAdvanced={true} enableRBF={false} />);

      const checkbox = screen.getByRole('checkbox', { name: /Enable RBF/i });
      expect(checkbox).not.toBeChecked();
    });

    it('calls setEnableRBF when toggling', async () => {
      const user = userEvent.setup();
      const setEnableRBF = vi.fn();
      render(<AdvancedOptions {...defaultProps} showAdvanced={true} enableRBF={true} setEnableRBF={setEnableRBF} />);

      const checkbox = screen.getByRole('checkbox', { name: /Enable RBF/i });
      await user.click(checkbox);

      expect(setEnableRBF).toHaveBeenCalledWith(false);
    });
  });

  describe('Subtract fees toggle', () => {
    it('shows subtract fees as checked when enabled', () => {
      render(<AdvancedOptions {...defaultProps} showAdvanced={true} subtractFeesFromAmount={true} />);

      const checkbox = screen.getByRole('checkbox', { name: /Subtract fees from amount/i });
      expect(checkbox).toBeChecked();
    });

    it('calls setSubtractFeesFromAmount when toggling', async () => {
      const user = userEvent.setup();
      const setSubtractFeesFromAmount = vi.fn();
      render(
        <AdvancedOptions
          {...defaultProps}
          showAdvanced={true}
          subtractFeesFromAmount={false}
          setSubtractFeesFromAmount={setSubtractFeesFromAmount}
        />
      );

      const checkbox = screen.getByRole('checkbox', { name: /Subtract fees from amount/i });
      await user.click(checkbox);

      expect(setSubtractFeesFromAmount).toHaveBeenCalledWith(true);
    });
  });

  describe('Decoy outputs', () => {
    it('shows decoy checkbox unchecked by default', () => {
      render(<AdvancedOptions {...defaultProps} showAdvanced={true} />);

      const checkbox = screen.getByRole('checkbox', { name: /Stonewall-like Decoy Outputs/i });
      expect(checkbox).not.toBeChecked();
    });

    it('calls setEnableDecoyOutputs when toggling', async () => {
      const user = userEvent.setup();
      const setEnableDecoyOutputs = vi.fn();
      render(
        <AdvancedOptions
          {...defaultProps}
          showAdvanced={true}
          setEnableDecoyOutputs={setEnableDecoyOutputs}
        />
      );

      const checkbox = screen.getByRole('checkbox', { name: /Stonewall-like Decoy Outputs/i });
      await user.click(checkbox);

      expect(setEnableDecoyOutputs).toHaveBeenCalledWith(true);
    });

    it('shows decoy count selector when decoys are enabled', () => {
      render(<AdvancedOptions {...defaultProps} showAdvanced={true} enableDecoyOutputs={true} />);

      expect(screen.getByText('Number of outputs:')).toBeInTheDocument();
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('hides decoy count selector when decoys are disabled', () => {
      render(<AdvancedOptions {...defaultProps} showAdvanced={true} enableDecoyOutputs={false} />);

      expect(screen.queryByText('Number of outputs:')).not.toBeInTheDocument();
    });

    it('shows decoy count options', () => {
      render(<AdvancedOptions {...defaultProps} showAdvanced={true} enableDecoyOutputs={true} />);

      const select = screen.getByRole('combobox');
      expect(select).toHaveValue('2');

      // Check options exist
      expect(screen.getByText('2 outputs')).toBeInTheDocument();
      expect(screen.getByText('3 outputs')).toBeInTheDocument();
      expect(screen.getByText('4 outputs')).toBeInTheDocument();
    });

    it('calls setDecoyCount when changing selection', async () => {
      const user = userEvent.setup();
      const setDecoyCount = vi.fn();
      render(
        <AdvancedOptions
          {...defaultProps}
          showAdvanced={true}
          enableDecoyOutputs={true}
          setDecoyCount={setDecoyCount}
        />
      );

      const select = screen.getByRole('combobox');
      await user.selectOptions(select, '3');

      expect(setDecoyCount).toHaveBeenCalledWith(3);
    });

    it('shows vBytes estimate for decoy outputs', () => {
      render(<AdvancedOptions {...defaultProps} showAdvanced={true} enableDecoyOutputs={true} decoyCount={3} />);

      // 3 outputs = (3-1) * 34 = 68 vBytes
      expect(screen.getByText(/\+~68 vBytes/)).toBeInTheDocument();
    });
  });

  describe('Disabled state', () => {
    it('disables all controls when disabled', () => {
      render(<AdvancedOptions {...defaultProps} showAdvanced={true} disabled={true} />);

      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach(checkbox => {
        expect(checkbox).toBeDisabled();
      });
    });

    it('does not call setters when clicking disabled controls', async () => {
      const user = userEvent.setup();
      const setEnableRBF = vi.fn();
      render(
        <AdvancedOptions
          {...defaultProps}
          showAdvanced={true}
          disabled={true}
          setEnableRBF={setEnableRBF}
        />
      );

      const checkbox = screen.getByRole('checkbox', { name: /Enable RBF/i });
      await user.click(checkbox);

      expect(setEnableRBF).not.toHaveBeenCalled();
    });

    it('does not toggle visibility when disabled', async () => {
      const user = userEvent.setup();
      const setShowAdvanced = vi.fn();
      render(<AdvancedOptions {...defaultProps} disabled={true} setShowAdvanced={setShowAdvanced} />);

      await user.click(screen.getByText('Advanced Options'));

      expect(setShowAdvanced).not.toHaveBeenCalled();
    });

    it('applies opacity styling when disabled', () => {
      render(<AdvancedOptions {...defaultProps} showAdvanced={true} disabled={true} />);

      // Check for cursor-not-allowed class on checkbox labels (opacity may be on parent)
      const labels = screen.getAllByRole('checkbox').map(cb => cb.closest('label'));
      labels.forEach(label => {
        expect(label).toHaveClass('cursor-not-allowed');
      });
    });
  });

  describe('Hide header option', () => {
    it('hides header/toggle button when hideHeader is true', () => {
      render(<AdvancedOptions {...defaultProps} hideHeader={true} />);

      expect(screen.queryByText('Advanced Options')).not.toBeInTheDocument();
    });

    it('shows options content directly when hideHeader is true', () => {
      render(<AdvancedOptions {...defaultProps} hideHeader={true} />);

      // Options should be visible without needing to expand
      expect(screen.getByText('Enable RBF')).toBeInTheDocument();
      expect(screen.getByText('Subtract fees from amount')).toBeInTheDocument();
    });
  });
});
