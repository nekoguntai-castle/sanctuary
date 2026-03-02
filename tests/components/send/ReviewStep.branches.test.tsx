import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewStep } from '../../../components/send/steps/ReviewStep';
import * as SendContext from '../../../contexts/send';
import * as CurrencyContext from '../../../contexts/CurrencyContext';
import { lookupAddresses } from '../../../src/api/bitcoin';

const capture = vi.hoisted(() => ({
  summaryProps: null as any,
  draftProps: null as any,
  usbRefValueAfterUpload: null as string | null,
  deviceRefValueAfterUpload: null as string | null,
}));

const loggerSpies = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => loggerSpies,
}));

vi.mock('../../../contexts/send', () => ({
  useSendTransaction: vi.fn(),
}));

vi.mock('../../../contexts/CurrencyContext', () => ({
  useCurrency: vi.fn(),
}));

vi.mock('../../../src/api/bitcoin', () => ({
  lookupAddresses: vi.fn(),
}));

vi.mock('../../../components/send/steps/review/TransactionSummary', () => ({
  TransactionSummary: (props: any) => {
    capture.summaryProps = props;
    return <div data-testid="summary" />;
  },
}));

vi.mock('../../../components/send/steps/review/SigningFlow', () => ({
  SigningFlow: ({ onDeviceFileUpload, deviceFileInputRefs }: any) => {
    deviceFileInputRefs.current['device-1'] = { value: 'before-device-upload' };
    return (
      <div>
        <button
          data-testid="device-upload"
          onClick={async () => {
            await onDeviceFileUpload(
              { target: { files: [new File(['signed'], 'multi.psbt')] } },
              'device-1',
            );
            capture.deviceRefValueAfterUpload = deviceFileInputRefs.current['device-1']?.value ?? null;
          }}
        >
          Device Upload
        </button>
        <button
          data-testid="device-upload-empty"
          onClick={async () => {
            await onDeviceFileUpload({ target: { files: [] } }, 'device-1');
            capture.deviceRefValueAfterUpload = deviceFileInputRefs.current['device-1']?.value ?? null;
          }}
        >
          Device Upload Empty
        </button>
        <button
          data-testid="device-upload-no-ref"
          onClick={async () => {
            await onDeviceFileUpload(
              { target: { files: [new File(['signed'], 'multi-no-ref.psbt')] } },
              'missing-device',
            );
            capture.deviceRefValueAfterUpload = deviceFileInputRefs.current['missing-device']?.value ?? null;
          }}
        >
          Device Upload No Ref
        </button>
      </div>
    );
  },
}));

vi.mock('../../../components/send/steps/review/UsbSigning', () => ({
  UsbSigning: ({ onFileUpload, fileInputRef }: any) => {
    fileInputRef.current = { value: 'before-usb-upload' };
    return (
      <div>
        <button
          data-testid="usb-upload"
          onClick={async () => {
            await onFileUpload({ target: { files: [new File(['signed'], 'single.psbt')] } });
            capture.usbRefValueAfterUpload = fileInputRef.current?.value ?? null;
          }}
        >
          USB Upload
        </button>
        <button
          data-testid="usb-upload-empty-no-ref"
          onClick={async () => {
            fileInputRef.current = null;
            await onFileUpload({ target: { files: [] } });
            capture.usbRefValueAfterUpload = fileInputRef.current?.value ?? null;
          }}
        >
          USB Upload Empty No Ref
        </button>
      </div>
    );
  },
}));

vi.mock('../../../components/send/steps/review/QrSigning', () => ({
  QrSigning: () => <div data-testid="qr-signing" />,
}));

vi.mock('../../../components/send/steps/review/DraftActions', () => ({
  DraftActions: (props: any) => {
    capture.draftProps = props;
    return <div data-testid="draft-actions" />;
  },
}));

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    state: {
      transactionType: 'standard',
      outputs: [{ address: 'bc1qrecipient', amount: '5000', sendMax: false }],
      selectedUTXOs: new Set<string>(['funding-tx:0']),
    },
    wallet: { id: 'w1', name: 'Main Wallet', type: 'native_segwit', quorum: 1 },
    devices: [{ id: 'device-1', type: 'ledger', label: 'Ledger', fingerprint: 'F1' }],
    utxos: [{ txid: 'funding-tx', vout: 0, address: 'bc1qknown', amount: 12000 }],
    spendableUtxos: [{ txid: 'funding-tx', vout: 0, address: 'bc1qknown', amount: 12000 }],
    walletAddresses: [{ address: 'bc1qknown' }],
    selectedTotal: 12000,
    estimatedFee: 1000,
    totalOutputAmount: 5000,
    goToStep: vi.fn(),
    prevStep: vi.fn(),
    isReadyToSign: true,
    ...overrides,
  };
}

describe('ReviewStep branch coverage', () => {
  const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    capture.summaryProps = null;
    capture.draftProps = null;
    capture.usbRefValueAfterUpload = null;
    capture.deviceRefValueAfterUpload = null;

    vi.mocked(CurrencyContext.useCurrency).mockReturnValue({
      format: (sats: number) => `${sats}`,
      formatFiat: () => '$0.00',
    } as never);

    vi.mocked(SendContext.useSendTransaction).mockReturnValue(makeContext() as never);
    vi.mocked(lookupAddresses).mockResolvedValue({ lookup: {} } as never);
  });

  afterEach(() => {
    alertSpy.mockClear();
  });

  it('builds flowData using txData fallbacks, known labels, lookup labels, and decoy outputs', async () => {
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(
      makeContext({
        state: {
          transactionType: 'standard',
          outputs: [{ address: 'bc1qexternal', amount: '5000', sendMax: false }],
          selectedUTXOs: new Set<string>(['funding-tx:0']),
        },
        walletAddresses: [{ address: 'bc1qknown' }],
        utxos: [{ txid: 'funding-tx', vout: 0, address: 'bc1qknown', amount: 12000 }],
      }) as never,
    );

    vi.mocked(lookupAddresses).mockResolvedValue({
      lookup: {
        bc1qexternal: { walletName: 'External Wallet' },
        bc1qdecoy: { walletName: 'Decoy Wallet' },
      },
    } as never);

    render(
      <ReviewStep
        txData={{
          utxos: [{ txid: 'funding-tx', vout: 0 }],
          outputs: [{ address: 'bc1qexternal', amount: 5000 }],
          decoyOutputs: [{ address: 'bc1qdecoy', amount: 700 }],
          changeAddress: 'bc1qchange',
          changeAmount: 3000,
          totalInput: 12000,
          totalOutput: 8700,
          fee: 300,
        } as any}
        hardwareWallet={{ isConnected: true, device: { model: 'ledger' } }}
      />,
    );

    await waitFor(() => expect(lookupAddresses).toHaveBeenCalled());
    expect(lookupAddresses).toHaveBeenCalledWith([
      'bc1qexternal',
      'bc1qchange',
      'bc1qdecoy',
    ]);

    await waitFor(() => {
      const flowData = capture.summaryProps?.flowData;
      expect(flowData).toMatchObject({
        inputs: expect.any(Array),
        outputs: expect.any(Array),
      });
      expect(flowData.inputs[0]).toMatchObject({
        address: 'bc1qknown',
        amount: 12000,
        label: 'Main Wallet',
      });
      expect(flowData.outputs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ address: 'bc1qexternal', label: 'External Wallet' }),
          expect.objectContaining({ address: 'bc1qdecoy', isChange: true, label: 'Decoy Wallet' }),
        ]),
      );
    });

    expect(capture.draftProps.canBroadcast).toBe(true);
  });

  it('skips address lookup when there are no output/change/decoy addresses', async () => {
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(
      makeContext({
        state: {
          transactionType: 'standard',
          outputs: [{ address: '', amount: 'NaN', sendMax: false }],
          selectedUTXOs: new Set<string>(),
        },
      }) as never,
    );

    render(<ReviewStep />);

    await waitFor(() =>
      expect(capture.summaryProps?.flowData).toMatchObject({
        inputs: expect.any(Array),
        outputs: expect.any(Array),
      }),
    );
    expect(lookupAddresses).not.toHaveBeenCalled();

    const flowData = capture.summaryProps.flowData;
    expect(flowData.inputs[0]).toMatchObject({ address: 'bc1qknown', amount: 12000 });
    expect(flowData.outputs[0]).toMatchObject({ amount: 0 });
  });

  it('logs a warning when address lookup fails', async () => {
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(
      makeContext({
        state: {
          transactionType: 'standard',
          outputs: [{ address: 'bc1qrecipient', amount: '1000', sendMax: false }],
          selectedUTXOs: new Set<string>(),
        },
      }) as never,
    );
    vi.mocked(lookupAddresses).mockRejectedValueOnce(new Error('lookup failed'));

    render(<ReviewStep />);

    await waitFor(() => {
      expect(loggerSpies.warn).toHaveBeenCalledWith(
        'Failed to lookup addresses',
        expect.objectContaining({ error: 'Error: lookup failed' }),
      );
    });
  });

  it('handles single-sig PSBT upload and resets the hidden file input ref', async () => {
    const user = userEvent.setup();
    const onUploadSignedPsbt = vi.fn().mockResolvedValue(undefined);

    render(<ReviewStep txData={{ fee: 100 } as any} onUploadSignedPsbt={onUploadSignedPsbt} />);

    await user.click(screen.getByTestId('usb-upload'));

    await waitFor(() => expect(onUploadSignedPsbt).toHaveBeenCalledTimes(1));
    expect(capture.usbRefValueAfterUpload).toBe('');
  });

  it('skips single-sig upload when file/callback is missing and ref is null', async () => {
    const user = userEvent.setup();

    render(<ReviewStep txData={{ fee: 100 } as any} />);

    await user.click(screen.getByTestId('usb-upload-empty-no-ref'));

    expect(capture.usbRefValueAfterUpload).toBeNull();
  });

  it('handles multisig per-device upload success and resets that device input', async () => {
    const user = userEvent.setup();
    const onUploadSignedPsbt = vi.fn().mockResolvedValue(undefined);

    vi.mocked(SendContext.useSendTransaction).mockReturnValue(
      makeContext({
        wallet: { id: 'w1', name: 'Main Wallet', type: 'multi_sig', quorum: { m: 2, n: 3 } },
      }) as never,
    );

    render(
      <ReviewStep
        txData={{ fee: 100 } as any}
        unsignedPsbt="base64-psbt"
        onUploadSignedPsbt={onUploadSignedPsbt}
      />,
    );

    await user.click(screen.getByTestId('device-upload'));

    await waitFor(() => expect(onUploadSignedPsbt).toHaveBeenCalledTimes(1));
    expect(onUploadSignedPsbt).toHaveBeenCalledWith(expect.any(File), 'device-1', 'F1');
    expect(capture.deviceRefValueAfterUpload).toBe('');
  });

  it('surfaces per-device upload errors and handles skipped uploads without callback', async () => {
    const user = userEvent.setup();
    const onUploadSignedPsbt = vi.fn().mockRejectedValue(new Error('bad upload'));

    vi.mocked(SendContext.useSendTransaction).mockReturnValue(
      makeContext({
        wallet: { id: 'w1', name: 'Main Wallet', type: 'multi_sig', quorum: { m: 2, n: 3 } },
      }) as never,
    );

    const { rerender } = render(
      <ReviewStep
        txData={{ fee: 100 } as any}
        unsignedPsbt="base64-psbt"
        onUploadSignedPsbt={onUploadSignedPsbt}
      />,
    );

    await user.click(screen.getByTestId('device-upload'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('bad upload'));

    rerender(<ReviewStep txData={{ fee: 100 } as any} unsignedPsbt="base64-psbt" />);
    await user.click(screen.getByTestId('device-upload-empty'));
    expect(loggerSpies.debug).toHaveBeenCalledWith('Upload skipped - no file or no callback');
  });

  it('handles per-device non-Error failures and missing device input refs', async () => {
    const user = userEvent.setup();
    const onUploadSignedPsbt = vi.fn().mockRejectedValue('string failure');

    vi.mocked(SendContext.useSendTransaction).mockReturnValue(
      makeContext({
        wallet: { id: 'w1', name: 'Main Wallet', type: 'multi_sig', quorum: 0 },
      }) as never,
    );

    render(
      <ReviewStep
        txData={{ fee: 100 } as any}
        unsignedPsbt="base64-psbt"
        onUploadSignedPsbt={onUploadSignedPsbt}
      />,
    );

    await user.click(screen.getByTestId('device-upload-no-ref'));

    await waitFor(() => expect(onUploadSignedPsbt).toHaveBeenCalledTimes(1));
    expect(alertSpy).not.toHaveBeenCalledWith('string failure');
    expect(capture.deviceRefValueAfterUpload).toBeNull();
  });

  it('covers txData input fallbacks for hasData, lookup fallback, and empty defaults', async () => {
    vi.mocked(SendContext.useSendTransaction).mockReturnValue(
      makeContext({
        utxos: [{ txid: 'known-tx', vout: 1, address: 'bc1qknownlookup', amount: 7777 }],
        state: {
          transactionType: 'standard',
          outputs: [{ address: 'bc1qrecipient', amount: '1000', sendMax: false }],
          selectedUTXOs: new Set<string>(),
        },
      }) as never,
    );

    render(
      <ReviewStep
        txData={{
          utxos: [
            { txid: 'data-tx', vout: 0, address: 'bc1qfromdata', amount: 1234 },
            { txid: 'known-tx', vout: 1 },
            { txid: 'missing-tx', vout: 9 },
          ],
          outputs: [{ address: 'bc1qrecipient', amount: 1000 }],
        } as any}
      />,
    );

    await waitFor(() =>
      expect(capture.summaryProps?.flowData).toMatchObject({
        inputs: expect.any(Array),
        outputs: expect.any(Array),
      }),
    );
    const inputs = capture.summaryProps.flowData.inputs;
    expect(inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: 'bc1qfromdata', amount: 1234 }),
        expect.objectContaining({ address: 'bc1qknownlookup', amount: 7777 }),
        expect.objectContaining({ address: '', amount: 0 }),
      ]),
    );
  });
});
