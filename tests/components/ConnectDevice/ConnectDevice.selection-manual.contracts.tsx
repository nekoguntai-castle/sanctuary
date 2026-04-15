import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderConnectDevice } from './ConnectDeviceTestHarness';

export const registerConnectDeviceSelectionManualContracts = () => {
  describe('device selection and manual entry', () => {
    it('should show connection methods when device is selected', async () => {
      const user = userEvent.setup();

      await renderConnectDevice();

      await waitFor(() => {
        expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Coldcard MK4').closest('button')!);

      await waitFor(() => {
        expect(screen.getByText(/2\. connection method/i)).toBeInTheDocument();
      });

      expect(screen.getByText('SD Card')).toBeInTheDocument();
      expect(screen.getByText('Manual Entry')).toBeInTheDocument();
    });

    it('should highlight selected device', async () => {
      const user = userEvent.setup();

      await renderConnectDevice();

      await waitFor(() => {
        expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
      });

      const coldcardButton = screen.getByText('Coldcard MK4').closest('button');
      await user.click(coldcardButton!);

      expect(coldcardButton).toHaveClass('ring-1');
    });

    it('should show device capabilities', async () => {
      const user = userEvent.setup();

      await renderConnectDevice();

      await waitFor(() => {
        expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Coldcard MK4'));

      await waitFor(() => {
        expect(screen.getByText(/air-gapped/i)).toBeInTheDocument();
        expect(screen.getByText(/secure element/i)).toBeInTheDocument();
        expect(screen.getByText(/open source/i)).toBeInTheDocument();
        expect(screen.getByText(/bitcoin only/i)).toBeInTheDocument();
      });
    });

    it('should show device details form when device is selected', async () => {
      const user = userEvent.setup();

      await renderConnectDevice();

      await waitFor(() => {
        expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Coldcard MK4'));

      await waitFor(() => {
        expect(screen.getByText(/device details/i)).toBeInTheDocument();
        expect(screen.getByText(/device label/i)).toBeInTheDocument();
        expect(screen.getByText(/master fingerprint/i)).toBeInTheDocument();
      });
    });

    it('should auto-populate device label based on selected model', async () => {
      const user = userEvent.setup();

      await renderConnectDevice();

      await waitFor(() => {
        expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Coldcard MK4'));

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/my coldcard mk4/i)).toHaveValue('My Coldcard MK4');
      });
    });

    it('should show manual entry warning', async () => {
      const user = userEvent.setup();

      await renderConnectDevice();

      await waitFor(() => {
        expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Coldcard MK4'));
      await waitFor(() => {
        expect(screen.getByText('Manual Entry')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Manual Entry'));

      await waitFor(() => {
        expect(screen.getByText(/manually entering xpubs is for advanced users/i)).toBeInTheDocument();
      });
    });

    it('should show derivation path and xpub inputs for manual entry', async () => {
      const user = userEvent.setup();

      await renderConnectDevice();

      await waitFor(() => {
        expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Coldcard MK4').closest('button')!);
      await waitFor(() => {
        expect(screen.getByText('Manual Entry')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Manual Entry').closest('button')!);

      expect(screen.getByText('Derivation Path')).toBeInTheDocument();
      expect(screen.getByText('Extended Public Key')).toBeInTheDocument();
    });

    it('should disable save button when required fields are empty', async () => {
      const user = userEvent.setup();

      await renderConnectDevice();

      await waitFor(() => {
        expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Coldcard MK4'));
      await waitFor(() => {
        expect(screen.getByText('Manual Entry')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Manual Entry'));

      expect(screen.getByText(/save device/i)).toBeDisabled();
    });

    it('should enable save button when fingerprint and xpub are provided', async () => {
      const user = userEvent.setup();

      await renderConnectDevice();

      await waitFor(() => {
        expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Coldcard MK4'));
      await waitFor(() => {
        expect(screen.getByText('Manual Entry')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Manual Entry'));

      await user.type(screen.getByPlaceholderText(/00000000/i), 'abc12345');
      await user.type(screen.getByPlaceholderText(/xpub/i), 'xpub6CUGRUonZSQ4TWtTMmzXdq9hYfQGx4Zz5r7rRBNwZ');

      expect(screen.getByText(/save device/i)).not.toBeDisabled();
    });
  });
};
