import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDeviceForm,
  type UseDeviceFormDeps,
} from '../../../src/components/ConnectDevice/hooks/useDeviceForm';

const parseDeviceJsonMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/services/deviceParsers', () => ({
  parseDeviceJson: parseDeviceJsonMock,
}));

const selectedModel = {
  id: 'model-1',
  slug: 'ledger-nano-s',
  name: 'Ledger Nano S',
} as any;

const account = (index: number) => ({
  purpose: 'single_sig' as const,
  scriptType: 'native_segwit' as const,
  derivationPath: `m/84'/0'/${index}'`,
  xpub: `xpub-${index}`,
});

const DEFAULT_PATH = "m/84'/0'/0'";

const callbacks = {
  saveDevice: vi.fn(async () => undefined),
  mergeDevice: vi.fn(async () => undefined),
  resetQr: vi.fn(),
  resetUsb: vi.fn(),
  resetSave: vi.fn(),
};

const baseDeps = (overrides: Partial<UseDeviceFormDeps> = {}): UseDeviceFormDeps => ({
  selectedModel,
  scanResult: null,
  connectionResult: null,
  ...callbacks,
  ...overrides,
});

const renderDeviceForm = (overrides: Partial<UseDeviceFormDeps> = {}) =>
  renderHook(currentProps => useDeviceForm(currentProps), { initialProps: baseDeps(overrides) });

const qrResult = (overrides: Record<string, unknown> = {}) => ({
  xpub: '',
  fingerprint: 'a1b2c3d4',
  derivationPath: '',
  label: undefined,
  accounts: undefined,
  extractedFields: { xpub: true, fingerprint: true, derivationPath: true, label: false },
  warning: null,
  ...overrides,
}) as any;

class ImmediateFileReader {
  onload: ((event: { target: { result: string } }) => void) | null = null;
  onerror: (() => void) | null = null;

  readAsText() {
    this.onload?.({ target: { result: 'device export' } });
  }
}

type Hook = ReturnType<typeof renderDeviceForm>;

async function importFile(hook: Hook, parsed: Record<string, unknown>) {
  parseDeviceJsonMock.mockReturnValue(parsed);
  const scannedBefore = hook.result.current.scanned;
  act(() => {
    hook.result.current.handleFileUpload({
      target: { files: [new File(['device export'], 'device.json')] },
    } as any);
  });
  await waitFor(() => expect(hook.result.current.fileScanning).toBe(false));
  expect(scannedBefore || hook.result.current.scanned).toBe(true);
}

describe('useDeviceForm sequential imports never mix identity fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseDeviceJsonMock.mockReset();
    vi.stubGlobal('FileReader', ImmediateFileReader);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves import B alone after a method change following a multi-account import', async () => {
    const hook = renderDeviceForm({
      connectionResult: {
        modelId: selectedModel.id,
        fingerprint: 'a1b2c3d4',
        accounts: [account(0), account(1)],
      },
    });
    await waitFor(() => expect(hook.result.current.scanned).toBe(true));
    expect(hook.result.current.formData.parsedAccounts).toHaveLength(2);

    act(() => hook.result.current.handleSelectMethod('sd_card'));
    await importFile(hook, {
      xpub: 'xpub-b',
      fingerprint: 'bbbbbbbb',
      derivationPath: "m/84'/0'/7'",
      format: 'ledger',
    });
    await act(async () => hook.result.current.handleSave());

    expect(callbacks.saveDevice).toHaveBeenCalledTimes(1);
    const payload = (callbacks.saveDevice.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload).toEqual(expect.objectContaining({
      xpub: 'xpub-b',
      derivationPath: "m/84'/0'/7'",
      fingerprint: 'bbbbbbbb',
    }));
    expect(payload).not.toHaveProperty('accounts');
  });

  it('drops accounts from a prior import when the next import has none, without reselecting the method', async () => {
    const hook = renderDeviceForm();

    await importFile(hook, {
      fingerprint: 'a1b2c3d4',
      accounts: [account(0), account(1)],
      format: 'ledger',
    });
    expect(hook.result.current.formData.parsedAccounts).toHaveLength(2);

    await importFile(hook, {
      xpub: 'xpub-b',
      fingerprint: 'bbbbbbbb',
      derivationPath: "m/84'/0'/7'",
      format: 'ledger',
    });
    expect(hook.result.current.formData.parsedAccounts).toEqual([]);
    expect(hook.result.current.formData.selectedAccounts).toEqual(new Set());

    await act(async () => hook.result.current.handleSave());
    const payload = (callbacks.saveDevice.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('accounts');
    expect(payload).toEqual(expect.objectContaining({ xpub: 'xpub-b', fingerprint: 'bbbbbbbb' }));
  });

  it('falls back to the default path and empty xpub when an accounts-only file follows a single-xpub file', async () => {
    const hook = renderDeviceForm();

    await importFile(hook, {
      xpub: 'xpub-a',
      fingerprint: 'a1b2c3d4',
      derivationPath: "m/84'/0'/9'",
      format: 'ledger',
    });
    await importFile(hook, {
      fingerprint: 'bbbbbbbb',
      accounts: [account(2)],
      format: 'ledger',
    });

    expect(hook.result.current.formData.xpub).toBe('');
    expect(hook.result.current.formData.derivationPath).toBe(DEFAULT_PATH);
    expect(hook.result.current.formData.fingerprint).toBe('bbbbbbbb');
  });

  it('leaves xpub as an empty string, not undefined, for an accounts-only QR after a single-xpub import', async () => {
    const hook = renderDeviceForm();
    await importFile(hook, {
      xpub: 'xpub-a',
      fingerprint: 'a1b2c3d4',
      derivationPath: "m/84'/0'/9'",
      format: 'ledger',
    });

    hook.rerender(baseDeps({
      scanResult: qrResult({ xpub: undefined, fingerprint: 'bbbbbbbb', accounts: [account(3)] }),
    }));

    await waitFor(() => expect(hook.result.current.formData.fingerprint).toBe('bbbbbbbb'));
    expect(hook.result.current.formData.xpub).toBe('');
    expect(hook.result.current.formData.derivationPath).toBe(DEFAULT_PATH);
    expect(hook.result.current.formData.parsedAccounts).toHaveLength(1);
  });

  it('clears QR badges when a file import follows a QR import', async () => {
    const hook = renderDeviceForm({
      scanResult: qrResult({ xpub: 'xpub-q', derivationPath: "m/84'/0'/1'" }),
    });
    await waitFor(() => expect(hook.result.current.qrExtractedFields).not.toBeNull());

    await importFile(hook, {
      xpub: 'xpub-b',
      fingerprint: 'bbbbbbbb',
      derivationPath: "m/84'/0'/7'",
      format: 'ledger',
    });

    expect(hook.result.current.qrExtractedFields).toBeNull();
  });

  it('resets identity but keeps the label when the connection method changes', async () => {
    const hook = renderDeviceForm();
    await importFile(hook, {
      fingerprint: 'a1b2c3d4',
      accounts: [account(0)],
      xpub: 'xpub-a',
      derivationPath: "m/84'/0'/9'",
      format: 'ledger',
    });
    act(() => hook.result.current.handleFormDataChange({ label: 'My custom label' }));

    act(() => hook.result.current.handleSelectMethod('qr_code'));

    expect(hook.result.current.formData).toEqual({
      label: 'My custom label',
      xpub: '',
      fingerprint: '',
      derivationPath: DEFAULT_PATH,
      parsedAccounts: [],
      selectedAccounts: new Set(),
    });
  });

  it('resets a prior xpub when a USB connection result is applied', async () => {
    const hook = renderDeviceForm();
    await importFile(hook, {
      xpub: 'xpub-a',
      fingerprint: 'a1b2c3d4',
      derivationPath: "m/84'/0'/9'",
      format: 'ledger',
    });

    hook.rerender(baseDeps({
      connectionResult: {
        modelId: selectedModel.id,
        fingerprint: 'bbbbbbbb',
        accounts: [account(0)],
      },
    }));

    await waitFor(() => expect(hook.result.current.formData.fingerprint).toBe('bbbbbbbb'));
    expect(hook.result.current.formData.xpub).toBe('');
    expect(hook.result.current.formData.derivationPath).toBe(DEFAULT_PATH);
  });
});
