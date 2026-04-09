import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoadingState, ErrorState } from '../../../components/WalletDetail/WalletDetailStates';

describe('WalletDetailStates', () => {
  describe('LoadingState', () => {
    it('renders default loading message', () => {
      render(<LoadingState />);
      expect(screen.getByText('Loading wallet...')).toBeInTheDocument();
    });

    it('renders custom loading message', () => {
      render(<LoadingState message="Fetching data..." />);
      expect(screen.getByText('Fetching data...')).toBeInTheDocument();
    });
  });

  describe('ErrorState', () => {
    it('renders error message and retry button', () => {
      const onRetry = vi.fn();
      render(<ErrorState error="Network failure" onRetry={onRetry} />);

      expect(screen.getByText('Failed to Load Wallet')).toBeInTheDocument();
      expect(screen.getByText('Network failure')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    });

    it('calls onRetry when retry button is clicked', () => {
      const onRetry = vi.fn();
      render(<ErrorState error="Timeout" onRetry={onRetry} />);

      fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });
});
