/**
 * useQrSigning Hook
 *
 * Handles QR/airgap signing flows: downloading PSBTs, uploading signed PSBTs,
 * and processing QR-scanned signed PSBTs. Includes PSBT combination logic
 * for multisig wallets that require multiple device signatures.
 */

import { useCallback } from 'react';
import * as bitcoin from 'bitcoinjs-lib';
import * as draftsApi from '../../src/api/drafts';
import { isMultisigType } from '../../types';
import { createLogger } from '../../utils/logger';
import { downloadBinary } from '../../utils/download';
import { uint8ArrayEquals, toHex } from '../../utils/bufferUtils';
import { extractErrorMessage } from '../../shared/utils/errors';
import type { Wallet } from '../../types';
import type { TransactionData } from './types';

const log = createLogger('QrSigning');

export interface UseQrSigningDeps {
  walletId: string;
  wallet: Wallet;
  draftId: string | null;
  txData: TransactionData | null;
  unsignedPsbt: string | null;
  setError: (v: string | null) => void;
  setUnsignedPsbt: (v: string | null) => void;
  setSignedDevices: (fn: (prev: Set<string>) => Set<string>) => void;
}

export interface UseQrSigningResult {
  downloadPsbt: () => void;
  uploadSignedPsbt: (file: File, deviceId?: string, deviceFingerprint?: string) => Promise<void>;
  processQrSignedPsbt: (signedPsbt: string, deviceId: string) => void;
}

type WalletTypeValue = Wallet['type'];
type PsbtInstance = ReturnType<typeof bitcoin.Psbt.fromBase64>;
type PsbtInput = PsbtInstance['data']['inputs'][number];
type SetSignedDevices = UseQrSigningDeps['setSignedDevices'];

interface UploadedSignedPsbtParams {
  bytes: Uint8Array;
  deviceId?: string;
  deviceFingerprint?: string;
  draftId: string | null;
  walletId: string;
  unsignedPsbt: string | null;
  walletType: WalletTypeValue;
  setUnsignedPsbt: (v: string | null) => void;
  setSignedDevices: SetSignedDevices;
}

const PSBT_MAGIC_BYTES = [0x70, 0x73, 0x62, 0x74] as const;

function isBinaryPsbt(bytes: Uint8Array): boolean {
  return PSBT_MAGIC_BYTES.every((magicByte, index) => bytes[index] === magicByte);
}

function base64FromBytes(bytes: Uint8Array): string {
  let binaryString = '';
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}

function getUploadedPsbtBase64(bytes: Uint8Array): string {
  if (isBinaryPsbt(bytes)) {
    log.debug('Uploaded binary PSBT, converted to base64');
    return base64FromBytes(bytes);
  }

  log.debug('Uploaded base64 PSBT');
  return new TextDecoder().decode(bytes).trim();
}

function getEffectiveDeviceId(deviceId?: string): string {
  return deviceId || 'psbt-signed';
}

function logUploadedSignedPsbt(
  base64Psbt: string,
  effectiveDeviceId: string,
  deviceFingerprint: string | undefined,
  unsignedPsbt: string | null,
  walletType: WalletTypeValue
): void {
  log.debug('Uploaded signed PSBT', {
    preview: base64Psbt.substring(0, 50) + '...',
    deviceId: effectiveDeviceId,
    deviceFingerprint,
    hasExistingPsbt: !!unsignedPsbt,
    existingPsbtLength: unsignedPsbt?.length || 0,
    walletType,
    isMultisig: isMultisigType(walletType),
  });
}

function getSignatureFingerprint(input: PsbtInput, pubkey: Uint8Array): string | null {
  const derivation = input.bip32Derivation?.find(d => uint8ArrayEquals(d.pubkey, pubkey));
  return derivation ? toHex(derivation.masterFingerprint) : null;
}

function inputHasSignatureFromDevice(input: PsbtInput, deviceFingerprint: string): boolean {
  if (!input.partialSig || !input.bip32Derivation) {
    return false;
  }

  for (const ps of input.partialSig) {
    const sigFingerprint = getSignatureFingerprint(input, ps.pubkey);
    if (!sigFingerprint) continue;

    log.debug('Signature fingerprint check', {
      sigFingerprint,
      expectedFingerprint: deviceFingerprint,
      matches: sigFingerprint === deviceFingerprint,
    });

    if (sigFingerprint === deviceFingerprint) {
      return true;
    }
  }

  return false;
}

function psbtHasSignatureFromDevice(uploadedPsbt: PsbtInstance, deviceFingerprint: string): boolean {
  return uploadedPsbt.data.inputs.some(input => inputHasSignatureFromDevice(input, deviceFingerprint));
}

function validateUploadedSignature(
  base64Psbt: string,
  walletType: WalletTypeValue,
  deviceFingerprint?: string
): string | null {
  if (!deviceFingerprint || !isMultisigType(walletType)) {
    return null;
  }

  try {
    const uploadedPsbt = bitcoin.Psbt.fromBase64(base64Psbt);
    if (psbtHasSignatureFromDevice(uploadedPsbt, deviceFingerprint)) {
      log.debug('Signature validation passed');
      return null;
    }

    log.error('Uploaded PSBT missing expected signature', { deviceFingerprint });
    return `This PSBT does not contain a signature from the selected device (${deviceFingerprint}). Please upload the correct file.`;
  } catch (validationError) {
    log.warn('Could not validate signature', { error: validationError });
    return null;
  }
}

function countSignatures(psbt: PsbtInstance): number {
  return psbt.data.inputs.reduce((count, input) => count + (input.partialSig?.length || 0), 0);
}

function getSignaturePubkeyPrefixes(psbt: PsbtInstance): string[] {
  return psbt.data.inputs.flatMap(input =>
    input.partialSig?.map(ps => toHex(ps.pubkey).substring(0, 16)) ?? []
  );
}

function shouldCombinePsbts(unsignedPsbt: string | null, walletType: WalletTypeValue): unsignedPsbt is string {
  return Boolean(unsignedPsbt && isMultisigType(walletType));
}

function combineUploadedPsbt(
  unsignedPsbt: string | null,
  walletType: WalletTypeValue,
  base64Psbt: string
): string {
  if (!shouldCombinePsbts(unsignedPsbt, walletType)) {
    log.debug('Not combining - no existing PSBT or not multisig');
    return base64Psbt;
  }

  log.debug('Will combine PSBTs');
  try {
    const existingPsbtObj = bitcoin.Psbt.fromBase64(unsignedPsbt);
    const newPsbtObj = bitcoin.Psbt.fromBase64(base64Psbt);
    const existingPubkeys = getSignaturePubkeyPrefixes(existingPsbtObj);
    const newPubkeys = getSignaturePubkeyPrefixes(newPsbtObj);

    log.debug('Combining PSBTs', {
      existingSigCount: countSignatures(existingPsbtObj),
      newSigCount: countSignatures(newPsbtObj),
      existingPubkeys,
      newPubkeys,
      sameKey: existingPubkeys[0] === newPubkeys[0],
    });

    existingPsbtObj.combine(newPsbtObj);
    log.debug('Combined PSBTs', { totalSignatures: countSignatures(existingPsbtObj) });
    return existingPsbtObj.toBase64();
  } catch (combineError) {
    log.error('PSBT combine failed', { error: combineError });
    return base64Psbt;
  }
}

function combineQrSignedPsbt(
  unsignedPsbt: string | null,
  walletType: WalletTypeValue,
  signedPsbt: string
): string {
  if (!shouldCombinePsbts(unsignedPsbt, walletType)) {
    return signedPsbt;
  }

  try {
    const existingPsbtObj = bitcoin.Psbt.fromBase64(unsignedPsbt);
    const newPsbtObj = bitcoin.Psbt.fromBase64(signedPsbt);

    log.info('Combining PSBTs', {
      existingSigCount: countSignatures(existingPsbtObj),
      newSigCount: countSignatures(newPsbtObj),
    });

    existingPsbtObj.combine(newPsbtObj);
    log.info('Combined PSBT', { totalSignatures: countSignatures(existingPsbtObj) });
    return existingPsbtObj.toBase64();
  } catch (combineError) {
    log.warn('Failed to combine PSBTs, using new PSBT', {
      error: extractErrorMessage(combineError, String(combineError)),
    });
    return signedPsbt;
  }
}

function markSignedDevice(setSignedDevices: SetSignedDevices, deviceId: string): void {
  setSignedDevices(prev => new Set([...prev, deviceId]));
}

async function persistUploadedSignatureToDraft(
  walletId: string,
  draftId: string | null,
  combinedPsbt: string,
  effectiveDeviceId: string
): Promise<void> {
  if (!draftId) return;

  try {
    await draftsApi.updateDraft(walletId, draftId, {
      signedPsbtBase64: combinedPsbt,
      signedDeviceId: effectiveDeviceId,
    });
    log.info('Uploaded PSBT signature persisted to draft', { draftId, deviceId: effectiveDeviceId });
  } catch (persistErr) {
    log.warn('Failed to persist uploaded PSBT to draft', { error: persistErr });
  }
}

async function persistQrSignatureToDraft(
  walletId: string,
  draftId: string | null,
  combinedPsbt: string,
  deviceId: string
): Promise<void> {
  if (!draftId) return;

  try {
    await draftsApi.updateDraft(walletId, draftId, {
      signedPsbtBase64: combinedPsbt,
      signedDeviceId: deviceId,
    });
    log.info('QR signature persisted to draft', { draftId, deviceId });
  } catch (persistErr) {
    log.warn('Failed to persist QR signature to draft', { error: persistErr });
  }
}

async function processUploadedSignedPsbt({
  bytes,
  deviceId,
  deviceFingerprint,
  draftId,
  walletId,
  unsignedPsbt,
  walletType,
  setUnsignedPsbt,
  setSignedDevices,
}: UploadedSignedPsbtParams): Promise<void> {
  const base64Psbt = getUploadedPsbtBase64(bytes);
  const effectiveDeviceId = getEffectiveDeviceId(deviceId);
  logUploadedSignedPsbt(base64Psbt, effectiveDeviceId, deviceFingerprint, unsignedPsbt, walletType);

  const validationError = validateUploadedSignature(base64Psbt, walletType, deviceFingerprint);
  if (validationError) {
    throw new Error(validationError);
  }

  const combinedPsbt = combineUploadedPsbt(unsignedPsbt, walletType, base64Psbt);
  setUnsignedPsbt(combinedPsbt);
  markSignedDevice(setSignedDevices, effectiveDeviceId);
  await persistUploadedSignatureToDraft(walletId, draftId, combinedPsbt, effectiveDeviceId);
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve((e.target?.result as ArrayBuffer) || new ArrayBuffer(0));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

export function useQrSigning({
  walletId,
  wallet,
  draftId,
  txData,
  unsignedPsbt,
  setError,
  setUnsignedPsbt,
  setSignedDevices,
}: UseQrSigningDeps): UseQrSigningResult {

  // Download PSBT file (binary format - required by most hardware wallets)
  const downloadPsbt = useCallback(() => {
    const psbt = unsignedPsbt || txData?.psbtBase64;
    if (!psbt) {
      setError('No PSBT available to download');
      return;
    }

    // Log PSBT info for debugging
    log.debug('Downloading PSBT', {
      length: psbt.length,
      prefix: psbt.substring(0, 20),
      isValidBase64: /^[A-Za-z0-9+/=]+$/.test(psbt),
    });

    // Convert base64 to binary (BIP 174 standard format for .psbt files)
    const binaryString = atob(psbt);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Verify it starts with PSBT magic bytes
    if (bytes[0] !== 0x70 || bytes[1] !== 0x73 || bytes[2] !== 0x62 || bytes[3] !== 0x74) {
      log.warn('PSBT does not start with magic bytes', {
        bytes: Array.from(bytes.slice(0, 8)),
      });
    }

    downloadBinary(bytes, `${wallet.name || 'transaction'}_unsigned.psbt`);
  }, [unsignedPsbt, txData, wallet.name, setError]);

  // Upload signed PSBT (supports both binary and base64 formats)
  // deviceId is optional - for multisig, pass the device ID to track which device signed
  const uploadSignedPsbt = useCallback(async (file: File, deviceId?: string, deviceFingerprint?: string): Promise<void> => {
    const arrayBuffer = await readFileAsArrayBuffer(file);
    await processUploadedSignedPsbt({
      bytes: new Uint8Array(arrayBuffer),
      deviceId,
      deviceFingerprint,
      draftId,
      walletId,
      unsignedPsbt,
      walletType: wallet.type,
      setUnsignedPsbt,
      setSignedDevices,
    });
  }, [draftId, walletId, unsignedPsbt, wallet.type, setUnsignedPsbt, setSignedDevices]);

  // Process QR-scanned signed PSBT
  const processQrSignedPsbt = useCallback(async (signedPsbt: string, deviceId: string) => {
    log.info('Processing QR-signed PSBT', { deviceId, psbtLength: signedPsbt.length });

    const combinedPsbt = combineQrSignedPsbt(unsignedPsbt, wallet.type, signedPsbt);
    setUnsignedPsbt(combinedPsbt);
    markSignedDevice(setSignedDevices, deviceId);
    await persistQrSignatureToDraft(walletId, draftId, combinedPsbt, deviceId);
  }, [draftId, walletId, unsignedPsbt, wallet.type, setUnsignedPsbt, setSignedDevices]);

  return { downloadPsbt, uploadSignedPsbt, processQrSignedPsbt };
}
