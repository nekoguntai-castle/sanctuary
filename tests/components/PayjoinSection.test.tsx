/**
 * Tests for components/PayjoinSection.tsx
 *
 * Tests the Payjoin toggle component including eligibility fetching,
 * status pills, tooltip display, and education modal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { PayjoinSection } from '../../components/PayjoinSection';
import * as payjoinApi from '../../src/api/payjoin';

// Mock the payjoin API
vi.mock('../../src/api/payjoin', () => ({
  checkPayjoinEligibility: vi.fn(),
}));

describe('PayjoinSection', () => {
  const defaultProps = {
    walletId: 'wallet-123',
    enabled: false,
    onToggle: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders the Enhanced Privacy label', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockResolvedValue({
        eligible: true,
        status: 'ready',
      });

      render(<PayjoinSection {...defaultProps} />);

      await waitFor(() => {
        expect(payjoinApi.checkPayjoinEligibility).toHaveBeenCalledWith('wallet-123');
      });

      expect(screen.getByText('Enhanced Privacy')).toBeInTheDocument();
    });

    it('renders the toggle switch', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockResolvedValue({
        eligible: true,
        status: 'ready',
      });

      render(<PayjoinSection {...defaultProps} />);

      await waitFor(() => {
        expect(payjoinApi.checkPayjoinEligibility).toHaveBeenCalledWith('wallet-123');
      });

      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('renders help icon button', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockResolvedValue({
        eligible: true,
        status: 'ready',
      });

      render(<PayjoinSection {...defaultProps} />);

      await waitFor(() => {
        expect(payjoinApi.checkPayjoinEligibility).toHaveBeenCalledWith('wallet-123');
      });

      expect(screen.getByLabelText('What is Payjoin?')).toBeInTheDocument();
    });
  });

  describe('eligibility fetching', () => {
    it('fetches eligibility on mount', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockResolvedValue({
        eligible: true,
        status: 'ready',
      });

      render(<PayjoinSection {...defaultProps} />);

      await waitFor(() => {
        expect(payjoinApi.checkPayjoinEligibility).toHaveBeenCalledWith('wallet-123');
      });
    });

    it('enables toggle when eligible', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockResolvedValue({
        eligible: true,
        status: 'ready',
      });

      render(<PayjoinSection {...defaultProps} />);

      await waitFor(() => {
        const toggle = screen.getByRole('switch');
        expect(toggle).not.toBeDisabled();
      });
    });

    it('disables toggle when not eligible', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockResolvedValue({
        eligible: false,
        status: 'no-utxos',
        reason: 'No confirmed coins available',
      });

      render(<PayjoinSection {...defaultProps} />);

      await waitFor(() => {
        const toggle = screen.getByRole('switch');
        expect(toggle).toBeDisabled();
      });
    });

    it('skips eligibility fetch when walletId is empty', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockResolvedValue({
        eligible: true,
        status: 'ready',
      });

      render(<PayjoinSection {...defaultProps} walletId="" />);

      await waitFor(() => {
        expect(screen.getByText('Enhanced Privacy')).toBeInTheDocument();
      });

      expect(payjoinApi.checkPayjoinEligibility).not.toHaveBeenCalled();
    });
  });

  describe('status pills', () => {
    it('shows "No coins" pill when status is no-utxos', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockResolvedValue({
        eligible: false,
        status: 'no-utxos',
      });

      render(<PayjoinSection {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('No coins')).toBeInTheDocument();
      });
    });

    it('shows "Pending" pill when status is pending-confirmations', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockResolvedValue({
        eligible: false,
        status: 'pending-confirmations',
      });

      render(<PayjoinSection {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Pending')).toBeInTheDocument();
      });
    });

    it('shows "Frozen" pill when status is all-frozen', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockResolvedValue({
        eligible: false,
        status: 'all-frozen',
      });

      render(<PayjoinSection {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Frozen')).toBeInTheDocument();
      });
    });

    it('shows "Locked" pill when status is all-locked', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockResolvedValue({
        eligible: false,
        status: 'all-locked',
      });

      render(<PayjoinSection {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Locked')).toBeInTheDocument();
      });
    });

    it('shows "Unavailable" pill when status is unavailable', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockResolvedValue({
        eligible: false,
        status: 'unavailable',
      });

      render(<PayjoinSection {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Unavailable')).toBeInTheDocument();
      });
    });

    it('does not show status pill when eligible (ready)', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockResolvedValue({
        eligible: true,
        status: 'ready',
      });

      render(<PayjoinSection {...defaultProps} />);

      await waitFor(() => {
        expect(payjoinApi.checkPayjoinEligibility).toHaveBeenCalled();
      });

      // Ready status should not show a pill
      expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    });
  });

  describe('toggle interaction', () => {
    it('calls onToggle when clicked', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockResolvedValue({
        eligible: true,
        status: 'ready',
      });

      const onToggle = vi.fn();
      render(<PayjoinSection {...defaultProps} onToggle={onToggle} />);

      await waitFor(() => {
        expect(screen.getByRole('switch')).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole('switch'));

      expect(onToggle).toHaveBeenCalledWith(true);
    });

    it('toggles to false when currently enabled', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockResolvedValue({
        eligible: true,
        status: 'ready',
      });

      const onToggle = vi.fn();
      render(<PayjoinSection {...defaultProps} enabled={true} onToggle={onToggle} />);

      await waitFor(() => {
        expect(screen.getByRole('switch')).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole('switch'));

      expect(onToggle).toHaveBeenCalledWith(false);
    });

    it('sets aria-checked correctly', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockResolvedValue({
        eligible: true,
        status: 'ready',
      });

      const { rerender } = render(<PayjoinSection {...defaultProps} enabled={false} />);

      await waitFor(() => {
        expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
      });

      rerender(<PayjoinSection {...defaultProps} enabled={true} />);

      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    });
  });

  describe('tooltip', () => {
    it('shows tooltip when help icon is clicked', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockImplementation(() => new Promise(() => {}));

      render(<PayjoinSection {...defaultProps} />);

      fireEvent.click(screen.getByLabelText('What is Payjoin?'));

      expect(screen.getByText('What is Payjoin?')).toBeInTheDocument();
      expect(screen.getByText(/Payjoin adds your coins/)).toBeInTheDocument();
    });

    it('hides tooltip when close button is clicked', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockImplementation(() => new Promise(() => {}));

      render(<PayjoinSection {...defaultProps} />);

      // Open tooltip
      fireEvent.click(screen.getByLabelText('What is Payjoin?'));

      // Find and click close button in tooltip
      const closeButtons = screen.getAllByRole('button');
      const tooltipCloseButton = closeButtons.find(btn =>
        btn.querySelector('svg.w-4.h-4')
      );
      if (tooltipCloseButton) {
        fireEvent.click(tooltipCloseButton);
      }

      // Tooltip should be hidden
      expect(screen.queryByText('Requirements:')).not.toBeInTheDocument();
    });

    it('shows eligibility reason in tooltip when unavailable', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockResolvedValue({
        eligible: false,
        status: 'no-utxos',
        reason: 'No confirmed coins available for Payjoin',
      });

      render(<PayjoinSection {...defaultProps} />);

      await waitFor(() => {
        expect(payjoinApi.checkPayjoinEligibility).toHaveBeenCalled();
      });

      // Open tooltip
      fireEvent.click(screen.getByLabelText('What is Payjoin?'));

      await waitFor(() => {
        expect(screen.getByText('No confirmed coins available for Payjoin')).toBeInTheDocument();
      });
    });

    it('shows "Learn more about Payjoin" link', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockImplementation(() => new Promise(() => {}));

      render(<PayjoinSection {...defaultProps} />);

      fireEvent.click(screen.getByLabelText('What is Payjoin?'));

      expect(screen.getByText('Learn more about Payjoin')).toBeInTheDocument();
    });

    it('closes tooltip on outside click and stays open on inside click', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockResolvedValue({
        eligible: false,
        status: 'no-utxos',
      });

      render(<PayjoinSection {...defaultProps} />);

      await waitFor(() => {
        expect(payjoinApi.checkPayjoinEligibility).toHaveBeenCalled();
      });

      fireEvent.click(screen.getByLabelText('What is Payjoin?'));
      expect(screen.getByText('What is Payjoin?')).toBeInTheDocument();

      fireEvent.mouseDown(screen.getByText(/Payjoin adds your coins/));
      expect(screen.getByText('What is Payjoin?')).toBeInTheDocument();

      fireEvent.mouseDown(document.body);
      await waitFor(() => {
        expect(screen.queryByText('What is Payjoin?')).not.toBeInTheDocument();
      });
    });

  });

  describe('education modal', () => {
    it('opens education modal when "Learn more" is clicked', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockImplementation(() => new Promise(() => {}));

      render(<PayjoinSection {...defaultProps} />);

      // Open tooltip
      fireEvent.click(screen.getByLabelText('What is Payjoin?'));

      // Click learn more
      fireEvent.click(screen.getByText('Learn more about Payjoin'));

      // Modal should be open
      expect(screen.getByText('Understanding Payjoin')).toBeInTheDocument();
      expect(screen.getByText('The Problem')).toBeInTheDocument();
      expect(screen.getByText('The Solution: Payjoin')).toBeInTheDocument();
    });

    it('closes education modal when X is clicked', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockImplementation(() => new Promise(() => {}));

      render(<PayjoinSection {...defaultProps} />);

      // Open tooltip then modal
      fireEvent.click(screen.getByLabelText('What is Payjoin?'));
      fireEvent.click(screen.getByText('Learn more about Payjoin'));

      // Find close button in modal header
      const modalCloseButton = screen.getAllByRole('button').find(btn =>
        btn.closest('.sticky')
      );
      if (modalCloseButton) {
        fireEvent.click(modalCloseButton);
      }

      await waitFor(() => {
        expect(screen.queryByText('Understanding Payjoin')).not.toBeInTheDocument();
      });
    });

    it('closes education modal on escape key', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockImplementation(() => new Promise(() => {}));

      render(<PayjoinSection {...defaultProps} />);

      // Open tooltip then modal
      fireEvent.click(screen.getByLabelText('What is Payjoin?'));
      fireEvent.click(screen.getByText('Learn more about Payjoin'));

      expect(screen.getByText('Understanding Payjoin')).toBeInTheDocument();

      // Press escape
      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByText('Understanding Payjoin')).not.toBeInTheDocument();
      });
    });

    it('keeps modal open on non-Escape key and on inside click', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockImplementation(() => new Promise(() => {}));

      render(<PayjoinSection {...defaultProps} />);

      fireEvent.click(screen.getByLabelText('What is Payjoin?'));
      fireEvent.click(screen.getByText('Learn more about Payjoin'));
      expect(screen.getByText('Understanding Payjoin')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Enter' });
      expect(screen.getByText('Understanding Payjoin')).toBeInTheDocument();

      fireEvent.click(screen.getByText('The Problem'));
      expect(screen.getByText('Understanding Payjoin')).toBeInTheDocument();
    });

    it('closes education modal on backdrop click', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockImplementation(() => new Promise(() => {}));

      render(<PayjoinSection {...defaultProps} />);

      fireEvent.click(screen.getByLabelText('What is Payjoin?'));
      fireEvent.click(screen.getByText('Learn more about Payjoin'));
      expect(screen.getByText('Understanding Payjoin')).toBeInTheDocument();

      const modalBackdrop = document.querySelector('.fixed.inset-0.z-50');
      expect(modalBackdrop).not.toBeNull();
      fireEvent.click(modalBackdrop!);

      await waitFor(() => {
        expect(screen.queryByText('Understanding Payjoin')).not.toBeInTheDocument();
      });
    });

    it('shows BIP78 link in modal', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockImplementation(() => new Promise(() => {}));

      render(<PayjoinSection {...defaultProps} />);

      // Open tooltip then modal
      fireEvent.click(screen.getByLabelText('What is Payjoin?'));
      fireEvent.click(screen.getByText('Learn more about Payjoin'));

      expect(screen.getByText('Read the BIP78 specification')).toBeInTheDocument();
    });
  });

  describe('enabled state', () => {
    it('shows note when enabled', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockImplementation(() => new Promise(() => {}));

      render(<PayjoinSection {...defaultProps} enabled={true} />);

      expect(screen.getByText('Keep your server running until payment arrives.')).toBeInTheDocument();
    });

    it('does not show note when disabled', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockImplementation(() => new Promise(() => {}));

      render(<PayjoinSection {...defaultProps} enabled={false} />);

      expect(screen.queryByText('Keep your server running until payment arrives.')).not.toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('handles API error gracefully', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockRejectedValue(new Error('API Error'));

      render(<PayjoinSection {...defaultProps} />);

      await waitFor(() => {
        expect(payjoinApi.checkPayjoinEligibility).toHaveBeenCalled();
      });

      // Should still render without crashing
      expect(screen.getByText('Enhanced Privacy')).toBeInTheDocument();
    });
  });

  describe('className prop', () => {
    it('applies custom className', async () => {
      vi.mocked(payjoinApi.checkPayjoinEligibility).mockImplementation(() => new Promise(() => {}));

      const { container } = render(
        <PayjoinSection {...defaultProps} className="custom-class" />
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });
  });
});
