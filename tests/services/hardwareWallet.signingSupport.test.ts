import { describe, expect, it } from 'vitest';

import {
  getUnsupportedMultisigHardwareSigningMessage,
  isMultisigDerivationPath,
  isMultisigSigningRequest,
  isUnsupportedMultisigHardwareSigner,
} from '../../services/hardwareWallet/signingSupport';

describe('hardware wallet signing support guards', () => {
  it('classifies only Ledger and BitBox as unsupported multisig USB signers', () => {
    expect(isUnsupportedMultisigHardwareSigner('ledger')).toBe(true);
    expect(isUnsupportedMultisigHardwareSigner('bitbox')).toBe(true);
    expect(isUnsupportedMultisigHardwareSigner('trezor')).toBe(false);
    expect(isUnsupportedMultisigHardwareSigner(null)).toBe(false);
  });

  it('detects BIP48 multisig derivation paths without guessing single-sig paths', () => {
    expect(isMultisigDerivationPath("m/48'/0'/0'/2'/0/0")).toBe(true);
    expect(isMultisigDerivationPath("m/48h/1h/0h/1h/1/19")).toBe(true);
    expect(isMultisigDerivationPath("m/84'/0'/0'/0/0")).toBe(false);
    expect(isMultisigDerivationPath(null)).toBe(false);
  });

  it('recognizes multisig signing from xpub maps, request paths, and PSBT metadata', () => {
    expect(isMultisigSigningRequest({
      psbt: 'psbt',
      inputPaths: [],
      multisigXpubs: { aabbccdd: 'xpub-example' },
    })).toBe(true);

    expect(isMultisigSigningRequest({
      psbt: 'psbt',
      inputPaths: ["m/48'/0'/0'/2'/0/0"],
    })).toBe(true);

    expect(isMultisigSigningRequest({
      psbt: 'psbt',
      inputPaths: [],
      accountPath: "m/48'/0'/0'/2'",
    })).toBe(true);

    expect(isMultisigSigningRequest({
      psbt: 'psbt',
      inputPaths: [],
    }, {
      data: {
        inputs: [{ bip32Derivation: [{ path: "m/48'/1'/0'/1'/0/5" }] }],
      },
    })).toBe(true);

    expect(isMultisigSigningRequest({
      psbt: 'psbt',
      inputPaths: [],
    }, {
      data: {
        inputs: [{ witnessScript: Buffer.from('51', 'hex') }],
      },
    })).toBe(true);
  });

  it('keeps single-sig or missing metadata signing requests unblocked', () => {
    expect(isMultisigSigningRequest({
      psbt: 'psbt',
      inputPaths: ["m/84'/0'/0'/0/0"],
      accountPath: "m/84'/0'/0'",
    }, {
      data: {
        inputs: [{ bip32Derivation: [{ path: "m/84'/0'/0'/0/0" }] }],
      },
    })).toBe(false);

    expect(isMultisigSigningRequest({
      psbt: 'psbt',
      inputPaths: [],
    })).toBe(false);
  });

  it('builds a user-safe product-block message', () => {
    expect(getUnsupportedMultisigHardwareSigningMessage('Ledger Nano X')).toContain(
      'Ledger Nano X multisig USB signing is blocked in this release.'
    );
  });
});
