import * as bitcoin from 'bitcoinjs-lib';
import type { PsbtSigningContext } from '@sanctuary/shared/schemas/psbtSigningContext';
import type { PSBTSignRequest } from '../../../src/services/hardwareWallet/types';

export const PUBKEY = Uint8Array.from(Buffer.from(
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  'hex',
));
export const FINGERPRINT = 'aabbccdd';
export const ACCOUNT_PATH = "m/84'/1'/7'";
export const INPUT_PATH = `${ACCOUNT_PATH}/0/3`;
export const CHANGE_PATH = `${ACCOUNT_PATH}/1/4`;
export const INPUT_TXID = '11'.repeat(32);
export const NETWORK = bitcoin.networks.testnet;

export function p2wpkhScript(pubkey = PUBKEY): Uint8Array {
  return bitcoin.payments.p2wpkh({ pubkey, network: NETWORK }).output!;
}

export function unsignedTransactionDigest(psbt: bitcoin.Psbt): string {
  const unsignedTx = psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Uint8Array };
  return Buffer.from(bitcoin.crypto.sha256(unsignedTx.toBuffer())).toString('hex');
}

export function buildRequest(): PSBTSignRequest {
  const inputScript = p2wpkhScript();
  const externalScript = bitcoin.payments.p2wpkh({
    pubkey: Uint8Array.from(Buffer.from(
      '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
      'hex',
    )),
    network: NETWORK,
  }).output!;
  const psbt = new bitcoin.Psbt({ network: NETWORK });
  psbt.addInput({
    hash: INPUT_TXID,
    index: 2,
    witnessUtxo: { script: inputScript, value: 50_000n },
    bip32Derivation: [{
      masterFingerprint: Uint8Array.from(Buffer.from(FINGERPRINT, 'hex')),
      path: INPUT_PATH,
      pubkey: Uint8Array.from(PUBKEY),
    }],
  });
  psbt.addOutput({ script: externalScript, value: 30_000n });
  psbt.addOutput({
    script: inputScript,
    value: 19_000n,
    bip32Derivation: [{
      masterFingerprint: Uint8Array.from(Buffer.from(FINGERPRINT, 'hex')),
      path: CHANGE_PATH,
      pubkey: Uint8Array.from(PUBKEY),
    }],
  });

  const origin = (path: string) => ({
    masterFingerprint: FINGERPRINT,
    path,
    pubkey: Buffer.from(PUBKEY).toString('hex'),
  });
  const signingContext: PsbtSigningContext = {
    version: 1,
    walletId: 'wallet-1',
    network: 'testnet3',
    walletType: 'single_sig',
    scriptType: 'native_segwit',
    canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
    canonicalPolicyVersion: 1,
    descriptorDigest: '22'.repeat(32),
    unsignedTransactionDigest: unsignedTransactionDigest(psbt),
    signers: [{
      signerIndex: 0,
      deviceId: 'device-1',
      deviceAccountId: 'account-1',
      masterFingerprint: FINGERPRINT,
      accountPath: ACCOUNT_PATH,
      accountXpub: 'tpub-wallet-selected-account',
    }],
    inputs: [{
      inputIndex: 0,
      txid: INPUT_TXID,
      vout: 2,
      amountSats: '50000',
      scriptPubKey: Buffer.from(inputScript).toString('hex'),
      addressPath: INPUT_PATH,
      signerOrigins: [origin(INPUT_PATH)],
    }],
    changeOutputs: [{
      outputIndex: 1,
      amountSats: '19000',
      scriptPubKey: Buffer.from(inputScript).toString('hex'),
      addressPath: CHANGE_PATH,
      signerOrigins: [origin(CHANGE_PATH)],
    }],
  };

  return {
    walletId: 'wallet-1',
    psbt: psbt.toBase64(),
    signingContext,
  };
}

export function mutateContext(
  request: PSBTSignRequest,
  mutate: (context: PsbtSigningContext) => void,
): PSBTSignRequest {
  const signingContext = structuredClone(request.signingContext!);
  mutate(signingContext);
  return { ...request, signingContext };
}

export function buildMultisigRequest(scriptType: 'native_segwit' | 'nested_segwit'): PSBTSignRequest {
  const fingerprints = ['aabbccdd', 'eeff0011'];
  const pubkeys = [
    PUBKEY,
    Uint8Array.from(Buffer.from(
      '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
      'hex',
    )),
  ];
  const scriptSubtype = scriptType === 'native_segwit' ? 2 : 1;
  const accountPath = `m/48'/1'/3'/${scriptSubtype}'`;
  const inputPath = `${accountPath}/0/5`;
  const changePath = `${accountPath}/1/6`;
  const sortedPubkeys = [...pubkeys].sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
  const p2ms = bitcoin.payments.p2ms({ m: 2, pubkeys: sortedPubkeys, network: NETWORK });
  const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network: NETWORK });
  const payment = scriptType === 'native_segwit'
    ? p2wsh
    : bitcoin.payments.p2sh({ redeem: p2wsh, network: NETWORK });
  const derivations = (path: string) => pubkeys.map((pubkey, index) => ({
    masterFingerprint: Uint8Array.from(Buffer.from(fingerprints[index], 'hex')),
    path,
    pubkey,
  }));
  const psbt = new bitcoin.Psbt({ network: NETWORK });
  const scripts = {
    witnessScript: p2ms.output!,
    ...(scriptType === 'nested_segwit' && { redeemScript: p2wsh.output! }),
  };
  psbt.addInput({
    hash: INPUT_TXID,
    index: 2,
    witnessUtxo: { script: payment.output!, value: 50_000n },
    bip32Derivation: derivations(inputPath),
    ...scripts,
  });
  psbt.addOutput({ script: p2wpkhScript(), value: 30_000n });
  psbt.addOutput({
    script: payment.output!,
    value: 19_000n,
    bip32Derivation: derivations(changePath),
    ...scripts,
  });
  const origins = (path: string) => pubkeys.map((pubkey, index) => ({
    masterFingerprint: fingerprints[index],
    path,
    pubkey: Buffer.from(pubkey).toString('hex'),
  }));
  const signingContext: PsbtSigningContext = {
    version: 1,
    walletId: 'wallet-multisig',
    network: 'testnet3',
    walletType: 'multi_sig',
    scriptType,
    canonicalPolicyId: scriptType === 'native_segwit'
      ? 'multisig-native-segwit-bip48-2-v1'
      : 'multisig-nested-segwit-bip48-1-v1',
    canonicalPolicyVersion: 1,
    descriptorDigest: '44'.repeat(32),
    unsignedTransactionDigest: unsignedTransactionDigest(psbt),
    signers: fingerprints.map((masterFingerprint, signerIndex) => ({
      signerIndex,
      deviceId: `device-${signerIndex}`,
      deviceAccountId: `account-${signerIndex}`,
      masterFingerprint,
      accountPath,
      accountXpub: `tpub-wallet-signer-${signerIndex}`,
    })),
    inputs: [{
      inputIndex: 0,
      txid: INPUT_TXID,
      vout: 2,
      amountSats: '50000',
      scriptPubKey: Buffer.from(payment.output!).toString('hex'),
      addressPath: inputPath,
      signerOrigins: origins(inputPath),
    }],
    changeOutputs: [{
      outputIndex: 1,
      amountSats: '19000',
      scriptPubKey: Buffer.from(payment.output!).toString('hex'),
      addressPath: changePath,
      signerOrigins: origins(changePath),
    }],
  };
  return { walletId: signingContext.walletId, psbt: psbt.toBase64(), signingContext };
}

export function updatePsbt(
  request: PSBTSignRequest,
  mutate: (psbt: bitcoin.Psbt) => void,
): PSBTSignRequest {
  const psbt = bitcoin.Psbt.fromBase64(request.psbt, { network: NETWORK });
  mutate(psbt);
  const signingContext = structuredClone(request.signingContext!);
  signingContext.unsignedTransactionDigest = unsignedTransactionDigest(psbt);
  return { ...request, psbt: psbt.toBase64(), signingContext };
}

export function replaceRequestInput(
  request: PSBTSignRequest,
  input: Parameters<bitcoin.Psbt['addInput']>[0],
): PSBTSignRequest {
  const original = bitcoin.Psbt.fromBase64(request.psbt, { network: NETWORK });
  const psbt = new bitcoin.Psbt({ network: NETWORK });
  psbt.addInput(input);
  for (const [index, output] of original.txOutputs.entries()) {
    const outputMap = original.data.outputs[index];
    psbt.addOutput({
      script: output.script,
      value: output.value,
      ...(outputMap.bip32Derivation && { bip32Derivation: outputMap.bip32Derivation }),
      ...(outputMap.redeemScript && { redeemScript: outputMap.redeemScript }),
      ...(outputMap.witnessScript && { witnessScript: outputMap.witnessScript }),
    });
  }
  const signingContext = structuredClone(request.signingContext!);
  signingContext.unsignedTransactionDigest = unsignedTransactionDigest(psbt);
  return { ...request, psbt: psbt.toBase64(), signingContext };
}

export function buildSingleSigFamilyRequest(
  scriptType: 'legacy' | 'nested_segwit' | 'taproot',
): PSBTSignRequest {
  const policy = {
    legacy: { purpose: 44, id: 'single-sig-legacy-bip44-v1' },
    nested_segwit: { purpose: 49, id: 'single-sig-nested-segwit-bip49-v1' },
    taproot: { purpose: 86, id: 'single-sig-taproot-bip86-v1' },
  }[scriptType];
  const accountPath = `m/${policy.purpose}'/1'/7'`;
  const inputPath = `${accountPath}/0/3`;
  const changePath = `${accountPath}/1/4`;
  const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: PUBKEY, network: NETWORK });
  const tapInternalKey = PUBKEY.subarray(1, 33);
  const payment = scriptType === 'legacy'
    ? bitcoin.payments.p2pkh({ pubkey: PUBKEY, network: NETWORK })
    : scriptType === 'nested_segwit'
      ? bitcoin.payments.p2sh({ redeem: p2wpkh, network: NETWORK })
      : bitcoin.payments.p2tr({ internalPubkey: tapInternalKey, network: NETWORK });
  const bip32Derivation = (path: string) => [{
    masterFingerprint: Uint8Array.from(Buffer.from(FINGERPRINT, 'hex')),
    path,
    pubkey: Uint8Array.from(PUBKEY),
  }];
  const tapBip32Derivation = (path: string) => [{
    masterFingerprint: Uint8Array.from(Buffer.from(FINGERPRINT, 'hex')),
    path,
    pubkey: Uint8Array.from(tapInternalKey),
    leafHashes: [],
  }];
  const scripts = scriptType === 'nested_segwit' ? { redeemScript: p2wpkh.output! } : {};
  const metadata = (path: string) => scriptType === 'taproot'
    ? { tapInternalKey, tapBip32Derivation: tapBip32Derivation(path) }
    : { bip32Derivation: bip32Derivation(path), ...scripts };
  const previous = new bitcoin.Transaction();
  previous.addInput(new Uint8Array(32), 0xffffffff);
  previous.addOutput(payment.output!, 1n);
  previous.addOutput(payment.output!, 1n);
  previous.addOutput(payment.output!, 50_000n);
  const inputTxid = scriptType === 'legacy' ? previous.getId() : INPUT_TXID;
  const psbt = new bitcoin.Psbt({ network: NETWORK });
  psbt.addInput({
    hash: inputTxid,
    index: 2,
    ...(scriptType === 'legacy'
      ? { nonWitnessUtxo: previous.toBuffer() }
      : { witnessUtxo: { script: payment.output!, value: 50_000n } }),
    ...metadata(inputPath),
  });
  psbt.addOutput({ script: p2wpkhScript(), value: 30_000n });
  psbt.addOutput({
    script: payment.output!,
    value: 19_000n,
    ...metadata(changePath),
  });
  const origin = (path: string) => ({
    masterFingerprint: FINGERPRINT,
    path,
    pubkey: Buffer.from(scriptType === 'taproot' ? tapInternalKey : PUBKEY).toString('hex'),
  });
  const signingContext: PsbtSigningContext = {
    version: 1,
    walletId: 'wallet-1',
    network: 'testnet3',
    walletType: 'single_sig',
    scriptType,
    canonicalPolicyId: policy.id,
    canonicalPolicyVersion: 1,
    descriptorDigest: '22'.repeat(32),
    unsignedTransactionDigest: unsignedTransactionDigest(psbt),
    signers: [{
      signerIndex: 0,
      deviceId: 'device-1',
      deviceAccountId: 'account-1',
      masterFingerprint: FINGERPRINT,
      accountPath,
      accountXpub: 'tpub-wallet-selected-account',
    }],
    inputs: [{
      inputIndex: 0,
      txid: inputTxid,
      vout: 2,
      amountSats: '50000',
      scriptPubKey: Buffer.from(payment.output!).toString('hex'),
      addressPath: inputPath,
      signerOrigins: [origin(inputPath)],
    }],
    changeOutputs: [{
      outputIndex: 1,
      amountSats: '19000',
      scriptPubKey: Buffer.from(payment.output!).toString('hex'),
      addressPath: changePath,
      signerOrigins: [origin(changePath)],
    }],
  };
  return { walletId: signingContext.walletId, psbt: psbt.toBase64(), signingContext };
}

export function addSecondOwnedInput(request: PSBTSignRequest): PSBTSignRequest {
  const secondPath = `${ACCOUNT_PATH}/0/9`;
  const updated = updatePsbt(request, psbt => {
    psbt.addInput({
      hash: '33'.repeat(32),
      index: 1,
      witnessUtxo: { script: p2wpkhScript(), value: 7_000n },
      bip32Derivation: [{
        masterFingerprint: Uint8Array.from(Buffer.from(FINGERPRINT, 'hex')),
        path: secondPath,
        pubkey: Uint8Array.from(PUBKEY),
      }],
    });
  });
  updated.signingContext!.inputs.push({
    ...updated.signingContext!.inputs[0],
    inputIndex: 1,
    txid: '33'.repeat(32),
    vout: 1,
    amountSats: '7000',
    addressPath: secondPath,
    signerOrigins: [{
      ...updated.signingContext!.inputs[0].signerOrigins[0],
      path: secondPath,
    }],
  });
  return updated;
}

export function addSecondChangeOutput(request: PSBTSignRequest): PSBTSignRequest {
  const secondPath = `${ACCOUNT_PATH}/1/9`;
  const updated = updatePsbt(request, psbt => {
    psbt.addOutput({
      script: p2wpkhScript(),
      value: 1_000n,
      bip32Derivation: [{
        masterFingerprint: Uint8Array.from(Buffer.from(FINGERPRINT, 'hex')),
        path: secondPath,
        pubkey: Uint8Array.from(PUBKEY),
      }],
    });
  });
  updated.signingContext!.changeOutputs.push({
    ...updated.signingContext!.changeOutputs[0],
    outputIndex: 2,
    amountSats: '1000',
    addressPath: secondPath,
    signerOrigins: [{
      ...updated.signingContext!.changeOutputs[0].signerOrigins[0],
      path: secondPath,
    }],
  });
  return updated;
}
