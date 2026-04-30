import { describe, expect, it, vi } from 'vitest';
import {
  RAW_MULTISIG_OPERATIONAL_KEY_ERROR,
  detectRawOperationalKeyInput,
  getRawKeyFallbackFingerprint,
  getRawKeyDescription,
  normalizeOperationalImportData,
} from '../../components/AgentManagement/AgentManagement/inlineOperationalWalletImportModel';

describe('inlineOperationalWalletImportModel', () => {
  const fundingWallet = {
    id: 'funding-1',
    name: 'Funding',
    type: 'multi_sig',
    network: 'testnet',
    accessUserIds: ['user-1'],
    deviceIds: [],
  };

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
      'Nested SegWit extended public key detected.'
    );
    expect(
      getRawKeyDescription({
        kind: 'single_sig',
        key: 'custom',
        scriptType: 'custom' as any,
        requiresScriptTypeSelection: false,
      })
    ).toBeNull();
  });

  it('ignores descriptors and detects raw multisig extended public keys', () => {
    expect(detectRawOperationalKeyInput('wpkh([abcd1234/84h/1h/0h]tpub.../0/*)')).toEqual({
      kind: 'none',
    });
    expect(detectRawOperationalKeyInput('Zpub123')).toEqual({
      kind: 'multi_sig',
      key: 'Zpub123',
    });
    expect(getRawKeyFallbackFingerprint('xpub123')).toMatch(/^[0-9a-f]{8}$/);
    expect(getRawKeyFallbackFingerprint('xpub123')).not.toBe(getRawKeyFallbackFingerprint('xpub124'));
  });

  it('normalizes raw keys through xpub validation and leaves descriptors unchanged', async () => {
    const validateXpub = vi.fn().mockResolvedValue({
      valid: true,
      descriptor: 'tr([00000000/86h/1h/0h]tpub123/0/*)',
      scriptType: 'taproot',
      firstAddress: 'tb1p...',
      xpub: 'tpub123',
      fingerprint: '00000000',
      accountPath: "86'/1'/0'",
    });

    const rawResult = await normalizeOperationalImportData({
      importData: ' tpub123 ',
      rawKeyScriptType: 'taproot',
      selectedFundingWallet: fundingWallet,
      validateXpub,
    });

    expect(rawResult).toEqual({ ok: true, data: 'tr([00000000/86h/1h/0h]tpub123/0/*)' });
    expect(validateXpub).toHaveBeenCalledWith({
      xpub: 'tpub123',
      scriptType: 'taproot',
      network: 'testnet',
      fingerprint: getRawKeyFallbackFingerprint('tpub123'),
    });

    const descriptorResult = await normalizeOperationalImportData({
      importData: ' wpkh([abcd1234/84h/1h/0h]tpub.../0/*) ',
      rawKeyScriptType: 'native_segwit',
      selectedFundingWallet: fundingWallet,
      validateXpub,
    });

    expect(descriptorResult).toEqual({
      ok: true,
      data: 'wpkh([abcd1234/84h/1h/0h]tpub.../0/*)',
    });
    expect(validateXpub).toHaveBeenCalledTimes(1);
  });

  it('uses inferred raw-key script types across supported validation networks', async () => {
    const validateXpub = vi.fn().mockResolvedValue({
      valid: true,
      descriptor: 'wpkh([00000000/49h/0h/0h]ypub123/0/*)',
      scriptType: 'nested_segwit',
      firstAddress: '3...',
      xpub: 'ypub123',
      fingerprint: '00000000',
      accountPath: "49'/0'/0'",
    });

    await expect(
      normalizeOperationalImportData({
        importData: 'ypub123',
        rawKeyScriptType: 'taproot',
        selectedFundingWallet: { ...fundingWallet, network: 'mainnet' },
        validateXpub,
      })
    ).resolves.toEqual({
      ok: true,
      data: 'wpkh([00000000/49h/0h/0h]ypub123/0/*)',
    });

    await normalizeOperationalImportData({
      importData: 'zpub123',
      rawKeyScriptType: 'legacy',
      selectedFundingWallet: { ...fundingWallet, network: 'regtest' },
      validateXpub,
    });

    expect(validateXpub).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        xpub: 'ypub123',
        scriptType: 'nested_segwit',
        network: 'mainnet',
      })
    );
    expect(validateXpub).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        xpub: 'zpub123',
        scriptType: 'native_segwit',
        network: 'regtest',
      })
    );
  });

  it('rejects raw multisig keys and unsupported xpub validation networks', async () => {
    const validateXpub = vi.fn();

    await expect(
      normalizeOperationalImportData({
        importData: 'Vpub123',
        rawKeyScriptType: 'native_segwit',
        selectedFundingWallet: fundingWallet,
        validateXpub,
      })
    ).resolves.toEqual({ ok: false, error: RAW_MULTISIG_OPERATIONAL_KEY_ERROR });

    await expect(
      normalizeOperationalImportData({
        importData: 'xpub123',
        rawKeyScriptType: 'native_segwit',
        selectedFundingWallet: { ...fundingWallet, network: 'signet' },
        validateXpub,
      })
    ).resolves.toEqual({
      ok: false,
      error:
        'Raw extended public key import supports mainnet, testnet, and regtest funding wallets. Use a descriptor or wallet export for this network.',
    });

    expect(validateXpub).not.toHaveBeenCalled();
  });
});
