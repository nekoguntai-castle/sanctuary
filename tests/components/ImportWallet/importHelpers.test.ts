import { beforeEach,describe,expect,it,vi } from 'vitest';
import {
MAX_INPUT_SIZE,
buildDescriptorFromXpub,
getDerivationPath,
scriptTypeOptions,
validateImportData,
validateInputData,
} from '../../../components/ImportWallet/importHelpers';
import { ApiError } from '../../../src/api/client';
import * as walletsApi from '../../../src/api/wallets';

vi.mock('../../../src/api/wallets', () => ({
  validateImport: vi.fn(),
}));

describe('importHelpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds derivation paths for each supported script type', () => {
    expect(getDerivationPath('native_segwit', 0)).toBe("m/84'/0'/0'");
    expect(getDerivationPath('nested_segwit', 1)).toBe("m/49'/0'/1'");
    expect(getDerivationPath('taproot', 2)).toBe("m/86'/0'/2'");
    expect(getDerivationPath('legacy', 3)).toBe("m/44'/0'/3'");
  });

  it('builds descriptors for all script types and path normalization', () => {
    const fingerprint = 'a1b2c3d4';
    const path = "m/84'/0'/7'";
    const xpub = 'xpub123';

    expect(buildDescriptorFromXpub('native_segwit', fingerprint, path, xpub)).toBe(
      'wpkh([a1b2c3d4/84h/0h/7h]xpub123/0/*)',
    );
    expect(buildDescriptorFromXpub('nested_segwit', fingerprint, path, xpub)).toBe(
      'sh(wpkh([a1b2c3d4/84h/0h/7h]xpub123/0/*))',
    );
    expect(buildDescriptorFromXpub('taproot', fingerprint, path, xpub)).toBe(
      'tr([a1b2c3d4/84h/0h/7h]xpub123/0/*)',
    );
    expect(buildDescriptorFromXpub('legacy', fingerprint, path, xpub)).toBe(
      'pkh([a1b2c3d4/84h/0h/7h]xpub123/0/*)',
    );

    // Type coercion validates defensive default branch.
    expect(buildDescriptorFromXpub('unknown' as any, fingerprint, path, xpub)).toBe(
      'wpkh([a1b2c3d4/84h/0h/7h]xpub123/0/*)',
    );
  });

  it('exposes script type options with recommended native segwit entry', () => {
    expect(scriptTypeOptions.map(o => o.value)).toEqual([
      'native_segwit',
      'nested_segwit',
      'taproot',
      'legacy',
    ]);
    expect(scriptTypeOptions[0].description).toContain('Recommended');
  });

  it('validates input size and JSON syntax heuristics', () => {
    const oversized = 'x'.repeat(MAX_INPUT_SIZE + 1);
    expect(validateInputData(oversized, 'descriptor')).toContain('Input too large');

    expect(validateInputData('{"ok":true}', 'json')).toBeNull();

    // Invalid but short JSON-looking payload does not show parse error.
    expect(validateInputData('{not-json', 'json')).toBeNull();

    // Invalid and large JSON-looking payload surfaces parse guidance.
    expect(validateInputData(`{${'x'.repeat(600)}`, 'json')).toBe(
      'Invalid JSON format. Please check the file contents.',
    );
  });

  it('sends descriptor payload for descriptor format and auto-fills suggested name', async () => {
    vi.mocked(walletsApi.validateImport).mockResolvedValueOnce({
      valid: true,
      suggestedName: 'Suggested Wallet',
    } as never);

    const setValidationResult = vi.fn();
    const setValidationError = vi.fn();
    const setWalletName = vi.fn();

    const ok = await validateImportData(
      'descriptor',
      'wpkh([abcd]xpub/0/*)',
      '',
      setValidationResult,
      setValidationError,
      setWalletName,
    );

    expect(ok).toBe(true);
    expect(setValidationError).toHaveBeenNthCalledWith(1, null);
    expect(walletsApi.validateImport).toHaveBeenCalledWith({
      descriptor: 'wpkh([abcd]xpub/0/*)',
      json: undefined,
    });
    expect(setValidationResult).toHaveBeenCalledWith({
      valid: true,
      suggestedName: 'Suggested Wallet',
    });
    expect(setWalletName).toHaveBeenCalledWith('Suggested Wallet');
  });

  it('respects dataOverride and does not overwrite a non-empty wallet name', async () => {
    vi.mocked(walletsApi.validateImport).mockResolvedValueOnce({ valid: true, suggestedName: 'Ignored' } as never);

    const setValidationResult = vi.fn();
    const setValidationError = vi.fn();
    const setWalletName = vi.fn();

    const ok = await validateImportData(
      'hardware',
      'unused-import-data',
      'Manual Name',
      setValidationResult,
      setValidationError,
      setWalletName,
      undefined,
      'wpkh([override]xpub/0/*)',
    );

    expect(ok).toBe(true);
    expect(walletsApi.validateImport).toHaveBeenCalledWith({
      descriptor: 'wpkh([override]xpub/0/*)',
      json: undefined,
    });
    expect(setWalletName).not.toHaveBeenCalled();
  });

  it('sends JSON for qr_code by default, but descriptor when qr payload looks like descriptor', async () => {
    vi.mocked(walletsApi.validateImport)
      .mockResolvedValueOnce({ valid: true } as never)
      .mockResolvedValueOnce({ valid: true } as never);

    const setValidationResult = vi.fn();
    const setValidationError = vi.fn();
    const setWalletName = vi.fn();

    const qrJsonOk = await validateImportData(
      'qr_code',
      '{"wallet":"export"}',
      '',
      setValidationResult,
      setValidationError,
      setWalletName,
    );
    expect(qrJsonOk).toBe(true);
    expect(walletsApi.validateImport).toHaveBeenNthCalledWith(1, {
      descriptor: undefined,
      json: '{"wallet":"export"}',
    });

    const qrDescriptorOk = await validateImportData(
      'qr_code',
      'WPKH([ABCD]xpub/0/*)',
      '',
      setValidationResult,
      setValidationError,
      setWalletName,
    );
    expect(qrDescriptorOk).toBe(true);
    expect(walletsApi.validateImport).toHaveBeenNthCalledWith(2, {
      descriptor: 'WPKH([ABCD]xpub/0/*)',
      json: undefined,
    });
  });

  it('returns false and exposes server-side validation errors', async () => {
    vi.mocked(walletsApi.validateImport)
      .mockResolvedValueOnce({ valid: false, error: 'Bad descriptor' } as never)
      .mockResolvedValueOnce({ valid: false } as never);

    const setValidationResult = vi.fn();
    const setValidationError = vi.fn();
    const setWalletName = vi.fn();

    const withError = await validateImportData(
      'descriptor',
      'bad',
      '',
      setValidationResult,
      setValidationError,
      setWalletName,
    );
    expect(withError).toBe(false);
    expect(setValidationError).toHaveBeenLastCalledWith('Bad descriptor');

    const withoutError = await validateImportData(
      'json',
      '{}',
      '',
      setValidationResult,
      setValidationError,
      setWalletName,
    );
    expect(withoutError).toBe(false);
    expect(setValidationError).toHaveBeenLastCalledWith('Invalid import data');
  });

  it('maps ApiError and unknown failures to user-facing validation errors', async () => {
    vi.mocked(walletsApi.validateImport)
      .mockRejectedValueOnce(new ApiError('Validation rejected', 400))
      .mockRejectedValueOnce(new Error('boom'));

    const setValidationResult = vi.fn();
    const setValidationError = vi.fn();
    const setWalletName = vi.fn();

    const apiError = await validateImportData(
      'descriptor',
      'data',
      '',
      setValidationResult,
      setValidationError,
      setWalletName,
    );
    expect(apiError).toBe(false);
    expect(setValidationError).toHaveBeenLastCalledWith('Validation rejected');

    const genericError = await validateImportData(
      'descriptor',
      'data',
      '',
      setValidationResult,
      setValidationError,
      setWalletName,
    );
    expect(genericError).toBe(false);
    expect(setValidationError).toHaveBeenLastCalledWith('Failed to validate import data');
  });
});
