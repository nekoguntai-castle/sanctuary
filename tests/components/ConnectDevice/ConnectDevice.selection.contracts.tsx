import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderConnectDevice } from './ConnectDeviceTestHarness';

export const registerConnectDeviceSelectionContracts = () => {
  describe('device selection and verified connection methods', () => {
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
      expect(screen.queryByText('Manual Entry')).not.toBeInTheDocument();
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
  });
};
