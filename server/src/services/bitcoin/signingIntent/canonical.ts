import { createHash } from 'node:crypto';
import * as bitcoin from 'bitcoinjs-lib';
import { InvalidInputError } from '../../../errors/ApiError';
import type { BitcoinNetwork } from '../networks';
import {
  SIGNING_INTENT_SNAPSHOT_VERSION,
  type SigningIntentInputRole,
  type SigningIntentPrevout,
  type SigningIntentSnapshotV1,
} from './types';

const TXID_PATTERN = /^[0-9a-f]{64}$/;
const HEX_PATTERN = /^(?:[0-9a-f]{2})*$/;

export const sha256Hex = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');

export const canonicalSnapshotJson = (snapshot: SigningIntentSnapshotV1): string =>
  JSON.stringify(snapshot);

export const calculateSnapshotDigest = (snapshot: SigningIntentSnapshotV1): string =>
  sha256Hex(canonicalSnapshotJson(snapshot));

export const unsignedPsbtSha256 = (psbtBase64: string): string => {
  const bytes = Buffer.from(psbtBase64, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== psbtBase64) {
    throw new InvalidInputError('Unsigned PSBT is not canonical base64', 'psbtBase64', {
      reason: 'invalid_psbt',
    });
  }
  return sha256Hex(bytes);
};

const normalizeTxid = (txid: string, field: string): string => {
  const normalized = txid.toLowerCase();
  if (!TXID_PATTERN.test(normalized)) {
    throw new InvalidInputError('Signing intent contains an invalid transaction id', field, {
      reason: 'invalid_psbt',
    });
  }
  return normalized;
};

const normalizeScript = (script: string, field: string): string => {
  const normalized = script.toLowerCase();
  if (!HEX_PATTERN.test(normalized)) {
    throw new InvalidInputError('Signing intent contains an invalid script', field, {
      reason: 'invalid_psbt',
    });
  }
  return normalized;
};

const normalizeSats = (value: bigint, field: string): string => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InvalidInputError('Signing intent amount is outside the supported range', field, {
      reason: 'unknown_input_value',
    });
  }
  return value.toString();
};

export const buildSigningIntentSnapshot = (
  walletId: string,
  network: BitcoinNetwork,
  psbt: bitcoin.Psbt,
  prevouts: SigningIntentPrevout[],
  replacementTxid?: string,
): SigningIntentSnapshotV1 => {
  if (psbt.txInputs.length === 0 || psbt.txOutputs.length === 0) {
    throw new InvalidInputError('Signing intent requires inputs and outputs', 'psbtBase64', {
      reason: 'invalid_psbt',
    });
  }
  if (prevouts.length !== psbt.txInputs.length) {
    throw new InvalidInputError('Signing intent prevout evidence is incomplete', 'psbtBase64', {
      reason: 'unknown_input_value',
    });
  }

  return {
    version: SIGNING_INTENT_SNAPSHOT_VERSION,
    walletId,
    network,
    transaction: {
      version: psbt.version,
      locktime: psbt.locktime,
      ...(replacementTxid && { replacementTxid: normalizeTxid(replacementTxid, 'replacementTxid') }),
      inputs: psbt.txInputs.map((input, index) => ({
        txid: normalizeTxid(Buffer.from(input.hash).reverse().toString('hex'), `inputs.${index}.txid`),
        vout: input.index,
        /* v8 ignore next -- bitcoinjs materializes a sequence for every parsed transaction input */
        sequence: input.sequence ?? 0xffffffff,
        prevout: {
          amountSats: normalizeSats(BigInt(prevouts[index].amountSats), `inputs.${index}.amountSats`),
          scriptPubKeyHex: normalizeScript(prevouts[index].scriptPubKeyHex, `inputs.${index}.scriptPubKeyHex`),
          role: prevouts[index].role,
        },
      })),
      outputs: psbt.txOutputs.map((output, index) => ({
        amountSats: normalizeSats(BigInt(output.value), `outputs.${index}.amountSats`),
        scriptPubKeyHex: normalizeScript(
          Buffer.from(output.script).toString('hex'),
          `outputs.${index}.scriptPubKeyHex`,
        ),
      })),
    },
  };
};

export const defaultInputRoles = (count: number): SigningIntentInputRole[] =>
  Array.from({ length: count }, () => 'wallet');

export const derivePayjoinInputRoles = (
  originalPsbtBase64: string,
  proposalPsbtBase64: string,
): SigningIntentInputRole[] => {
  const original = bitcoin.Psbt.fromBase64(originalPsbtBase64);
  const originalOutpoints = new Set(original.txInputs.map(input =>
    `${Buffer.from(input.hash).reverse().toString('hex')}:${input.index}`));
  const proposal = bitcoin.Psbt.fromBase64(proposalPsbtBase64);
  return proposal.txInputs.map(input =>
    originalOutpoints.has(`${Buffer.from(input.hash).reverse().toString('hex')}:${input.index}`)
      ? 'wallet'
      : 'payjoin_peer');
};
