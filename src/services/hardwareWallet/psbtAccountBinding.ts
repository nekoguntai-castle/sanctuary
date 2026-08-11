import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import {
  accountPathMatchesWalletPolicy,
  parseCanonicalAddressPath,
} from '@sanctuary/shared/constants/walletPolicy';
import { PsbtSigningContextSchema } from '@sanctuary/shared/schemas/psbtSigningContext';
import type {
  PsbtChangeBinding,
  PsbtInputBinding,
  PsbtSignerOrigin,
  PsbtSigningContext,
  PsbtWalletSigner,
} from '@sanctuary/shared/schemas/psbtSigningContext';
import type { PSBTSignRequest } from './types';

bitcoin.initEccLib(ecc);

type PsbtInput = bitcoin.Psbt['data']['inputs'][number];
type PsbtOutput = bitcoin.Psbt['data']['outputs'][number];
type BoundMap = PsbtInput | PsbtOutput;
type SignerOrigins = readonly PsbtSignerOrigin[];

export interface ValidatedPsbtSigningRequest {
  psbt: bitcoin.Psbt;
  context: PsbtSigningContext;
  connectedSigner: PsbtWalletSigner;
  network: PsbtSigningContext['network'];
  accountPath: string;
  changeOutputIndexes: number[];
}

const bindingError = (detail: string): Error => (
  new Error(`PSBT signing context mismatch: ${detail}`)
);

const bytesHex = (value: Uint8Array): string => Buffer.from(value).toString('hex');

const bitcoinNetwork = (network: PsbtSigningContext['network']): bitcoin.Network => (
  network === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet
);

function assertUniqueIndexes(
  label: string,
  bindings: ReadonlyArray<{ inputIndex?: number; outputIndex?: number }>,
): void {
  const indexes = bindings.map(binding => binding.inputIndex ?? binding.outputIndex);
  if (indexes.some(index => index === undefined) || new Set(indexes).size !== indexes.length) {
    throw bindingError(`${label} indexes are missing or duplicated`);
  }
}

function canonicalOrigins(origins: readonly PsbtSignerOrigin[]): string[] {
  return origins.map(origin => [
    origin.masterFingerprint.toLowerCase(),
    origin.path,
    origin.pubkey.toLowerCase(),
  ].join(':')).sort();
}

function psbtOrigins(map: BoundMap, taproot = false): PsbtSignerOrigin[] {
  if (taproot) {
    const derivations = map.tapBip32Derivation ?? [];
    if (derivations.some(origin => origin.pubkey.length !== 32)) {
      throw bindingError('Taproot internal key must be x-only');
    }
    if (derivations.some(origin => origin.leafHashes.length !== 0)) {
      throw bindingError('Taproot key-path derivation contains leaf hashes');
    }
    return derivations.map(origin => ({
      masterFingerprint: bytesHex(origin.masterFingerprint).toLowerCase(),
      path: origin.path,
      pubkey: bytesHex(origin.pubkey).toLowerCase(),
    }));
  }
  return (map.bip32Derivation ?? []).map(origin => ({
    masterFingerprint: bytesHex(origin.masterFingerprint).toLowerCase(),
    path: origin.path,
    pubkey: bytesHex(origin.pubkey).toLowerCase(),
  }));
}

const assertOrigins = (
  map: BoundMap,
  expected: SignerOrigins,
  label: string,
  taproot: boolean,
): void => {
  const actual = canonicalOrigins(psbtOrigins(map, taproot));
  const wanted = canonicalOrigins(expected);
  if (actual.length !== wanted.length || actual.some((value, index) => {
    return value !== wanted[index];
  })) {
    throw bindingError(`${label} signer origins differ from server evidence`);
  }
};

const assertOriginPolicy = (
  context: PsbtSigningContext,
  origin: PsbtSignerOrigin,
  expectedPath: string,
): void => {
  const parsed = parseCanonicalAddressPath(origin.path);
  if (!parsed || parsed.path !== expectedPath
    || parsed.policyId !== context.canonicalPolicyId
    || parsed.policy.version !== context.canonicalPolicyVersion
    || !accountPathMatchesWalletPolicy(parsed.accountPath, {
      walletType: context.walletType,
      scriptType: context.scriptType,
      chainEnvironment: context.network,
    })) {
    throw bindingError('derivation path does not match wallet policy or network');
  }
  const signer = context.signers.find(candidate => (
    candidate.masterFingerprint === origin.masterFingerprint
    && candidate.accountPath === parsed.accountPath
  ));
  if (!signer) throw bindingError('derivation origin is not an immutable wallet signer');
};

const assertOriginPolicies = (
  context: PsbtSigningContext,
  origins: SignerOrigins,
  expectedPath: string,
): void => {
  if (origins.length !== context.signers.length) {
    throw bindingError('signer origin count does not match wallet signer count');
  }
  for (const origin of origins) assertOriginPolicy(context, origin, expectedPath);
  if (new Set(origins.map(origin => origin.masterFingerprint)).size !== origins.length) {
    throw bindingError('signer origins contain a duplicate fingerprint');
  }
};

const assertBytesEqual = (
  actual: Uint8Array | undefined,
  expected: Uint8Array,
  label: string,
): void => {
  if (!actual || bytesHex(actual) !== bytesHex(expected)) {
    throw bindingError(`${label} differs from the bound script`);
  }
};

const hasTaprootFields = (map: BoundMap): boolean => (
  map.tapBip32Derivation !== undefined
  || map.tapInternalKey !== undefined
  || ('tapKeySig' in map && map.tapKeySig !== undefined)
  || ('tapScriptSig' in map && map.tapScriptSig !== undefined)
  || ('tapLeafScript' in map && map.tapLeafScript !== undefined)
  || ('tapMerkleRoot' in map && map.tapMerkleRoot !== undefined)
  || ('tapTree' in map && map.tapTree !== undefined)
);

const assertNoTaprootFields = (map: BoundMap): void => {
  if (hasTaprootFields(map)) {
    throw bindingError('non-Taproot map contains Taproot metadata');
  }
};

const multisigOutputScript = (
  context: PsbtSigningContext,
  map: BoundMap,
  network: bitcoin.Network,
): Uint8Array => {
  if (!map.witnessScript) throw bindingError('multisig map is missing witnessScript');
  const witnessScript = Uint8Array.from(map.witnessScript);
  const scriptPubkeys = (bitcoin.script.decompile(witnessScript) ?? [])
    .filter(item => item instanceof Uint8Array && item.length === 33) as Uint8Array[];
  const sortedScriptPubkeys = scriptPubkeys
    .map(bytesHex)
    .sort();
  const originPubkeys = psbtOrigins(map).map(origin => origin.pubkey).sort();
  if (sortedScriptPubkeys.length !== originPubkeys.length
    || sortedScriptPubkeys.some((key, index) => key !== originPubkeys[index])) {
    throw bindingError('multisig witnessScript does not contain the bound signer pubkeys');
  }
  const p2wsh = bitcoin.payments.p2wsh({ redeem: { output: witnessScript }, network });
  if (!p2wsh.output) throw bindingError('multisig witnessScript cannot be encoded');
  if (context.scriptType === 'native_segwit') return p2wsh.output;
  // Request preflight permits only native or nested multisig script families.
  assertBytesEqual(map.redeemScript, p2wsh.output, 'multisig redeemScript');
  const p2sh = bitcoin.payments.p2sh({ redeem: p2wsh, network });
  if (!p2sh.output) throw bindingError('nested multisig script cannot be encoded');
  return p2sh.output;
};

const taprootSingleSigOutputScript = (
  map: BoundMap,
  pubkey: Uint8Array,
  network: bitcoin.Network,
): Uint8Array => {
  if (map.bip32Derivation?.length || map.redeemScript || map.witnessScript) {
    throw bindingError('Taproot map mixes legacy PSBT metadata');
  }
  assertBytesEqual(map.tapInternalKey, pubkey, 'Taproot internal key');
  if ('tapTree' in map && map.tapTree) throw bindingError('Taproot script-path metadata is not supported');
  if (('tapLeafScript' in map && map.tapLeafScript?.length)
    || ('tapScriptSig' in map && map.tapScriptSig?.length)
    || ('tapMerkleRoot' in map && map.tapMerkleRoot)) {
    throw bindingError('Taproot script-path metadata is not supported');
  }
  const payment = bitcoin.payments.p2tr({ internalPubkey: pubkey, network });
  if (!payment.output) throw bindingError('Taproot internal key cannot be encoded');
  return payment.output;
};

const singleSigOutputScript = (
  context: PsbtSigningContext,
  map: BoundMap,
  network: bitcoin.Network,
): Uint8Array => {
  const taproot = context.scriptType === 'taproot';
  const origins = psbtOrigins(map, taproot);
  if (origins.length !== 1) throw bindingError('single-signature map must contain one origin');
  const pubkey = Uint8Array.from(Buffer.from(origins[0].pubkey, 'hex'));
  if (context.scriptType === 'taproot') return taprootSingleSigOutputScript(map, pubkey, network);
  if (context.scriptType === 'legacy') {
    return bitcoin.payments.p2pkh({ pubkey, network }).output!;
  }
  const p2wpkh = bitcoin.payments.p2wpkh({ pubkey, network });
  if (!p2wpkh.output) throw bindingError('single-signature pubkey cannot be encoded');
  if (context.scriptType === 'native_segwit') return p2wpkh.output;
  /* v8 ignore next -- validated schema makes the non-nested edge impossible */
  if (context.scriptType === 'nested_segwit') {
    assertBytesEqual(map.redeemScript, p2wpkh.output, 'single-signature redeemScript');
    return bitcoin.payments.p2sh({ redeem: p2wpkh, network }).output!;
  }
  /* v8 ignore next -- validated schema plus compile-time exhaustiveness guard */
  const unsupportedFamily: never = context.scriptType;
  /* v8 ignore next -- compile-time exhaustive fail-closed fallback */
  throw bindingError(`unsupported single-signature script family: ${unsupportedFamily}`);
};

const assertScriptFamily = (
  context: PsbtSigningContext,
  map: BoundMap,
  expectedScript: string,
  network: bitcoin.Network,
): void => {
  if (context.scriptType !== 'taproot') assertNoTaprootFields(map);
  const derived = context.walletType === 'multi_sig'
    ? multisigOutputScript(context, map, network)
    : singleSigOutputScript(context, map, network);
  if (bytesHex(derived) !== expectedScript) {
    throw bindingError('derived script family does not match scriptPubKey');
  }
};

const inputPrevout = (
  psbt: bitcoin.Psbt,
  index: number,
  requiresNonWitnessUtxo: boolean,
): { amount: bigint; script: Buffer } => {
  const input = psbt.data.inputs[index];
  if (requiresNonWitnessUtxo && !input.nonWitnessUtxo) {
    throw bindingError(`legacy input ${index} requires an authenticated nonWitnessUtxo`);
  }
  let authenticatedPrevious: { amount: bigint; script: Buffer } | undefined;
  if (input.nonWitnessUtxo) {
    const previous = bitcoin.Transaction.fromBuffer(Uint8Array.from(input.nonWitnessUtxo));
    const expectedTxid = bytesHex(Buffer.from(psbt.txInputs[index].hash).reverse());
    if (previous.getId() !== expectedTxid) {
      throw bindingError(`input ${index} nonWitnessUtxo transaction id differs from its outpoint`);
    }
    const output = previous.outs[psbt.txInputs[index].index];
    if (!output) throw bindingError(`input ${index} previous output is missing`);
    authenticatedPrevious = { amount: output.value, script: Buffer.from(output.script) };
  }
  if (input.witnessUtxo && authenticatedPrevious
    && (input.witnessUtxo.value !== authenticatedPrevious.amount
      || bytesHex(input.witnessUtxo.script) !== bytesHex(authenticatedPrevious.script))) {
    throw bindingError(`input ${index} witnessUtxo differs from nonWitnessUtxo`);
  }
  if (input.witnessUtxo) {
    return { amount: input.witnessUtxo.value, script: Buffer.from(input.witnessUtxo.script) };
  }
  if (!authenticatedPrevious) throw bindingError(`input ${index} is missing previous-output data`);
  return authenticatedPrevious;
};

const unsignedTransactionDigest = (psbt: bitcoin.Psbt): string => {
  const unsignedTx = psbt.data.globalMap.unsignedTx;
  return bytesHex(bitcoin.crypto.sha256(unsignedTx.toBuffer()));
};

const assertInputBinding = (
  psbt: bitcoin.Psbt,
  context: PsbtSigningContext,
  binding: PsbtInputBinding,
  network: bitcoin.Network,
): void => {
  const txInput = psbt.txInputs[binding.inputIndex];
  const map = psbt.data.inputs[binding.inputIndex];
  if (!txInput || !map) throw bindingError(`input ${binding.inputIndex} is absent`);
  const txid = bytesHex(Buffer.from(txInput.hash).reverse());
  if (txid !== binding.txid || txInput.index !== binding.vout) {
    throw bindingError(`input ${binding.inputIndex} outpoint differs`);
  }
  const prevout = inputPrevout(psbt, binding.inputIndex, context.scriptType === 'legacy');
  if (prevout.amount.toString() !== binding.amountSats
    || bytesHex(prevout.script) !== binding.scriptPubKey) {
    throw bindingError(`input ${binding.inputIndex} previous output differs`);
  }
  assertOrigins(
    map,
    binding.signerOrigins,
    `input ${binding.inputIndex}`,
    context.scriptType === 'taproot',
  );
  assertOriginPolicies(context, binding.signerOrigins, binding.addressPath);
  assertScriptFamily(context, map, binding.scriptPubKey, network);
};

const assertChangeBinding = (
  psbt: bitcoin.Psbt,
  context: PsbtSigningContext,
  binding: PsbtChangeBinding,
  network: bitcoin.Network,
): void => {
  const txOutput = psbt.txOutputs[binding.outputIndex];
  const map = psbt.data.outputs[binding.outputIndex];
  if (!txOutput || !map) throw bindingError(`change output ${binding.outputIndex} is absent`);
  const parsedPath = parseCanonicalAddressPath(binding.addressPath);
  if (!parsedPath || parsedPath.branch !== 1) {
    throw bindingError(`change output ${binding.outputIndex} is not on branch 1`);
  }
  if (txOutput.value.toString() !== binding.amountSats
    || bytesHex(txOutput.script) !== binding.scriptPubKey) {
    throw bindingError(`change output ${binding.outputIndex} transaction data differs`);
  }
  assertOrigins(
    map,
    binding.signerOrigins,
    `change output ${binding.outputIndex}`,
    context.scriptType === 'taproot',
  );
  assertOriginPolicies(context, binding.signerOrigins, binding.addressPath);
  assertScriptFamily(context, map, binding.scriptPubKey, network);
};

const hasWalletInputMetadata = (map: PsbtInput): boolean => Boolean(
  map.bip32Derivation?.length
  || map.tapBip32Derivation?.length
  || map.tapInternalKey
  || map.tapMerkleRoot
  || map.tapLeafScript?.length
);

const hasWalletOutputMetadata = (map: PsbtOutput): boolean => Boolean(
  map.bip32Derivation?.length
  || map.tapBip32Derivation?.length
  || map.tapInternalKey
  || map.tapTree
  || map.redeemScript
  || map.witnessScript
);

const assertNoForgedWalletMaps = (
  psbt: bitcoin.Psbt,
  context: PsbtSigningContext,
): void => {
  const inputIndexes = new Set(context.inputs.map(binding => binding.inputIndex));
  for (const [index, map] of psbt.data.inputs.entries()) {
    if (!inputIndexes.has(index) && hasWalletInputMetadata(map)) {
      throw bindingError(`unbound input ${index} contains wallet derivation metadata`);
    }
  }
  const changeIndexes = new Set(context.changeOutputs.map(binding => binding.outputIndex));
  for (const [index, map] of psbt.data.outputs.entries()) {
    if (!changeIndexes.has(index) && hasWalletOutputMetadata(map)) {
      throw new Error(`PSBT external output ${index} contains forged change metadata`);
    }
  }
};

const assertLegacyHintsMatch = (
  request: PSBTSignRequest,
  context: PsbtSigningContext,
  connectedSigner: PsbtWalletSigner,
): void => {
  const boundInputPaths = [...context.inputs]
    .sort((a, b) => a.inputIndex - b.inputIndex)
    .map(binding => binding.addressPath);
  if (request.inputPaths?.length
    && (request.inputPaths.length !== boundInputPaths.length
      || request.inputPaths.some((path, index) => path !== boundInputPaths[index]))) {
    throw bindingError('legacy inputPaths disagree with server evidence');
  }
  if (request.accountPath && request.accountPath !== connectedSigner.accountPath) {
    throw bindingError('legacy accountPath disagrees with server evidence');
  }
  const changeIndexes = context.changeOutputs.map(binding => binding.outputIndex).sort((a, b) => a - b);
  const hintedChange = [...(request.changeOutputs ?? [])].sort((a, b) => a - b);
  if (hintedChange.length > 0
    && (hintedChange.length !== changeIndexes.length
      || hintedChange.some((value, index) => value !== changeIndexes[index]))) {
    throw bindingError('legacy changeOutputs disagree with server evidence');
  }
  if (request.multisigXpubs) {
    const expected = new Map(context.signers.map(signer => [
      signer.masterFingerprint,
      signer.accountXpub,
    ]));
    const supplied = Object.entries(request.multisigXpubs);
    if (supplied.length !== expected.size || supplied.some(([fingerprint, xpub]) => (
      expected.get(fingerprint.toLowerCase()) !== xpub
    ))) {
      throw bindingError('legacy multisig xpub map disagrees with wallet signer snapshots');
    }
  }
};

export function validatePsbtSigningRequest(
  request: PSBTSignRequest,
  connectedFingerprint: string | null | undefined,
): ValidatedPsbtSigningRequest {
  const parsed = PsbtSigningContextSchema.safeParse(request.signingContext);
  if (!parsed.success) throw bindingError('server evidence is missing or malformed');
  const context = parsed.data;
  if (context.walletType === 'multi_sig' && context.scriptType === 'taproot') {
    throw bindingError('Taproot multisig is not supported');
  }
  if (context.walletType === 'multi_sig'
    && context.scriptType !== 'native_segwit'
    && context.scriptType !== 'nested_segwit') {
    throw bindingError('unsupported multisig script family');
  }
  if (request.walletId !== context.walletId) throw bindingError('wallet identity differs');
  const fingerprint = connectedFingerprint?.toLowerCase();
  const connectedSigners = context.signers.filter(signer => signer.masterFingerprint === fingerprint);
  if (!fingerprint || connectedSigners.length !== 1) {
    throw bindingError('connected device is not exactly one wallet signer');
  }
  context.signers.forEach((signer, index) => {
    if (signer.signerIndex !== index) throw bindingError('wallet signer order is not contiguous');
  });
  assertUniqueIndexes('input', context.inputs);
  assertUniqueIndexes('change output', context.changeOutputs);
  const network = bitcoinNetwork(context.network);
  let psbt: bitcoin.Psbt;
  try {
    psbt = bitcoin.Psbt.fromBase64(request.psbt, { network });
  } catch {
    throw bindingError('PSBT cannot be parsed');
  }
  if (unsignedTransactionDigest(psbt) !== context.unsignedTransactionDigest) {
    throw bindingError('unsigned transaction digest differs from server evidence');
  }
  for (const binding of context.inputs) assertInputBinding(psbt, context, binding, network);
  for (const binding of context.changeOutputs) assertChangeBinding(psbt, context, binding, network);
  assertNoForgedWalletMaps(psbt, context);
  assertLegacyHintsMatch(request, context, connectedSigners[0]);
  return {
    psbt,
    context,
    connectedSigner: connectedSigners[0],
    network: context.network,
    accountPath: connectedSigners[0].accountPath,
    changeOutputIndexes: context.changeOutputs.map(binding => binding.outputIndex),
  };
}
