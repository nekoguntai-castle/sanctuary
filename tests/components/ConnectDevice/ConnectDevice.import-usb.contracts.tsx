import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  mocks,
  renderConnectDevice,
} from './ConnectDeviceTestHarness';

export const registerConnectDeviceImportUsbContracts = () => {
  describe('SD card, conflict, and USB flows', () => {
    it('imports SD card accounts and saves with parsed account payload', async () => {
      const user = userEvent.setup();

      mocks.parseDeviceJson.mockReturnValue({
        fingerprint: 'f00dbabe',
        accounts: [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/0'",
            xpub: 'xpub-imported-account',
          },
        ],
      } as any);

      mocks.createDeviceWithConflictHandling.mockResolvedValue({
        status: 'created',
        device: { id: 'device-new' },
      });

      await renderConnectDevice();

      await waitFor(() => expect(screen.getByText('Coldcard MK4')).toBeInTheDocument());
      await user.click(screen.getByText('Coldcard MK4'));
      await waitFor(() => expect(screen.getByText('SD Card')).toBeInTheDocument());
      await user.click(screen.getByText('SD Card'));

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(fileInput, {
        target: { files: [new File(['{}'], 'coldcard-export.json', { type: 'application/json' })] },
      });

      await waitFor(() => {
        expect(screen.getByText(/File Imported Successfully/i)).toBeInTheDocument();
      });

      const saveButton = screen.getByRole('button', { name: /Save Device/i });
      expect(saveButton).not.toBeDisabled();
      await user.click(saveButton);

      await waitFor(() => {
        expect(mocks.createDeviceWithConflictHandling).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'Coldcard MK4',
            label: 'My Coldcard MK4',
            fingerprint: 'f00dbabe',
            modelSlug: 'coldcard-mk4',
            accounts: [
              {
                purpose: 'single_sig',
                scriptType: 'native_segwit',
                derivationPath: "m/84'/0'/0'",
                xpub: 'xpub-imported-account',
              },
            ],
          }),
        );
      });
    });

    it('shows conflict dialog after save and merges accounts into existing device', async () => {
      const user = userEvent.setup();

      mocks.parseDeviceJson.mockReturnValue({
        fingerprint: 'f00dbabe',
        accounts: [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/1'",
            xpub: 'xpub-merge-account',
          },
        ],
      } as any);

      mocks.createDeviceWithConflictHandling.mockResolvedValue({
        status: 'conflict',
        conflict: {
          existingDevice: {
            id: 'existing-device-1',
            type: 'coldcard',
            label: 'Existing Coldcard',
            fingerprint: 'f00dbabe',
            accounts: [{}],
          },
          comparison: {
            newAccounts: [{ derivationPath: "m/84'/0'/1'" }],
            matchingAccounts: [],
            conflictingAccounts: [],
          },
        },
      });

      mocks.mergeDeviceAccounts.mockResolvedValue({
        device: { id: 'existing-device-1' },
        added: 1,
      });

      await renderConnectDevice();

      await waitFor(() => expect(screen.getByText('Coldcard MK4')).toBeInTheDocument());
      await user.click(screen.getByText('Coldcard MK4'));
      await waitFor(() => expect(screen.getByText('SD Card')).toBeInTheDocument());
      await user.click(screen.getByText('SD Card'));

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(fileInput, {
        target: { files: [new File(['{}'], 'coldcard-export.json', { type: 'application/json' })] },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Save Device/i })).not.toBeDisabled();
      });

      await user.click(screen.getByRole('button', { name: /Save Device/i }));

      await waitFor(() => {
        expect(screen.getByText(/Device Already Exists/i)).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /Merge 1 New Account/i }));

      await waitFor(() => {
        expect(mocks.mergeDeviceAccounts).toHaveBeenCalledWith(
          expect.objectContaining({
            merge: true,
            type: 'Coldcard MK4',
            label: 'My Coldcard MK4',
            fingerprint: 'f00dbabe',
            modelSlug: 'coldcard-mk4',
            accounts: [
              {
                purpose: 'single_sig',
                scriptType: 'native_segwit',
                derivationPath: "m/84'/0'/1'",
                xpub: 'xpub-merge-account',
              },
            ],
          }),
        );
      });
    });

    it('shows warning when SD card file cannot be parsed', async () => {
      const user = userEvent.setup();

      mocks.parseDeviceJson.mockReturnValue(null);

      await renderConnectDevice();

      await waitFor(() => expect(screen.getByText('Coldcard MK4')).toBeInTheDocument());
      await user.click(screen.getByText('Coldcard MK4'));
      await waitFor(() => expect(screen.getByText('SD Card')).toBeInTheDocument());
      await user.click(screen.getByText('SD Card'));

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(fileInput, {
        target: { files: [new File(['bad'], 'invalid.json', { type: 'application/json' })] },
      });

      await waitFor(() => {
        expect(mocks.parseDeviceJson).toHaveBeenCalled();
        expect(screen.getByText('Select File')).toBeInTheDocument();
        expect(screen.queryByText(/File Imported Successfully/i)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Save Device/i })).toBeDisabled();
      });
    });

    it('allows viewing existing device and dismissing conflict dialog', async () => {
      const user = userEvent.setup();

      mocks.parseDeviceJson.mockReturnValue({
        fingerprint: 'f00dbabe',
        accounts: [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/1'",
            xpub: 'xpub-merge-account',
          },
        ],
      } as any);

      mocks.createDeviceWithConflictHandling.mockResolvedValue({
        status: 'conflict',
        conflict: {
          existingDevice: {
            id: 'existing-device-2',
            type: 'coldcard',
            label: 'Existing Coldcard',
            fingerprint: 'f00dbabe',
            accounts: [{}],
          },
          comparison: {
            newAccounts: [{ derivationPath: "m/84'/0'/1'" }],
            matchingAccounts: [],
            conflictingAccounts: [],
          },
        },
      });

      await renderConnectDevice();

      await waitFor(() => expect(screen.getByText('Coldcard MK4')).toBeInTheDocument());
      await user.click(screen.getByText('Coldcard MK4'));
      await waitFor(() => expect(screen.getByText('SD Card')).toBeInTheDocument());
      await user.click(screen.getByText('SD Card'));

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(fileInput, {
        target: { files: [new File(['{}'], 'coldcard-export.json', { type: 'application/json' })] },
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Save Device/i })).not.toBeDisabled();
      });

      await user.click(screen.getByRole('button', { name: /Save Device/i }));

      await waitFor(() => {
        expect(screen.getByText(/Device Already Exists/i)).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /View Existing Device/i }));
      expect(mocks.navigate).toHaveBeenCalledWith('/devices/existing-device-2');

      await user.click(screen.getByRole('button', { name: /Cancel/i }));
      await waitFor(() => {
        expect(screen.queryByText(/Device Already Exists/i)).not.toBeInTheDocument();
      });
    });

    it('connects a USB device when secure context is available', async () => {
      const user = userEvent.setup();

      mocks.isSecureContext.mockReturnValue(true);
      mocks.hardwareWalletService.connect.mockResolvedValue({ connected: true } as any);
      mocks.hardwareWalletService.getAllXpubs.mockResolvedValue([
        {
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          path: "m/84'/0'/0'",
          xpub: 'xpub-usb',
          fingerprint: 'c0ffeebb',
        },
      ] as any);

      await renderConnectDevice();

      await waitFor(() => expect(screen.getByText('Ledger Nano S')).toBeInTheDocument());
      await user.click(screen.getByText('Ledger Nano S'));

      await waitFor(() => {
        expect(screen.getByText('USB')).toBeInTheDocument();
      });

      await user.click(screen.getByText('USB'));
      await user.click(screen.getByRole('button', { name: /Connect Device/i }));

      await waitFor(() => {
        expect(mocks.hardwareWalletService.connect).toHaveBeenCalled();
        expect(screen.getByText(/Device Connected/i)).toBeInTheDocument();
      });
    });
  });
};
