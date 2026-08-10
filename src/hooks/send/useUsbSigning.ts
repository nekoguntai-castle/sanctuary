/**
 * useUsbSigning Hook
 *
 * Handles USB hardware wallet signing for both single-sig (signWithHardwareWallet)
 * and multi-sig (signWithDevice) flows.
 */

import { useCallback } from 'react';
import * as draftsApi from '../../api/drafts';
import { useHardwareWallet, type UseHardwareWalletReturn } from '../useHardwareWallet';
import { isMultisigType } from '../../types';
import { createLogger } from '../../utils/logger';
import type { Wallet, Device } from '../../types';
import type { TransactionData } from './types';
import type { SendOperationLease } from './useSendOperationOwner';
import { getHardwareWalletType, extractXpubsFromDescriptor } from './types';
import {
  getUnsupportedMultisigHardwareSigningMessage,
  isUnsupportedMultisigHardwareSigner,
} from '../../services/hardwareWallet/signingSupport';

const log = createLogger('UsbSigning');

export interface UseUsbSigningDeps {
  walletId: string;
  wallet: Wallet;
  draftId: string | null;
  txData: TransactionData | null;
  unsignedPsbt: string | null;
  setIsSigning: (v: boolean) => void;
  setError: (v: string | null) => void;
  setUnsignedPsbt: (v: string | null) => void;
  setSignedRawTx: (v: string | null) => void;
  setSignedDevices: (fn: (prev: Set<string>) => Set<string>) => void;
  beginSigning: () => SendOperationLease | null;
}

export interface UseUsbSigningResult {
  signWithHardwareWallet: () => Promise<string | null>;
  signWithHardwareWalletResult: (transaction?: TransactionData) => Promise<UsbSignResult | null>;
  signWithDevice: (device: Device) => Promise<boolean>;
}

type HardwareWalletType = NonNullable<ReturnType<typeof getHardwareWalletType>>;
type SetSignedDevices = UseUsbSigningDeps['setSignedDevices'];
export type UsbSignResult = { psbt?: string; rawTx?: string };

interface DeviceSigningParams {
  device: Device;
  hardwareWallet: UseHardwareWalletReturn;
  hwType: HardwareWalletType;
  psbtToSign: string;
  txData: TransactionData | null;
  wallet: Wallet;
  walletId: string;
  lease: SendOperationLease;
}

interface ApplyDeviceSignResultParams {
  signResult: UsbSignResult;
  psbtToSign: string;
  device: Device;
  draftId: string | null;
  walletId: string;
  setUnsignedPsbt: (v: string | null) => void;
  setSignedRawTx: (v: string | null) => void;
  setSignedDevices: SetSignedDevices;
  lease: SendOperationLease;
}

function getMultisigXpubs(wallet: Wallet): Record<string, string> | undefined {
  return isMultisigType(wallet.type) ? extractXpubsFromDescriptor(wallet.descriptor) : undefined;
}

function getDescriptorPreview(wallet: Wallet): string {
  return wallet.descriptor ? wallet.descriptor.substring(0, 200) + '...' : 'N/A';
}

function logHardwareSigningPreparation(wallet: Wallet, multisigXpubs: Record<string, string> | undefined): void {
  log.info('signWithHardwareWallet: Prepared for signing', {
    walletType: wallet.type,
    isMultisig: isMultisigType(wallet.type),
    hasDescriptor: !!wallet.descriptor,
    descriptorPreview: getDescriptorPreview(wallet),
    hasXpubs: !!multisigXpubs,
    xpubFingerprints: multisigXpubs ? Object.keys(multisigXpubs) : [],
  });
}

function logDeviceSigningPreparation(
  device: Device,
  wallet: Wallet,
  multisigXpubs: Record<string, string> | undefined
): void {
  log.info('signWithDevice: Prepared for signing', {
    deviceId: device.id,
    walletType: wallet.type,
    isMultisig: isMultisigType(wallet.type),
    hasDescriptor: !!wallet.descriptor,
    descriptorPreview: getDescriptorPreview(wallet),
    hasXpubs: !!multisigXpubs,
    xpubFingerprints: multisigXpubs ? Object.keys(multisigXpubs) : [],
  });
}

function getPsbtToSign(unsignedPsbt: string | null, txData: TransactionData | null): string | null {
  return unsignedPsbt || txData?.psbtBase64 || null;
}

function getUsbSigningDeviceError(device: Device, hwType: HardwareWalletType): string | null {
  if (hwType === 'coldcard' || hwType === 'passport') {
    return `${device.type} does not support USB signing. Please use PSBT file signing.`;
  }
  return null;
}

function getDeviceDisplayName(device: Device): string {
  return device.label || device.type;
}

function getHardwareWalletDeviceDisplayName(device: UseHardwareWalletReturn['device']): string {
  return device?.name || device?.type || 'This device';
}

function getMultisigUsbProductBlock(
  wallet: Wallet,
  hwType: HardwareWalletType | null,
  deviceName: string
): string | null {
  if (!isMultisigType(wallet.type) || !isUnsupportedMultisigHardwareSigner(hwType)) {
    return null;
  }
  return getUnsupportedMultisigHardwareSigningMessage(deviceName);
}

function failDeviceSigning(setError: (v: string | null) => void, message: string): false {
  setError(message);
  return false;
}

function hasSigningResult(signResult: UsbSignResult): boolean {
  return Boolean(signResult.psbt || signResult.rawTx);
}

function getSignedPsbt(signResult: UsbSignResult, psbtToSign: string): string {
  // Trezor can return a final raw transaction without a mutated PSBT; keep the current PSBT for local state.
  return signResult.psbt || psbtToSign;
}

function storeSignedRawTxIfPresent(
  signResult: UsbSignResult,
  device: Device,
  setSignedRawTx: (v: string | null) => void
): void {
  if (!signResult.rawTx) return;

  log.info('Storing signed raw transaction from device', {
    deviceId: device.id,
    rawTxLength: signResult.rawTx.length,
    rawTxPreview: signResult.rawTx.substring(0, 50) + '...',
  });
  setSignedRawTx(signResult.rawTx);
}

function markSignedDevice(setSignedDevices: SetSignedDevices, deviceId: string): void {
  setSignedDevices(prev => new Set([...prev, deviceId]));
}

async function persistDeviceSignatureToDraft(
  walletId: string,
  draftId: string | null,
  signedPsbt: string,
  deviceId: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!draftId) return;

  try {
    await draftsApi.updateDraft(walletId, draftId, {
      signedPsbtBase64: signedPsbt,
      signedDeviceId: deviceId,
    }, signal);
    log.info('Signature persisted to draft', { draftId, deviceId });
  } catch (persistErr) {
    // Draft persistence is best-effort; the signature remains valid in local state.
    log.warn('Failed to persist signature to draft', { error: persistErr });
  }
}

async function signPsbtWithDevice({
  device,
  hardwareWallet,
  hwType,
  psbtToSign,
  txData,
  wallet,
  walletId,
  lease,
}: DeviceSigningParams): Promise<UsbSignResult | null> {
  log.info('Connecting to device for signing', { deviceId: device.id, type: device.type, hwType });
  await hardwareWallet.connect(hwType);
  if (!lease.isCurrent()) return null;

  const inputPaths = txData?.inputPaths || [];
  const multisigXpubs = getMultisigXpubs(wallet);
  logDeviceSigningPreparation(device, wallet, multisigXpubs);

  return hardwareWallet.signPSBT(psbtToSign, inputPaths, multisigXpubs, walletId);
}

async function applyDeviceSignResult({
  signResult,
  psbtToSign,
  device,
  draftId,
  walletId,
  setUnsignedPsbt,
  setSignedRawTx,
  setSignedDevices,
  lease,
}: ApplyDeviceSignResultParams): Promise<void> {
  if (!lease.isCurrent()) return;
  const signedPsbt = getSignedPsbt(signResult, psbtToSign);
  setUnsignedPsbt(signedPsbt);
  storeSignedRawTxIfPresent(signResult, device, setSignedRawTx);
  markSignedDevice(setSignedDevices, device.id);
  await persistDeviceSignatureToDraft(walletId, draftId, signedPsbt, device.id, lease.signal);

  log.info('Device signing successful', {
    deviceId: device.id,
    hasRawTx: !!signResult.rawTx,
    hasPsbt: !!signResult.psbt,
  });
}

export function useUsbSigning({
  walletId,
  wallet,
  draftId,
  txData,
  unsignedPsbt,
  setIsSigning,
  setError,
  setUnsignedPsbt,
  setSignedRawTx,
  setSignedDevices,
  beginSigning,
}: UseUsbSigningDeps): UseUsbSigningResult {
  const hardwareWallet = useHardwareWallet();

  // Sign with connected hardware wallet
  const signWithHardwareWalletResult = useCallback(async (
    transaction = txData ?? undefined,
  ): Promise<UsbSignResult | null> => {
    if (!transaction || !hardwareWallet.isConnected || !hardwareWallet.device) {
      setError('Hardware wallet not connected or no transaction to sign');
      return null;
    }

    const hwType = hardwareWallet.device.type
      ? getHardwareWalletType(hardwareWallet.device.type)
      : null;
    const productBlock = getMultisigUsbProductBlock(
      wallet,
      hwType,
      getHardwareWalletDeviceDisplayName(hardwareWallet.device)
    );
    if (productBlock) {
      setError(productBlock);
      return null;
    }

    const lease = beginSigning();
    if (!lease) {
      setError('Transaction changed; review it again before signing');
      return null;
    }
    setIsSigning(true);
    setError(null);

    try {
      // For multisig wallets, extract xpubs from descriptor for Trezor signing
      const multisigXpubs = getMultisigXpubs(wallet);
      logHardwareSigningPreparation(wallet, multisigXpubs);

      const signResult = await hardwareWallet.signPSBT(
        transaction.psbtBase64,
        transaction.inputPaths || [],
        multisigXpubs,
        walletId
      );
      if (!lease.isCurrent()) return null;
      return signResult.psbt || signResult.rawTx ? signResult : null;
    } catch (err) {
      if (!lease.isCurrent()) return null;
      log.error('Hardware wallet signing failed', { error: err });
      setError(err instanceof Error ? err.message : 'Hardware wallet signing failed');
      return null;
    } finally {
      if (lease.isCurrent()) setIsSigning(false);
    }
  }, [txData, hardwareWallet, wallet, walletId, setIsSigning, setError, beginSigning]);

  const signWithHardwareWallet = useCallback(async (): Promise<string | null> => {
    const result = await signWithHardwareWalletResult();
    return result?.psbt || result?.rawTx || null;
  }, [signWithHardwareWalletResult]);

  // Sign with a specific device (for multi-sig USB signing)
  const signWithDevice = useCallback(async (device: Device): Promise<boolean> => {
    const psbtToSign = getPsbtToSign(unsignedPsbt, txData);
    if (!psbtToSign) {
      return failDeviceSigning(setError, 'No PSBT available to sign');
    }

    const hwType = getHardwareWalletType(device.type);
    if (!hwType) {
      return failDeviceSigning(
        setError,
        `Unsupported device type: ${device.type}. Use PSBT file signing instead.`
      );
    }

    const deviceError = getUsbSigningDeviceError(device, hwType);
    if (deviceError) {
      return failDeviceSigning(setError, deviceError);
    }

    const productBlock = getMultisigUsbProductBlock(wallet, hwType, getDeviceDisplayName(device));
    if (productBlock) {
      return failDeviceSigning(setError, productBlock);
    }

    const lease = beginSigning();
    if (!lease) {
      return failDeviceSigning(setError, 'Transaction changed; review it again before signing');
    }
    setIsSigning(true);
    setError(null);

    try {
      const signResult = await signPsbtWithDevice({
        device,
        hardwareWallet,
        hwType,
        psbtToSign,
        txData,
        wallet,
        walletId,
        lease,
      });

      if (!signResult) return false;

      if (!hasSigningResult(signResult)) {
        if (!lease.isCurrent()) return false;
        return failDeviceSigning(setError, 'Signing did not produce a result');
      }

      await applyDeviceSignResult({
        signResult,
        psbtToSign,
        device,
        draftId,
        walletId,
        setUnsignedPsbt,
        setSignedRawTx,
        setSignedDevices,
        lease,
      });
      return lease.isCurrent();
    } catch (err) {
      if (!lease.isCurrent()) return false;
      log.error('Device signing failed', { deviceId: device.id, error: err });
      setError(err instanceof Error ? err.message : 'Failed to sign with device');
      return false;
    } finally {
      if (lease.isCurrent()) {
        setIsSigning(false);
        hardwareWallet.disconnect();
      }
    }
  }, [txData, unsignedPsbt, hardwareWallet, draftId, walletId, wallet, setIsSigning, setError, setUnsignedPsbt, setSignedRawTx, setSignedDevices, beginSigning]);

  return { signWithHardwareWallet, signWithHardwareWalletResult, signWithDevice };
}
