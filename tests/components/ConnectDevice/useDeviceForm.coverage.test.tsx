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

const callbacks = {
  saveDevice: vi.fn(async () => undefined),
  mergeDevice: vi.fn(async () => undefined),
  resetQr: vi.fn(),
  resetUsb: vi.fn(),
  resetSave: vi.fn(),
};

function renderDeviceForm(overrides: Partial<UseDeviceFormDeps> = {}) {
  const props: UseDeviceFormDeps = {
    selectedModel,
    scanResult: null,
    connectionResult: null,
    ...callbacks,
    ...overrides,
  };
  return renderHook(
    currentProps => useDeviceForm(currentProps),
    { initialProps: props },
  );
}

describe('useDeviceForm remaining behavioral branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseDeviceJsonMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies a QR label to a user-renamed form while preserving the default path', async () => {
    const hook = renderDeviceForm();

    act(() => {
      hook.result.current.handleFormDataChange({ label: 'Temporary name' });
    });
    hook.rerender({
      selectedModel,
      scanResult: {
        xpub: '',
        fingerprint: 'A1B2C3D4',
        derivationPath: '',
        label: 'Verified Ledger',
        accounts: [account(0)],
        extractedFields: {
          xpub: false,
          fingerprint: true,
          derivationPath: false,
          label: true,
        },
        warning: null,
      },
      connectionResult: null,
      ...callbacks,
    });

    await waitFor(() => expect(hook.result.current.scanned).toBe(true));
    expect(hook.result.current.formData.label).toBe('Verified Ledger');
    expect(hook.result.current.formData.derivationPath).toBe("m/84'/0'/0'");
    expect(hook.result.current.formData.selectedAccounts).toEqual(new Set([0]));
  });

  it('accepts a verified single-account file and records its top-level identity', async () => {
    parseDeviceJsonMock.mockReturnValue({
      xpub: 'xpub-file',
      fingerprint: 'A1B2C3D4',
      derivationPath: "m/84'/0'/4'",
      label: 'File Ledger',
      format: 'ledger',
    });

    class SuccessfulFileReader {
      onload: ((event: { target: { result: string } }) => void) | null = null;
      onerror: (() => void) | null = null;

      readAsText() {
        this.onload?.({ target: { result: 'device export' } });
      }
    }
    vi.stubGlobal('FileReader', SuccessfulFileReader);

    const hook = renderDeviceForm();
    act(() => {
      hook.result.current.handleFormDataChange({ label: 'Custom label' });
      hook.result.current.handleFileUpload({
        target: { files: [new File(['device export'], 'ledger.json')] },
      } as any);
    });

    await waitFor(() => expect(hook.result.current.scanned).toBe(true));
    expect(hook.result.current.formData).toEqual(expect.objectContaining({
      label: 'File Ledger',
      fingerprint: 'A1B2C3D4',
      xpub: 'xpub-file',
      derivationPath: "m/84'/0'/4'",
      parsedAccounts: [],
    }));
  });

  it('saves only selected imported accounts and falls back to top-level evidence', async () => {
    const connectionResult = {
      fingerprint: 'A1B2C3D4',
      accounts: [account(0), account(1)],
    };
    const imported = renderDeviceForm({ connectionResult });
    await waitFor(() => expect(imported.result.current.scanned).toBe(true));

    act(() => imported.result.current.handleToggleAccount(1));
    await act(async () => imported.result.current.handleSave());

    expect(callbacks.saveDevice).toHaveBeenLastCalledWith(expect.objectContaining({
      fingerprint: 'a1b2c3d4',
      accounts: [expect.objectContaining({ xpub: 'xpub-0' })],
    }));
    imported.unmount();

    const topLevel = renderDeviceForm({
      scanResult: {
        xpub: 'xpub-primary',
        fingerprint: 'A1B2C3D4',
        derivationPath: "m/84'/0'/8'",
        extractedFields: {
          xpub: true,
          fingerprint: true,
          derivationPath: true,
          label: false,
        },
        warning: null,
      },
    });
    await waitFor(() => expect(topLevel.result.current.scanned).toBe(true));
    await act(async () => topLevel.result.current.handleSave());

    expect(callbacks.saveDevice).toHaveBeenLastCalledWith(expect.objectContaining({
      xpub: 'xpub-primary',
      derivationPath: "m/84'/0'/8'",
    }));
  });
});
