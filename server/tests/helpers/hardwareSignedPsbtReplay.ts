import * as bitcoin from 'bitcoinjs-lib';
import { finalizeMultisigInput } from '../../src/services/bitcoin/psbtBuilder';
import type {
  HardwareSignedNetwork,
  HardwareSignedPsbtVector,
  HardwareSignedScriptType,
  RequiredHardwareSignedRow,
  UnsupportedHardwareSignedRow,
} from '../fixtures/hardware-signed-psbt-vectors';

interface ReplayOutput {
  index: number;
  address: string;
  valueSats: number;
}

export interface HardwareSignedReplayResult {
  txid: string;
  feeSats: number;
  vsize: number;
  outputs: ReplayOutput[];
}

const MULTISIG_SCRIPT_TYPES: HardwareSignedScriptType[] = ['p2wsh', 'p2sh-p2wsh'];

function rowKey(row: RequiredHardwareSignedRow): string {
  return `${row.vendor}:${row.scriptType}`;
}

function networkParams(network: HardwareSignedNetwork): bitcoin.Network {
  if (network === 'regtest') {
    return bitcoin.networks.regtest;
  }

  return bitcoin.networks.testnet;
}

function validateNonEmpty(value: string, label: string): void {
  if (value.trim() === '') {
    throw new Error(`Hardware signed fixture is missing ${label}`);
  }
}

function validateVectorMetadata(vector: HardwareSignedPsbtVector): void {
  validateNonEmpty(vector.id, 'id');
  validateNonEmpty(vector.device.model, 'device model');
  validateNonEmpty(vector.device.firmwareVersion, 'device firmware version');
  validateNonEmpty(vector.account.fingerprint, 'account fingerprint');
  validateNonEmpty(vector.account.accountPath, 'account path');
  validateNonEmpty(vector.expectedTxid, 'expected txid');

  if (vector.signedBy.length === 0) {
    throw new Error(`Hardware signed fixture ${vector.id} has no signer evidence`);
  }
}

function validateArtifactChoice(vector: HardwareSignedPsbtVector): void {
  const hasSignedPsbt = Boolean(vector.signedPsbtBase64);
  const hasRawTx = Boolean(vector.rawTxHex);

  if (hasSignedPsbt === hasRawTx) {
    throw new Error(`Hardware signed fixture ${vector.id} must include exactly one signed PSBT or raw transaction`);
  }
}

function isInputFinalized(input: bitcoin.Psbt['data']['inputs'][number]): boolean {
  return Boolean(input.finalScriptSig || input.finalScriptWitness);
}

function finalizeHardwarePsbt(psbt: bitcoin.Psbt, scriptType: HardwareSignedScriptType): void {
  for (let inputIndex = 0; inputIndex < psbt.inputCount; inputIndex += 1) {
    if (isInputFinalized(psbt.data.inputs[inputIndex])) {
      continue;
    }

    if (MULTISIG_SCRIPT_TYPES.includes(scriptType)) {
      finalizeMultisigInput(psbt, inputIndex);
    } else {
      psbt.finalizeInput(inputIndex);
    }
  }
}

function extractHardwareTransaction(vector: HardwareSignedPsbtVector): bitcoin.Transaction {
  const network = networkParams(vector.network);

  if (vector.rawTxHex) {
    return bitcoin.Transaction.fromHex(vector.rawTxHex);
  }

  const psbt = bitcoin.Psbt.fromBase64(vector.signedPsbtBase64!, { network });
  finalizeHardwarePsbt(psbt, vector.scriptType);
  return psbt.extractTransaction(true);
}

type TransactionOutput = bitcoin.Transaction['outs'][number];

function outputAddress(output: TransactionOutput, network: bitcoin.Network): string {
  try {
    return bitcoin.address.fromOutputScript(output.script, network);
  } catch {
    return Buffer.from(output.script).toString('hex');
  }
}

function replayOutputs(tx: bitcoin.Transaction, network: bitcoin.Network): ReplayOutput[] {
  return tx.outs.map((output, index) => ({
    index,
    address: outputAddress(output, network),
    valueSats: Number(output.value),
  }));
}

function validateOutputs(vector: HardwareSignedPsbtVector, outputs: ReplayOutput[]): void {
  for (const expected of vector.expectedOutputs) {
    const actual = outputs[expected.index];
    if (!actual) {
      throw new Error(`Hardware signed fixture ${vector.id} is missing output ${expected.index}`);
    }

    if (actual.address !== expected.address || actual.valueSats !== expected.valueSats) {
      throw new Error(`Hardware signed fixture ${vector.id} output ${expected.index} mismatch`);
    }
  }
}

export function replayHardwareSignedVector(vector: HardwareSignedPsbtVector): HardwareSignedReplayResult {
  validateVectorMetadata(vector);
  validateArtifactChoice(vector);

  const tx = extractHardwareTransaction(vector);
  const outputs = replayOutputs(tx, networkParams(vector.network));
  const outputValueSats = outputs.reduce((total, output) => total + output.valueSats, 0);
  const feeSats = vector.inputValueSats - outputValueSats;
  const txid = tx.getId();
  const vsize = tx.virtualSize();

  if (txid !== vector.expectedTxid) {
    throw new Error(`Hardware signed fixture ${vector.id} txid mismatch`);
  }
  if (feeSats !== vector.expectedFeeSats) {
    throw new Error(`Hardware signed fixture ${vector.id} fee mismatch`);
  }
  if (vsize !== vector.expectedVsize) {
    throw new Error(`Hardware signed fixture ${vector.id} vsize mismatch`);
  }

  validateOutputs(vector, outputs);
  return { txid, feeSats, vsize, outputs };
}

export function missingHardwareSignedRows(
  requiredRows: RequiredHardwareSignedRow[],
  fixtures: HardwareSignedPsbtVector[],
  unsupportedRows: UnsupportedHardwareSignedRow[]
): RequiredHardwareSignedRow[] {
  const coveredRows = new Set(fixtures.map(rowKey));
  const unsupported = new Set(unsupportedRows.map(rowKey));
  return requiredRows.filter((row) => !coveredRows.has(rowKey(row)) && !unsupported.has(rowKey(row)));
}
