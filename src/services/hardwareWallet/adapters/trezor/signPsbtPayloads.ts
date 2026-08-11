import * as bitcoin from 'bitcoinjs-lib';
import { createLogger } from '../../../../utils/logger';
import { uint8ArrayEquals, toHex } from '../../../../utils/bufferUtils';
import type { PSBTSignRequest } from '../../types';
import { pathToAddressN, validateSatoshiAmount } from './pathUtils';
import { buildTrezorMultisig, isMultisigInput } from './multisig';
import type {
  TrezorPayToScriptType,
  TrezorPsbt,
  TrezorPsbtInput,
  TrezorPsbtOutput,
  TrezorSpendScriptType,
  TrezorTxInput,
  TrezorTxOutput,
} from './signPsbtTypes';

const log = createLogger('TrezorAdapter');

interface TrezorDerivation {
  pubkey: Uint8Array;
  masterFingerprint: Uint8Array;
  path: string;
  leafHashes?: Uint8Array[];
}

const getSigningDerivations = (
  map: TrezorPsbtInput | TrezorPsbtOutput,
  scriptType: TrezorSpendScriptType,
  label: string
): TrezorDerivation[] => {
  if (scriptType === 'SPENDTAPROOT') {
    // BIP371 key-path signing uses a 32-byte x-only key and empty leafHashes.
    // Script-path data is deliberately unsupported and must not be reinterpreted.
    if (map.bip32Derivation?.length) {
      throw new Error(`${label} mixes legacy and Taproot derivation metadata`);
    }
    const derivations = map.tapBip32Derivation ?? [];
    if (derivations.length === 0)
      throw new Error(`${label} is missing wallet-bound Taproot derivation metadata`);
    if (
      derivations.some(
        (derivation) => derivation.pubkey.length !== 32 || derivation.leafHashes.length !== 0
      )
    ) {
      throw new Error(`${label} contains unsupported Taproot script-path metadata`);
    }
    return derivations;
  }
  if (map.tapBip32Derivation?.length || map.tapInternalKey) {
    throw new Error(`${label} contains unexpected Taproot derivation metadata`);
  }
  const derivations = map.bip32Derivation ?? [];
  if (derivations.length === 0)
    throw new Error(`${label} is missing wallet-bound BIP32 derivation metadata`);
  return derivations;
};

const getMatchingDerivation = (
  derivations: TrezorDerivation[],
  deviceFingerprintBuffer: Buffer | null,
  deviceFingerprint: string | undefined,
  inputIdx?: number
): TrezorDerivation => {
  if (!deviceFingerprintBuffer) {
    throw new Error('Connected Trezor master fingerprint is unavailable');
  }

  const matching = derivations.find((d) =>
    uint8ArrayEquals(d.masterFingerprint, deviceFingerprintBuffer)
  );
  if (matching) {
    if (inputIdx !== undefined) {
      log.info('Found matching bip32Derivation for device', {
        inputIdx,
        fingerprint: deviceFingerprint,
        path: matching.path,
      });
    }
    return matching;
  }

  if (inputIdx !== undefined) {
    log.warn('No matching bip32Derivation found for device fingerprint', {
      inputIdx,
      deviceFingerprint,
      availableFingerprints: derivations.map((d) => toHex(d.masterFingerprint)),
    });
  }

  throw new Error(
    `No PSBT derivation matches the connected Trezor on input ${inputIdx ?? 'output'}`
  );
};

const addTrezorInputMultisig = (
  trezorInput: any,
  input: TrezorPsbtInput,
  request: PSBTSignRequest,
  inputIdx: number
): void => {
  if (!isMultisigInput(input) || !input.bip32Derivation) {
    return;
  }

  const multisig = buildTrezorMultisig(
    input.witnessScript ? Buffer.from(input.witnessScript) : undefined,
    input.bip32Derivation as any,
    request.multisigXpubs,
    input.partialSig,
    input.sighashType
  );

  if (!multisig) throw new Error(`Input ${inputIdx} is missing a canonical multisig witnessScript`);

  trezorInput.multisig = multisig;
  log.info('Built multisig structure for input', {
    inputIdx,
    m: multisig.m,
    pubkeyCount: multisig.pubkeys.length,
    hasXpubs: !!request.multisigXpubs,
  });
};

const logBuiltTrezorInput = (inputIdx: number, input: TrezorPsbtInput, trezorInput: any): void => {
  log.info('TREZOR INPUT BUILT', {
    inputIdx,
    prevHash: trezorInput.prev_hash,
    prevIndex: trezorInput.prev_index,
    amount: trezorInput.amount,
    sequence: trezorInput.sequence,
    scriptType: trezorInput.script_type,
    hasMultisig: !!trezorInput.multisig,
    addressN: trezorInput.address_n,
    psbtWitnessUtxoValue: input.witnessUtxo?.value,
    psbtWitnessUtxoScript: input.witnessUtxo?.script ? toHex(input.witnessUtxo.script) : undefined,
  });
};

const buildTrezorInput = (
  input: TrezorPsbtInput,
  txInput: TrezorTxInput,
  request: PSBTSignRequest,
  inputIdx: number,
  scriptType: TrezorSpendScriptType,
  deviceFingerprintBuffer: Buffer | null,
  deviceFingerprint: string | undefined
): any => {
  const derivationPath = getMatchingDerivation(
    getSigningDerivations(input, scriptType, `Input ${inputIdx}`),
    deviceFingerprintBuffer,
    deviceFingerprint,
    inputIdx
  ).path;
  const trezorInput: any = {
    address_n: pathToAddressN(derivationPath),
    prev_hash: Buffer.from(txInput.hash).reverse().toString('hex'),
    prev_index: txInput.index,
    sequence: txInput.sequence,
    script_type: scriptType,
  };

  if (input.witnessUtxo) {
    trezorInput.amount = validateSatoshiAmount(input.witnessUtxo.value, `Input ${inputIdx}`);
  }

  addTrezorInputMultisig(trezorInput, input, request, inputIdx);
  logBuiltTrezorInput(inputIdx, input, trezorInput);
  return trezorInput;
};

/** Build inputs only after signer derivations match the selected account. */
export const buildTrezorInputs = (
  psbt: TrezorPsbt,
  request: PSBTSignRequest,
  scriptType: TrezorSpendScriptType,
  deviceFingerprintBuffer: Buffer | null,
  deviceFingerprint: string | undefined
): any[] => {
  return psbt.data.inputs.map((input, idx) =>
    buildTrezorInput(
      input,
      psbt.txInputs[idx],
      request,
      idx,
      scriptType,
      deviceFingerprintBuffer,
      deviceFingerprint
    )
  );
};

const getOutputScriptType = (scriptType: TrezorSpendScriptType): TrezorPayToScriptType => {
  if (scriptType === 'SPENDADDRESS') return 'PAYTOADDRESS';
  if (scriptType === 'SPENDP2SHWITNESS') return 'PAYTOP2SHWITNESS';
  if (scriptType === 'SPENDTAPROOT') return 'PAYTOTAPROOT';
  return 'PAYTOWITNESS';
};

const isChangeOutput = (request: PSBTSignRequest, outputIdx: number): boolean => {
  return Boolean(
    request.signingContext?.changeOutputs.some((binding) => binding.outputIndex === outputIdx)
  );
};

const addTrezorOutputMultisig = (
  changeOutput: any,
  output: TrezorPsbtOutput,
  request: PSBTSignRequest,
  outputIdx: number
): void => {
  if (!output.bip32Derivation || output.bip32Derivation.length <= 1 || !output.witnessScript) {
    return;
  }

  const multisig = buildTrezorMultisig(
    Buffer.from(output.witnessScript),
    output.bip32Derivation as any,
    request.multisigXpubs
  );

  if (!multisig)
    throw new Error(`Output ${outputIdx} is missing a canonical multisig witnessScript`);

  changeOutput.multisig = multisig;
  log.info('Built multisig structure for change output', {
    outputIdx,
    m: multisig.m,
    pubkeyCount: multisig.pubkeys.length,
  });
};

const buildTrezorChangeOutput = (
  output: TrezorTxOutput,
  psbtOutput: TrezorPsbtOutput,
  request: PSBTSignRequest,
  outputIdx: number,
  scriptType: TrezorSpendScriptType,
  deviceFingerprintBuffer: Buffer | null,
  deviceFingerprint: string | undefined
): any => {
  const matchingDerivation = getMatchingDerivation(
    getSigningDerivations(psbtOutput, scriptType, `Output ${outputIdx}`),
    deviceFingerprintBuffer,
    deviceFingerprint
  );
  const changeOutput: any = {
    address_n: pathToAddressN(matchingDerivation.path),
    amount: validateSatoshiAmount(output.value, `Output ${outputIdx}`),
    script_type: getOutputScriptType(scriptType),
  };

  addTrezorOutputMultisig(changeOutput, psbtOutput, request, outputIdx);
  return changeOutput;
};

const buildTrezorExternalOutput = (
  output: TrezorTxOutput,
  outputIdx: number,
  isTestnet: boolean
): any => {
  return {
    address: bitcoin.address.fromOutputScript(
      output.script,
      isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin
    ),
    amount: validateSatoshiAmount(output.value, `Output ${outputIdx}`),
    script_type: 'PAYTOADDRESS' as const,
  };
};

const buildTrezorOutput = (
  output: TrezorTxOutput,
  psbtOutput: TrezorPsbtOutput,
  request: PSBTSignRequest,
  outputIdx: number,
  scriptType: TrezorSpendScriptType,
  isTestnet: boolean,
  deviceFingerprintBuffer: Buffer | null,
  deviceFingerprint: string | undefined
): any => {
  const hasSigningDerivation =
    scriptType === 'SPENDTAPROOT'
      ? Boolean(psbtOutput.tapBip32Derivation?.length)
      : Boolean(psbtOutput.bip32Derivation?.length);
  if (isChangeOutput(request, outputIdx) && hasSigningDerivation) {
    return buildTrezorChangeOutput(
      output,
      psbtOutput,
      request,
      outputIdx,
      scriptType,
      deviceFingerprintBuffer,
      deviceFingerprint
    );
  }

  return buildTrezorExternalOutput(output, outputIdx, isTestnet);
};

/** Recompute bound change; encode every other output as explicitly external. */
export const buildTrezorOutputs = (
  psbt: TrezorPsbt,
  request: PSBTSignRequest,
  scriptType: TrezorSpendScriptType,
  isTestnet: boolean,
  deviceFingerprintBuffer: Buffer | null,
  deviceFingerprint: string | undefined
): any[] => {
  return psbt.txOutputs.map((output, idx) =>
    buildTrezorOutput(
      output,
      psbt.data.outputs[idx],
      request,
      idx,
      scriptType,
      isTestnet,
      deviceFingerprintBuffer,
      deviceFingerprint
    )
  );
};
