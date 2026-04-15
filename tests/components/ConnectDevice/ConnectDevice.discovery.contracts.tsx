import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  mocks,
  renderConnectDevice,
} from './ConnectDeviceTestHarness';

export const registerConnectDeviceDiscoveryContracts = () => {
  describe('loading, navigation, and discovery', () => {
    it('should render loading state initially', async () => {
      mocks.getDeviceModels.mockImplementation(() => new Promise<never>(() => undefined));

      await renderConnectDevice();

      expect(screen.getByText(/loading device models/i)).toBeInTheDocument();
    });

    it('should render page title after loading', async () => {
      await renderConnectDevice();

      await waitFor(() => {
        expect(screen.getByText(/connect hardware device/i)).toBeInTheDocument();
      });
    });

    it('should show back to devices button', async () => {
      await renderConnectDevice();

      await waitFor(() => {
        expect(screen.getByText(/back to devices/i)).toBeInTheDocument();
      });
    });

    it('should navigate back when clicking back button', async () => {
      const user = userEvent.setup();

      await renderConnectDevice();

      await waitFor(() => {
        expect(screen.getByText(/back to devices/i)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/back to devices/i));

      expect(mocks.navigate).toHaveBeenCalledWith('/devices');
    });

    it('should display device models', async () => {
      await renderConnectDevice();

      await waitFor(() => {
        expect(screen.getByText('Ledger Nano S')).toBeInTheDocument();
        expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
        expect(screen.getByText('Trezor Model T')).toBeInTheDocument();
      });
    });

    it('should show manufacturer filter buttons', async () => {
      await renderConnectDevice();

      await waitFor(() => {
        expect(screen.getByText('All')).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Ledger' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Coinkite' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Trezor' })).toBeInTheDocument();
    });

    it('should filter devices by manufacturer', async () => {
      const user = userEvent.setup();

      await renderConnectDevice();

      await waitFor(() => {
        expect(screen.getByText('Ledger Nano S')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Ledger' }));

      await waitFor(() => {
        expect(screen.getByText('Ledger Nano S')).toBeInTheDocument();
        expect(screen.queryByText('Coldcard MK4')).not.toBeInTheDocument();
        expect(screen.queryByText('Trezor Model T')).not.toBeInTheDocument();
      });
    });

    it('should allow searching devices', async () => {
      const user = userEvent.setup();

      await renderConnectDevice();

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/search devices/i)).toBeInTheDocument();
      });

      await user.type(screen.getByPlaceholderText(/search devices/i), 'cold');

      expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
      expect(screen.queryByText('Ledger Nano S')).not.toBeInTheDocument();
      expect(screen.queryByText('Trezor Model T')).not.toBeInTheDocument();
    });

    it('should clear search when X is clicked', async () => {
      const user = userEvent.setup();

      await renderConnectDevice();

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/search devices/i)).toBeInTheDocument();
      });

      await user.type(screen.getByPlaceholderText(/search devices/i), 'cold');
      await user.click(screen.getByTestId('x-icon').closest('button')!);

      expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
      expect(screen.getByText('Ledger Nano S')).toBeInTheDocument();
      expect(screen.getByText('Trezor Model T')).toBeInTheDocument();
    });

    it('should show no results message when search has no matches', async () => {
      const user = userEvent.setup();

      await renderConnectDevice();

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/search devices/i)).toBeInTheDocument();
      });

      await user.type(screen.getByPlaceholderText(/search devices/i), 'nonexistentdevice');

      expect(screen.getByText(/no devices match your search/i)).toBeInTheDocument();
    });
  });
};
