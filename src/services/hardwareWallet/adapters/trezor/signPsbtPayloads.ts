import * as bitcoin from 'bitcoinjs-lib';
import { createLogger } from '../../../../utils/logger';
import { uint8ArrayEquals, toHex } from '../../../../utils/bufferUtils';
import type { PSBTSignRequest } from '../../types';
import { pathToAddressN, validateSatoshiAmount } from './pathUtils';
import { buildTrezorMultisig, isMultisigInput } from './multisig';
import type {
  TrezorBip32Derivation,
  TrezorPayToScriptType,
  TrezorPsbt,
  TrezorPsbtInput,
  TrezorPsbtOutput,
  TrezorSpendScriptType,
  TrezorTxInput,
  TrezorTxOutput,
} from './signPsbtTypes';

const log = createLogger('TrezorAdapter');

const getMatchingDerivation = (
  derivations: TrezorBip32Derivation[],
  deviceFingerprintBuffer: Buffer | null,
  deviceFingerprint: string | undefined,
  inputIdx?: number
): TrezorBip32Derivation => {
  if (!deviceFingerprintBuffer || derivations.length <= 1) {
    return derivations[0];
  }

  const matching = derivations.find(d => uint8ArrayEquals(d.masterFingerprint, deviceFingerprintBuffer));
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
      availableFingerprints: derivations.map(d => toHex(d.masterFingerprint)),
    });
  }

  return derivations[0];
};

const getInputDerivationPath = (
  input: TrezorPsbtInput,
  request: PSBTSignRequest,
  inputIdx: number,
  deviceFingerprintBuffer: Buffer | null,
  deviceFingerprint: string | undefined
): string | undefined => {
  if (input.bip32Derivation && input.bip32Derivation.length > 0) {
    return getMatchingDerivation(
      input.bip32Derivation,
      deviceFingerprintBuffer,
      deviceFingerprint,
      inputIdx
    ).path;
  }

  return request.inputPaths?.[inputIdx];
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
    request.multisigXpubs
  );

  if (!multisig) {
    return;
  }

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
  const derivationPath = getInputDerivationPath(
    input,
    request,
    inputIdx,
    deviceFingerprintBuffer,
    deviceFingerprint
  );
  const trezorInput: any = {
    address_n: derivationPath ? pathToAddressN(derivationPath) : [],
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

const isChangeOutput = (
  request: PSBTSignRequest,
  outputIdx: number,
  output: TrezorPsbtOutput
): boolean => {
  return Boolean(request.changeOutputs?.includes(outputIdx) ||
    (output.bip32Derivation && output.bip32Derivation.length > 0));
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

  if (!multisig) {
    return;
  }

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
    psbtOutput.bip32Derivation!,
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
  if (isChangeOutput(request, outputIdx, psbtOutput) && psbtOutput.bip32Derivation?.length) {
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
