import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it, vi } from 'vitest';
import type { PsbtSigningContext } from '@sanctuary/shared/schemas/psbtSigningContext';
import type { PSBTSignRequest } from '../../src/services/hardwareWallet/types';
import { validatePsbtSigningRequest } from '../../src/services/hardwareWallet/psbtAccountBinding';

const encoderFailure = vi.hoisted(() => ({ p2sh: false, p2tr: false, p2wpkh: false, p2wsh: false }));

vi.mock('bitcoinjs-lib', async importOriginal => {
  const actual = await importOriginal<typeof import('bitcoinjs-lib')>();
  return {
    ...actual,
    payments: {
      ...actual.payments,
      p2sh: (...args: Parameters<typeof actual.payments.p2sh>) => {
        if (encoderFailure.p2sh) {
          encoderFailure.p2sh = false;
          return {} as ReturnType<typeof actual.payments.p2sh>;
        }
        return actual.payments.p2sh(...args);
      },
      p2tr: (...args: Parameters<typeof actual.payments.p2tr>) => {
        if (encoderFailure.p2tr) {
          encoderFailure.p2tr = false;
          return {} as ReturnType<typeof actual.payments.p2tr>;
        }
        return actual.payments.p2tr(...args);
      },
      p2wpkh: (...args: Parameters<typeof actual.payments.p2wpkh>) => {
        if (encoderFailure.p2wpkh) {
          encoderFailure.p2wpkh = false;
          return {} as ReturnType<typeof actual.payments.p2wpkh>;
        }
        return actual.payments.p2wpkh(...args);
      },
      p2wsh: (...args: Parameters<typeof actual.payments.p2wsh>) => {
        if (encoderFailure.p2wsh) {
          encoderFailure.p2wsh = false;
          return {} as ReturnType<typeof actual.payments.p2wsh>;
        }
        return actual.payments.p2wsh(...args);
      },
    },
  };
});

vi.mock('@sanctuary/shared/constants/walletPolicy', async importOriginal => {
  const actual = await importOriginal<
    typeof import('@sanctuary/shared/constants/walletPolicy')
  >();
  return {
    ...actual,
    accountPathMatchesWalletPolicy: (
      ...args: Parameters<typeof actual.accountPathMatchesWalletPolicy>
    ) => {
      const expectation = args[1];
      if (expectation.walletType === 'multi_sig' && expectation.scriptType === 'legacy') {
        return true;
      }
      return actual.accountPathMatchesWalletPolicy(...args);
    },
  };
});

import {
  ACCOUNT_PATH,
  buildMultisigRequest,
  buildRequest,
  buildSingleSigFamilyRequest,
  FINGERPRINT,
  INPUT_PATH,
  INPUT_TXID,
  mutateContext,
  NETWORK,
  p2wpkhScript,
  PUBKEY,
  replaceRequestInput,
  unsignedTransactionDigest,
  updatePsbt,
  addSecondChangeOutput,
  addSecondOwnedInput,
} from './hardwareWallet/psbtAccountBindingTestHarness';

describe('hardware PSBT account binding', () => {
  it('accepts an exact server-issued account and change binding', () => {
    const validated = validatePsbtSigningRequest(buildRequest(), FINGERPRINT);

    expect(validated.connectedSigner.accountPath).toBe(ACCOUNT_PATH);
    expect(validated.changeOutputIndexes).toEqual([1]);
    expect(validated.network).toBe('testnet3');
  });

  it.each(['native_segwit', 'nested_segwit'] as const)(
    'accepts exact %s sorted-multisig input and change scripts',
    scriptType => {
      const request = buildMultisigRequest(scriptType);
      const validated = validatePsbtSigningRequest(request, FINGERPRINT);
      expect(validated.context.signers).toHaveLength(2);
      expect(validated.changeOutputIndexes).toEqual([1]);
    },
  );

  it.each(['legacy', 'nested_segwit'] as const)(
    'accepts an exact single-signature %s script family',
    scriptType => {
      const validated = validatePsbtSigningRequest(
        buildSingleSigFamilyRequest(scriptType),
        FINGERPRINT.toUpperCase(),
      );
      expect(validated.context.scriptType).toBe(scriptType);
    },
  );

  it('rejects witness-only previous-output evidence for legacy signing', () => {
    const base = buildSingleSigFamilyRequest('legacy');
    const original = bitcoin.Psbt.fromBase64(base.psbt, { network: NETWORK });
    const request = replaceRequestInput(base, {
      hash: base.signingContext!.inputs[0].txid,
      index: base.signingContext!.inputs[0].vout,
      witnessUtxo: {
        script: Uint8Array.from(Buffer.from(base.signingContext!.inputs[0].scriptPubKey, 'hex')),
        value: 50_000n,
      },
      bip32Derivation: original.data.inputs[0].bip32Derivation,
    });

    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/legacy input 0 requires an authenticated nonWitnessUtxo/i);
  });

  it('accepts exact Taproot key-path BIP371 input and change metadata', () => {
    const validated = validatePsbtSigningRequest(
      buildSingleSigFamilyRequest('taproot'),
      FINGERPRINT,
    );
    expect(validated.context.scriptType).toBe('taproot');
    expect(validated.psbt.data.inputs[0].bip32Derivation).toBeUndefined();
    expect(validated.psbt.data.inputs[0].tapBip32Derivation?.[0].leafHashes).toEqual([]);
    expect(validated.psbt.data.inputs[0].tapInternalKey).toHaveLength(32);
    expect(validated.psbt.data.outputs[1].tapInternalKey).toHaveLength(32);
  });

  it('rejects imported Taproot multisig context before consuming its signer evidence', () => {
    const request = mutateContext(buildSingleSigFamilyRequest('taproot'), context => {
      context.walletType = 'multi_sig';
    });

    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow('Taproot multisig is not supported');
  });

  it.each([
    ['tapBip32Derivation', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].tapBip32Derivation = [{
        masterFingerprint: Uint8Array.from(Buffer.from(FINGERPRINT, 'hex')),
        path: INPUT_PATH, pubkey: Uint8Array.from(Buffer.alloc(32, 1)), leafHashes: [],
      }];
    }],
    ['tapInternalKey', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].tapInternalKey = Uint8Array.from(Buffer.alloc(32, 1));
    }],
    ['tapKeySig', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].tapKeySig = Uint8Array.from(Buffer.alloc(64, 1));
    }],
    ['tapScriptSig', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].tapScriptSig = [{
        pubkey: Uint8Array.from(Buffer.alloc(32, 1)),
        leafHash: Uint8Array.from(Buffer.alloc(32, 2)),
        signature: Uint8Array.from(Buffer.alloc(64, 3)),
      }];
    }],
    ['tapLeafScript', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].tapLeafScript = [{
        controlBlock: Uint8Array.from(Buffer.concat([Buffer.of(0xc0), Buffer.alloc(32, 1)])),
        leafVersion: 0xc0,
        script: Uint8Array.from(Buffer.of(0x51)),
      }];
    }],
    ['tapMerkleRoot', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].tapMerkleRoot = Uint8Array.from(Buffer.alloc(32, 1));
    }],
  ])('rejects non-Taproot browser input field %s', (_field, mutate) => {
    const request = updatePsbt(buildRequest(), mutate);
    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow('non-Taproot map contains Taproot metadata');
  });

  it.each([
    ['tapBip32Derivation', (psbt: bitcoin.Psbt) => {
      psbt.data.outputs[1].tapBip32Derivation = [{
        masterFingerprint: Uint8Array.from(Buffer.from(FINGERPRINT, 'hex')),
        path: `${ACCOUNT_PATH}/1/4`, pubkey: Uint8Array.from(Buffer.alloc(32, 1)), leafHashes: [],
      }];
    }],
    ['tapInternalKey', (psbt: bitcoin.Psbt) => {
      psbt.data.outputs[1].tapInternalKey = Uint8Array.from(Buffer.alloc(32, 1));
    }],
    ['tapTree', (psbt: bitcoin.Psbt) => {
      psbt.data.outputs[1].tapTree = {
        leaves: [{ depth: 0, leafVersion: 0xc0, script: Uint8Array.from(Buffer.of(0x51)) }],
      };
    }],
  ])('rejects non-Taproot browser output field %s', (_field, mutate) => {
    const request = updatePsbt(buildRequest(), mutate);
    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow('non-Taproot map contains Taproot metadata');
  });

  it.each([
    ['missing BIP371 derivation', (psbt: bitcoin.Psbt) => {
      delete psbt.data.inputs[0].tapBip32Derivation;
    }],
    ['wrong internal key', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].tapInternalKey = Uint8Array.from(Buffer.alloc(32, 9));
    }],
    ['nonempty leaf hashes', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].tapBip32Derivation![0].leafHashes = [Uint8Array.from(Buffer.alloc(32, 1))];
    }],
    ['legacy derivation mixing', (psbt: bitcoin.Psbt) => {
      const tap = psbt.data.inputs[0].tapBip32Derivation![0];
      psbt.data.inputs[0].bip32Derivation = [{
        masterFingerprint: tap.masterFingerprint,
        path: tap.path,
        pubkey: Uint8Array.from(Buffer.concat([Buffer.from([2]), Buffer.from(tap.pubkey)])),
      }];
    }],
    ['redeemScript mixing', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].redeemScript = Uint8Array.from(Buffer.of(0x51));
    }],
    ['witnessScript mixing', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].witnessScript = Uint8Array.from(Buffer.of(0x51));
    }],
    ['script-path leaf', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].tapLeafScript = [{
        controlBlock: Uint8Array.from(Buffer.concat([Buffer.of(0xc0), Buffer.alloc(32, 1)])),
        leafVersion: 0xc0,
        script: Uint8Array.from(Buffer.of(0x51)),
      }];
    }],
    ['script-path signature', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].tapScriptSig = [{
        pubkey: Uint8Array.from(Buffer.alloc(32, 1)),
        leafHash: Uint8Array.from(Buffer.alloc(32, 2)),
        signature: Uint8Array.from(Buffer.alloc(64, 3)),
      }];
    }],
    ['script-path merkle root', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].tapMerkleRoot = Uint8Array.from(Buffer.alloc(32, 2));
    }],
  ])('rejects Taproot %s', (_label, mutate) => {
    const request = updatePsbt(buildSingleSigFamilyRequest('taproot'), mutate);
    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/Taproot|signer origins/i);
  });

  it('rejects an in-memory Taproot derivation whose internal key is not x-only', () => {
    const request = buildSingleSigFamilyRequest('taproot');
    const malformed = bitcoin.Psbt.fromBase64(request.psbt, { network: NETWORK });
    malformed.data.inputs[0].tapBip32Derivation![0].pubkey = Uint8Array.from(Buffer.alloc(31, 1));
    const fromBase64Spy = vi.spyOn(bitcoin.Psbt, 'fromBase64').mockReturnValue(malformed);

    try {
      expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
        .toThrow(/internal key must be x-only/i);
    } finally {
      fromBase64Spy.mockRestore();
    }
  });

  it('rejects Taproot script-path metadata on a change output', () => {
    const request = updatePsbt(buildSingleSigFamilyRequest('taproot'), psbt => {
      psbt.data.outputs[1].tapTree = {
        leaves: [{ depth: 0, leafVersion: 0xc0, script: Uint8Array.from(Buffer.of(0x51)) }],
      };
    });

    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/script-path metadata is not supported/i);
  });

  it.each([
    ['missing context', (request: PSBTSignRequest) => ({ ...request, signingContext: undefined })],
    ['missing input index', (request: PSBTSignRequest) => {
      const context = structuredClone(request.signingContext!) as unknown as {
        inputs: Array<Record<string, unknown>>;
      };
      delete context.inputs[0].inputIndex;
      return { ...request, signingContext: context as unknown as PsbtSigningContext };
    }],
    ['negative change index', (request: PSBTSignRequest) => mutateContext(request, context => {
      context.changeOutputs[0].outputIndex = -1;
    })],
  ])('rejects malformed server evidence with a %s', (_label, mutate) => {
    expect(() => validatePsbtSigningRequest(mutate(buildRequest()), FINGERPRINT))
      .toThrow(/missing or malformed/i);
  });

  it('rejects a request wallet identity different from its evidence', () => {
    expect(() => validatePsbtSigningRequest(
      { ...buildRequest(), walletId: 'other-wallet' },
      FINGERPRINT,
    )).toThrow(/wallet identity/i);
  });

  it.each([
    ['input', (context: PsbtSigningContext) => {
      context.inputs.push(structuredClone(context.inputs[0]));
    }],
    ['change output', (context: PsbtSigningContext) => {
      context.changeOutputs.push(structuredClone(context.changeOutputs[0]));
    }],
  ])('rejects duplicate %s indexes', (_label, mutate) => {
    expect(() => validatePsbtSigningRequest(
      mutateContext(buildRequest(), mutate),
      FINGERPRINT,
    )).toThrow(/indexes are missing or duplicated/i);
  });

  it('rejects a non-contiguous immutable signer order', () => {
    const request = buildMultisigRequest('native_segwit');
    expect(() => validatePsbtSigningRequest(
      mutateContext(request, context => { context.signers[1].signerIndex = 3; }),
      FINGERPRINT,
    )).toThrow(/signer order is not contiguous/i);
  });

  it('rejects an ambiguous connected fingerprint and a missing fingerprint', () => {
    const request = mutateContext(buildRequest(), context => {
      context.signers.push({ ...context.signers[0], signerIndex: 1, deviceId: 'device-2' });
    });
    expect(() => validatePsbtSigningRequest(request, FINGERPRINT)).toThrow(/exactly one/i);
    expect(() => validatePsbtSigningRequest(buildRequest(), null)).toThrow(/exactly one/i);
  });

  it('rejects a PSBT that cannot be parsed', () => {
    expect(() => validatePsbtSigningRequest(
      { ...buildRequest(), psbt: 'not-a-psbt' },
      FINGERPRINT,
    )).toThrow(/cannot be parsed/i);
  });

  it.each([
    ['wallet', (context: PsbtSigningContext) => { context.walletId = 'wallet-2'; }],
    ['network', (context: PsbtSigningContext) => { context.network = 'mainnet'; }],
    ['canonical policy', (context: PsbtSigningContext) => {
      context.canonicalPolicyId = 'single-sig-legacy-bip44-v1';
    }],
    ['canonical policy version', (context: PsbtSigningContext) => {
      context.canonicalPolicyVersion = 2;
    }],
    ['fingerprint', (context: PsbtSigningContext) => {
      context.inputs[0].signerOrigins[0].masterFingerprint = 'deadbeef';
    }],
    ['path', (context: PsbtSigningContext) => {
      context.inputs[0].signerOrigins[0].path = "m/84'/1'/8'/0/3";
    }],
    ['pubkey', (context: PsbtSigningContext) => {
      context.inputs[0].signerOrigins[0].pubkey = `02${'33'.repeat(32)}`;
    }],
    ['input script', (context: PsbtSigningContext) => {
      context.inputs[0].scriptPubKey = `0014${'44'.repeat(20)}`;
    }],
    ['change script', (context: PsbtSigningContext) => {
      context.changeOutputs[0].scriptPubKey = `0014${'55'.repeat(20)}`;
    }],
  ])('rejects a wrong %s binding', (_label, mutate) => {
    expect(() => validatePsbtSigningRequest(
      mutateContext(buildRequest(), mutate),
      FINGERPRINT,
    )).toThrow(/PSBT signing context/i);
  });

  it('rejects an origin absent from the immutable signer snapshot', () => {
    const fingerprint = Uint8Array.from(Buffer.from('deadbeef', 'hex'));
    const request = updatePsbt(buildRequest(), psbt => {
      psbt.data.inputs[0].bip32Derivation![0].masterFingerprint = fingerprint;
    });
    request.signingContext!.inputs[0].signerOrigins[0].masterFingerprint = 'deadbeef';

    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/not an immutable wallet signer/i);
  });

  it('rejects a bound map missing all signer-origin metadata', () => {
    const request = updatePsbt(buildRequest(), psbt => {
      delete psbt.data.inputs[0].bip32Derivation;
    });
    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/signer origins differ/i);
  });

  it('rejects fewer input origins than immutable wallet signers', () => {
    const request = updatePsbt(buildMultisigRequest('native_segwit'), psbt => {
      psbt.data.inputs[0].bip32Derivation = psbt.data.inputs[0].bip32Derivation!.slice(0, 1);
    });
    request.signingContext!.inputs[0].signerOrigins =
      request.signingContext!.inputs[0].signerOrigins.slice(0, 1);

    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/origin count/i);
  });

  it('rejects duplicate signer-origin fingerprints', () => {
    const request = updatePsbt(buildMultisigRequest('native_segwit'), psbt => {
      psbt.data.inputs[0].bip32Derivation![1].masterFingerprint =
        Uint8Array.from(Buffer.from(FINGERPRINT, 'hex'));
    });
    request.signingContext!.inputs[0].signerOrigins[1].masterFingerprint = FINGERPRINT;

    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/duplicate fingerprint/i);
  });

  it('rejects a single-signature map containing multiple origins', () => {
    const secondFingerprint = 'eeff0011';
    const secondPubkey = Uint8Array.from(Buffer.from(
      '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
      'hex',
    ));
    const request = updatePsbt(buildRequest(), psbt => {
      psbt.data.inputs[0].bip32Derivation!.push({
        ...psbt.data.inputs[0].bip32Derivation![0],
        masterFingerprint: Uint8Array.from(Buffer.from(secondFingerprint, 'hex')),
        pubkey: secondPubkey,
      });
    });
    request.signingContext!.signers.push({
      ...request.signingContext!.signers[0],
      signerIndex: 1,
      deviceId: 'device-2',
      deviceAccountId: 'account-2',
      masterFingerprint: secondFingerprint,
    });
    request.signingContext!.inputs[0].signerOrigins.push({
      ...request.signingContext!.inputs[0].signerOrigins[0],
      masterFingerprint: secondFingerprint,
      pubkey: Buffer.from(secondPubkey).toString('hex'),
    });

    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/must contain one origin/i);
  });

  it.each([
    ['input', (request: PSBTSignRequest) => {
      request.signingContext!.inputs[0].inputIndex = 9;
    }],
    ['change output', (request: PSBTSignRequest) => {
      request.signingContext!.changeOutputs[0].outputIndex = 9;
    }],
  ])('rejects an absent bound %s', (_label, mutate) => {
    const request = buildRequest();
    mutate(request);
    expect(() => validatePsbtSigningRequest(request, FINGERPRINT)).toThrow(/is absent/i);
  });

  it.each([
    ['txid', (context: PsbtSigningContext) => { context.inputs[0].txid = '33'.repeat(32); }],
    ['vout', (context: PsbtSigningContext) => { context.inputs[0].vout = 1; }],
  ])('rejects a bound input with a different %s', (_label, mutate) => {
    expect(() => validatePsbtSigningRequest(
      mutateContext(buildRequest(), mutate),
      FINGERPRINT,
    )).toThrow(/outpoint differs/i);
  });

  it('rejects a prior output amount and script inconsistent with the binding', () => {
    const amountRequest = mutateContext(buildRequest(), context => {
      context.inputs[0].amountSats = '49999';
    });
    expect(() => validatePsbtSigningRequest(amountRequest, FINGERPRINT))
      .toThrow(/previous output differs/i);

    const request = updatePsbt(buildRequest(), psbt => {
      psbt.data.inputs[0].witnessUtxo!.script = Uint8Array.from(Buffer.from(`0014${'44'.repeat(20)}`, 'hex'));
    });
    request.signingContext!.inputs[0].scriptPubKey = `0014${'44'.repeat(20)}`;
    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/derived script family/i);
  });

  it('rejects a change path that is malformed or not branch 1', () => {
    expect(() => validatePsbtSigningRequest(
      mutateContext(buildRequest(), context => {
        context.changeOutputs[0].addressPath = INPUT_PATH;
        context.changeOutputs[0].signerOrigins[0].path = INPUT_PATH;
      }),
      FINGERPRINT,
    )).toThrow(/not on branch 1/i);
  });

  it('checks every owned input rather than trusting the first input', () => {
    const request = buildRequest();
    const psbt = bitcoin.Psbt.fromBase64(request.psbt, { network: NETWORK });
    psbt.addInput({
      hash: '33'.repeat(32),
      index: 1,
      witnessUtxo: { script: p2wpkhScript(), value: 7_000n },
      bip32Derivation: [{
        masterFingerprint: Uint8Array.from(Buffer.from(FINGERPRINT, 'hex')),
        path: `${ACCOUNT_PATH}/0/9`,
        pubkey: Uint8Array.from(PUBKEY),
      }],
    });
    const context = structuredClone(request.signingContext!);
    context.inputs.push({
      ...context.inputs[0],
      inputIndex: 1,
      txid: '33'.repeat(32),
      vout: 1,
      amountSats: '7000',
      addressPath: `${ACCOUNT_PATH}/0/9`,
      signerOrigins: [{
        ...context.inputs[0].signerOrigins[0],
        path: `${ACCOUNT_PATH}/0/8`,
      }],
    });

    expect(() => validatePsbtSigningRequest(
      { ...request, psbt: psbt.toBase64(), signingContext: context },
      FINGERPRINT,
    )).toThrow(/PSBT signing context/i);
  });

  it('accepts and orders exact evidence for multiple owned inputs', () => {
    const request = addSecondOwnedInput(buildRequest());
    request.signingContext!.inputs.reverse();

    const validated = validatePsbtSigningRequest({
      ...request,
      inputPaths: [INPUT_PATH, `${ACCOUNT_PATH}/0/9`],
    }, FINGERPRINT);
    expect(validated.context.inputs).toHaveLength(2);
  });

  it('accepts and orders exact evidence for multiple change outputs', () => {
    const request = addSecondChangeOutput(buildRequest());

    const validated = validatePsbtSigningRequest({
      ...request,
      changeOutputs: [2, 1],
    }, FINGERPRINT);
    expect(validated.changeOutputIndexes).toEqual([1, 2]);
  });

  it('rejects one mismatched legacy input path among multiple inputs', () => {
    const request = addSecondOwnedInput(buildRequest());
    expect(() => validatePsbtSigningRequest({
      ...request,
      inputPaths: [INPUT_PATH, `${ACCOUNT_PATH}/0/8`],
    }, FINGERPRINT)).toThrow(/legacy inputPaths disagree/i);
  });

  it('accepts reversed server change bindings and matching legacy hints', () => {
    const request = addSecondChangeOutput(buildRequest());
    request.signingContext!.changeOutputs.reverse();
    const validated = validatePsbtSigningRequest({
      ...request,
      changeOutputs: [2, 1],
    }, FINGERPRINT);
    expect(validated.changeOutputIndexes).toEqual([2, 1]);
  });

  it('rejects one mismatched legacy change hint among multiple changes', () => {
    const request = addSecondChangeOutput(buildRequest());
    expect(() => validatePsbtSigningRequest({
      ...request,
      changeOutputs: [1, 3],
    }, FINGERPRINT)).toThrow(/legacy changeOutputs disagree/i);
  });

  it('rejects forged change metadata on an external output', () => {
    const request = buildRequest();
    const psbt = bitcoin.Psbt.fromBase64(request.psbt, { network: NETWORK });
    psbt.updateOutput(0, {
      bip32Derivation: psbt.data.outputs[1].bip32Derivation,
    });

    expect(() => validatePsbtSigningRequest(
      { ...request, psbt: psbt.toBase64() },
      FINGERPRINT,
    )).toThrow(/external output/i);
  });

  it('rejects wallet derivation metadata on an unbound input', () => {
    const request = updatePsbt(buildRequest(), psbt => {
      psbt.addInput({
        hash: '33'.repeat(32),
        index: 0,
        witnessUtxo: { script: p2wpkhScript(), value: 1_000n },
        bip32Derivation: psbt.data.inputs[0].bip32Derivation,
      });
    });

    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/unbound input/i);
  });

  it('allows an unbound external input only when it has no wallet derivation metadata', () => {
    const request = updatePsbt(buildRequest(), psbt => {
      psbt.addInput({
        hash: '33'.repeat(32),
        index: 0,
        witnessUtxo: { script: p2wpkhScript(), value: 1_000n },
      });
    });
    expect(validatePsbtSigningRequest(request, FINGERPRINT).context.inputs).toHaveLength(1);
  });

  it.each(['redeemScript', 'witnessScript'] as const)(
    'rejects forged external-output %s metadata',
    field => {
      const request = updatePsbt(buildRequest(), psbt => {
        psbt.data.outputs[0][field] = p2wpkhScript();
      });
      expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
        .toThrow(/forged change metadata/i);
    },
  );

  it('rejects a multisig map missing its witnessScript', () => {
    const request = updatePsbt(buildMultisigRequest('native_segwit'), psbt => {
      delete psbt.data.inputs[0].witnessScript;
    });
    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/missing witnessScript/i);
  });

  it('rejects a multisig witnessScript with signer keys different from its origins', () => {
    const request = updatePsbt(buildMultisigRequest('native_segwit'), psbt => {
      psbt.data.inputs[0].witnessScript = bitcoin.script.compile([
        bitcoin.opcodes.OP_1,
        PUBKEY,
        bitcoin.opcodes.OP_1,
        bitcoin.opcodes.OP_CHECKMULTISIG,
      ]);
    });
    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/does not contain the bound signer pubkeys/i);
  });

  it('rejects one drifted origin in an otherwise complete multisig binding', () => {
    const request = buildMultisigRequest('native_segwit');
    const psbt = bitcoin.Psbt.fromBase64(request.psbt, { network: NETWORK });
    psbt.data.inputs[0].bip32Derivation![1].path = `${request.signingContext!.signers[1].accountPath}/0/8`;
    expect(() => validatePsbtSigningRequest({ ...request, psbt: psbt.toBase64() }, FINGERPRINT))
      .toThrow(/signer origins differ/i);
  });

  it('rejects one drifted witnessScript key in an otherwise complete multisig script', () => {
    const request = updatePsbt(buildMultisigRequest('native_segwit'), psbt => {
      const exactKey = psbt.data.inputs[0].bip32Derivation![0].pubkey;
      const driftedKey = Uint8Array.from(Buffer.from(
        '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
        'hex',
      ));
      psbt.data.inputs[0].witnessScript = bitcoin.payments.p2ms({
        m: 2,
        pubkeys: [exactKey, driftedKey].sort((a, b) => Buffer.from(a).compare(Buffer.from(b))),
        network: NETWORK,
      }).output!;
    });
    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/does not contain the bound signer pubkeys/i);
  });

  it('rejects a malformed multisig witnessScript that cannot be decompiled', () => {
    const request = updatePsbt(buildMultisigRequest('native_segwit'), psbt => {
      psbt.data.inputs[0].witnessScript = Uint8Array.of(bitcoin.opcodes.OP_PUSHDATA1);
    });
    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/does not contain the bound signer pubkeys/i);
  });

  it('rejects a multisig script family outside the canonical supported set', () => {
    const accountPath = "m/44'/1'/7'";
    const inputPath = `${accountPath}/0/5`;
    const changePath = `${accountPath}/1/6`;
    const request = updatePsbt(buildMultisigRequest('native_segwit'), psbt => {
      for (const origin of psbt.data.inputs[0].bip32Derivation!) origin.path = inputPath;
      for (const origin of psbt.data.outputs[1].bip32Derivation!) origin.path = changePath;
    });
    const context = request.signingContext!;
    context.scriptType = 'legacy';
    context.canonicalPolicyId = 'single-sig-legacy-bip44-v1';
    for (const signer of context.signers) signer.accountPath = accountPath;
    context.inputs[0].addressPath = inputPath;
    for (const origin of context.inputs[0].signerOrigins) origin.path = inputPath;
    context.changeOutputs[0].addressPath = changePath;
    for (const origin of context.changeOutputs[0].signerOrigins) origin.path = changePath;

    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/unsupported multisig script family/i);
  });

  it('fails closed when bitcoinjs cannot encode a validated script wrapper', () => {
    const nativeMultisig = buildMultisigRequest('native_segwit');
    encoderFailure.p2wsh = true;
    expect(() => validatePsbtSigningRequest(nativeMultisig, FINGERPRINT))
      .toThrow(/witnessScript cannot be encoded/i);

    const nestedMultisig = buildMultisigRequest('nested_segwit');
    encoderFailure.p2sh = true;
    expect(() => validatePsbtSigningRequest(nestedMultisig, FINGERPRINT))
      .toThrow(/nested multisig script cannot be encoded/i);

    const nativeSingleSig = buildRequest();
    encoderFailure.p2wpkh = true;
    expect(() => validatePsbtSigningRequest(nativeSingleSig, FINGERPRINT))
      .toThrow(/single-signature pubkey cannot be encoded/i);

    const taprootSingleSig = buildSingleSigFamilyRequest('taproot');
    encoderFailure.p2tr = true;
    expect(() => validatePsbtSigningRequest(taprootSingleSig, FINGERPRINT))
      .toThrow(/Taproot internal key cannot be encoded/i);
  });

  it.each([
    ['missing', (psbt: bitcoin.Psbt) => { delete psbt.data.inputs[0].redeemScript; }],
    ['different', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].redeemScript = p2wpkhScript();
    }],
  ] as const)('rejects a nested multisig %s redeemScript', (_label, mutate) => {
    const request = updatePsbt(buildMultisigRequest('nested_segwit'), psbt => {
      mutate(psbt);
    });
    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/multisig redeemScript differs/i);
  });

  it.each([
    ['missing', (psbt: bitcoin.Psbt) => { delete psbt.data.inputs[0].redeemScript; }],
    ['different', (psbt: bitcoin.Psbt) => {
      psbt.data.inputs[0].redeemScript = p2wpkhScript(Uint8Array.from(Buffer.from(
        '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
        'hex',
      )));
    }],
  ] as const)('rejects a nested single-signature %s redeemScript', (_label, mutate) => {
    const request = updatePsbt(buildSingleSigFamilyRequest('nested_segwit'), psbt => {
      mutate(psbt);
    });
    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/single-signature redeemScript differs/i);
  });

  it('rejects reusing the signing context with a different unsigned transaction', () => {
    const request = buildRequest();
    const psbt = bitcoin.Psbt.fromBase64(request.psbt, { network: NETWORK });
    psbt.setVersion(3);

    expect(() => validatePsbtSigningRequest(
      { ...request, psbt: psbt.toBase64() },
      FINGERPRINT,
    )).toThrow(/unsigned transaction digest/i);
  });

  it('rejects a nonWitnessUtxo whose transaction id differs from the bound outpoint', () => {
    const request = buildRequest();
    const original = bitcoin.Psbt.fromBase64(request.psbt, { network: NETWORK });
    const previous = new bitcoin.Transaction();
    previous.addInput(new Uint8Array(32), 0xffffffff);
    previous.addOutput(p2wpkhScript(), 50_000n);
    const claimedTxid = '33'.repeat(32);
    const psbt = new bitcoin.Psbt({ network: NETWORK });
    psbt.addInput({
      hash: claimedTxid,
      index: 0,
      nonWitnessUtxo: previous.toBuffer(),
      bip32Derivation: original.data.inputs[0].bip32Derivation,
    });
    for (const [index, output] of original.txOutputs.entries()) {
      psbt.addOutput({
        script: output.script,
        value: output.value,
        ...(original.data.outputs[index].bip32Derivation && {
          bip32Derivation: original.data.outputs[index].bip32Derivation,
        }),
      });
    }
    const context = structuredClone(request.signingContext!);
    context.inputs[0].txid = claimedTxid;
    context.inputs[0].vout = 0;
    context.unsignedTransactionDigest = unsignedTransactionDigest(psbt);

    expect(() => validatePsbtSigningRequest(
      { ...request, psbt: psbt.toBase64(), signingContext: context },
      FINGERPRINT,
    )).toThrow(/nonWitnessUtxo transaction id/i);
  });

  it('accepts authenticated nonWitnessUtxo-only previous-output evidence', () => {
    const base = buildRequest();
    const original = bitcoin.Psbt.fromBase64(base.psbt, { network: NETWORK });
    const previous = new bitcoin.Transaction();
    previous.addInput(new Uint8Array(32), 0xffffffff);
    previous.addOutput(p2wpkhScript(), 50_000n);
    const request = replaceRequestInput(base, {
      hash: previous.getId(),
      index: 0,
      nonWitnessUtxo: previous.toBuffer(),
      bip32Derivation: original.data.inputs[0].bip32Derivation,
    });
    request.signingContext!.inputs[0].txid = previous.getId();
    request.signingContext!.inputs[0].vout = 0;

    expect(validatePsbtSigningRequest(request, FINGERPRINT).context.inputs[0].amountSats)
      .toBe('50000');
  });

  it('rejects a nonWitnessUtxo whose referenced output is absent', () => {
    const base = buildRequest();
    const original = bitcoin.Psbt.fromBase64(base.psbt, { network: NETWORK });
    const previous = new bitcoin.Transaction();
    previous.addInput(new Uint8Array(32), 0xffffffff);
    previous.addOutput(p2wpkhScript(), 50_000n);
    const request = replaceRequestInput(base, {
      hash: previous.getId(),
      index: 9,
      nonWitnessUtxo: previous.toBuffer(),
      bip32Derivation: original.data.inputs[0].bip32Derivation,
    });
    request.signingContext!.inputs[0].txid = previous.getId();
    request.signingContext!.inputs[0].vout = 9;

    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/previous output is missing/i);
  });

  it('rejects an input with no previous-output evidence', () => {
    const base = buildRequest();
    const original = bitcoin.Psbt.fromBase64(base.psbt, { network: NETWORK });
    const request = replaceRequestInput(base, {
      hash: INPUT_TXID,
      index: 2,
      bip32Derivation: original.data.inputs[0].bip32Derivation,
    });

    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/missing previous-output data/i);
  });

  it('rejects conflicting witnessUtxo and authenticated nonWitnessUtxo evidence', () => {
    const request = buildRequest();
    const original = bitcoin.Psbt.fromBase64(request.psbt, { network: NETWORK });
    const previous = new bitcoin.Transaction();
    previous.addInput(new Uint8Array(32), 0xffffffff);
    previous.addOutput(p2wpkhScript(), 51_000n);
    const txid = previous.getId();
    const psbt = new bitcoin.Psbt({ network: NETWORK });
    psbt.addInput({
      hash: txid,
      index: 0,
      witnessUtxo: { script: p2wpkhScript(), value: 50_000n },
      nonWitnessUtxo: previous.toBuffer(),
      bip32Derivation: original.data.inputs[0].bip32Derivation,
    });
    for (const [index, output] of original.txOutputs.entries()) {
      psbt.addOutput({
        script: output.script,
        value: output.value,
        ...(original.data.outputs[index].bip32Derivation && {
          bip32Derivation: original.data.outputs[index].bip32Derivation,
        }),
      });
    }
    const context = structuredClone(request.signingContext!);
    context.inputs[0].txid = txid;
    context.inputs[0].vout = 0;
    context.unsignedTransactionDigest = unsignedTransactionDigest(psbt);

    expect(() => validatePsbtSigningRequest(
      { ...request, psbt: psbt.toBase64(), signingContext: context },
      FINGERPRINT,
    )).toThrow(/witnessUtxo differs from nonWitnessUtxo/i);
  });

  it('rejects a witnessUtxo script conflicting with authenticated nonWitnessUtxo evidence', () => {
    const base = buildRequest();
    const original = bitcoin.Psbt.fromBase64(base.psbt, { network: NETWORK });
    const previous = new bitcoin.Transaction();
    previous.addInput(new Uint8Array(32), 0xffffffff);
    previous.addOutput(p2wpkhScript(), 50_000n);
    const request = replaceRequestInput(base, {
      hash: previous.getId(),
      index: 0,
      witnessUtxo: {
        script: Uint8Array.from(Buffer.from(`0014${'44'.repeat(20)}`, 'hex')),
        value: 50_000n,
      },
      nonWitnessUtxo: previous.toBuffer(),
      bip32Derivation: original.data.inputs[0].bip32Derivation,
    });
    request.signingContext!.inputs[0].txid = previous.getId();
    request.signingContext!.inputs[0].vout = 0;

    expect(() => validatePsbtSigningRequest(request, FINGERPRINT))
      .toThrow(/witnessUtxo differs from nonWitnessUtxo/i);
  });

  it.each([
    ['input count', { inputPaths: [INPUT_PATH, `${ACCOUNT_PATH}/0/9`] }],
    ['input path', { inputPaths: [`${ACCOUNT_PATH}/0/9`] }],
    ['account path', { accountPath: "m/84'/1'/8'" }],
    ['change count', { changeOutputs: [0, 1] }],
    ['change index', { changeOutputs: [0] }],
  ] satisfies Array<[string, Partial<PSBTSignRequest>]>)('rejects a legacy %s hint mismatch', (
    _label,
    hint,
  ) => {
    expect(() => validatePsbtSigningRequest({ ...buildRequest(), ...hint }, FINGERPRINT))
      .toThrow(/legacy .*disagree/i);
  });

  it('accepts legacy hints only when they exactly match the server evidence', () => {
    const request = buildMultisigRequest('native_segwit');
    const signingContext = request.signingContext!;
    const multisigXpubs = Object.fromEntries(
      signingContext.signers.map(signer => [
        signer.masterFingerprint.toUpperCase(),
        signer.accountXpub,
      ]),
    );
    const validated = validatePsbtSigningRequest({
      ...request,
      inputPaths: [signingContext.inputs[0].addressPath],
      accountPath: signingContext.signers[0].accountPath,
      changeOutputs: [1],
      multisigXpubs,
    }, FINGERPRINT);
    expect(validated.connectedSigner.masterFingerprint).toBe(FINGERPRINT);
  });

  it.each([
    ['missing signer', { [FINGERPRINT]: 'tpub-wallet-signer-0' }],
    ['wrong xpub', {
      [FINGERPRINT]: 'wrong-xpub',
      eeff0011: 'tpub-wallet-signer-1',
    }],
  ])('rejects a legacy multisig xpub map with a %s', (_label, multisigXpubs) => {
    expect(() => validatePsbtSigningRequest({
      ...buildMultisigRequest('native_segwit'),
      multisigXpubs,
    }, FINGERPRINT)).toThrow(/multisig xpub map disagrees/i);
  });

  it('rejects a connected device outside the wallet signer set', () => {
    expect(() => validatePsbtSigningRequest(buildRequest(), 'deadbeef'))
      .toThrow(/connected device/i);
  });
});
