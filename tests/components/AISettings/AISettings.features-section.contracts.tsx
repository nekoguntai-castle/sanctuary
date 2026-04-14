import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import './AISettingsTestHarness';
import AISettings from '../../../components/AISettings';

export function registerAISettingsFeaturesSectionContracts() {
  describe('AI Features Section', () => {
    it('should show AI features description', async () => {
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('What AI Can Do')).toBeInTheDocument();
      });
    });

    it('should describe transaction labeling', async () => {
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('Transaction Labeling')).toBeInTheDocument();
      });
    });

    it('should describe natural language queries', async () => {
      render(<AISettings />);

      await waitFor(() => {
        expect(screen.getByText('Natural Language Queries')).toBeInTheDocument();
      });
    });
  });
}
