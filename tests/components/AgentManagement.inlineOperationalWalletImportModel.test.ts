import { describe, expect, it } from 'vitest';
import {
  RAW_MULTISIG_OPERATIONAL_KEY_ERROR,
  RAW_KEY_ORIGIN_REQUIRED_ERROR,
  detectRawOperationalKeyInput,
  getRawKeyDescription,
  normalizeOperationalImportData,
} from '../../src/components/AgentManagement/AgentManagement/inlineOperationalWalletImportModel';

describe('inlineOperationalWalletImportModel', () => {
  it('detects raw single-sig extended public keys and inferred script types', () => {
    expect(detectRawOperationalKeyInput('xpub123')).toEqual({
      kind: 'single_sig',
      key: 'xpub123',
      scriptType: 'native_segwit',
      requiresScriptTypeSelection: true,
    });
    expect(detectRawOperationalKeyInput('vpub123')).toEqual({
      kind: 'single_sig',
      key: 'vpub123',
      scriptType: 'native_segwit',
      requiresScriptTypeSelection: false,
    });
    expect(detectRawOperationalKeyInput('upub123')).toEqual({
      kind: 'single_sig',
      key: 'upub123',
      scriptType: 'nested_segwit',
      requiresScriptTypeSelection: false,
    });
    expect(getRawKeyDescription(detectRawOperationalKeyInput('ypub123'))).toBe(
      RAW_KEY_ORIGIN_REQUIRED_ERROR
    );
    expect(
      getRawKeyDescription({
        kind: 'single_sig',
        key: 'custom',
        scriptType: 'custom' as any,
        requiresScriptTypeSelection: false,
      })
    ).toBe(RAW_KEY_ORIGIN_REQUIRED_ERROR);
  });

  it('ignores descriptors and detects raw multisig extended public keys', () => {
    expect(detectRawOperationalKeyInput('wpkh([abcd1234/84h/1h/0h]tpub.../0/*)')).toEqual({
      kind: 'none',
    });
    expect(detectRawOperationalKeyInput('Zpub123')).toEqual({
      kind: 'multi_sig',
      key: 'Zpub123',
    });
  });

  it('rejects raw keys without verified origin evidence and leaves descriptors unchanged', async () => {
    const rawResult = await normalizeOperationalImportData({
      importData: ' tpub123 ',
    });

    expect(rawResult).toEqual({ ok: false, error: RAW_KEY_ORIGIN_REQUIRED_ERROR });

    const descriptorResult = await normalizeOperationalImportData({
      importData: ' wpkh([abcd1234/84h/1h/0h]tpub.../0/*) ',
    });

    expect(descriptorResult).toEqual({
      ok: true,
      data: 'wpkh([abcd1234/84h/1h/0h]tpub.../0/*)',
    });
  });

  it('rejects every inferred raw single-sig key without origin evidence', async () => {
    await expect(
      normalizeOperationalImportData({
        importData: 'ypub123',
      })
    ).resolves.toEqual({ ok: false, error: RAW_KEY_ORIGIN_REQUIRED_ERROR });

    await normalizeOperationalImportData({
      importData: 'zpub123',
    });
  });

  it('rejects raw multisig and single-sig keys', async () => {
    await expect(
      normalizeOperationalImportData({
        importData: 'Vpub123',
      })
    ).resolves.toEqual({ ok: false, error: RAW_MULTISIG_OPERATIONAL_KEY_ERROR });

    await expect(
      normalizeOperationalImportData({
        importData: 'xpub123',
      })
    ).resolves.toEqual({
      ok: false,
      error: RAW_KEY_ORIGIN_REQUIRED_ERROR,
    });
  });
});
