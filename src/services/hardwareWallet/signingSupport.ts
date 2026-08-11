import { DeviceAccountPurpose } from '@sanctuary/shared/constants/walletIdentity';
import { parseDerivationPath } from '@sanctuary/shared/utils/bitcoin';
import type { DeviceType, PSBTSignRequest } from './types';

type PsbtInputLike = {
  bip32Derivation?: Array<{ path?: string | null }>;
  witnessScript?: unknown;
};

type PsbtLike = {
  data?: {
    inputs?: PsbtInputLike[];
  };
};

const UNSUPPORTED_MULTISIG_USB_SIGNERS: DeviceType[] = ['ledger', 'bitbox'];

export function isMultisigDerivationPath(path: string | null | undefined): boolean {
  return parseDerivationPath(path).accountPurpose === DeviceAccountPurpose.MULTISIG;
}

export function isUnsupportedMultisigHardwareSigner(
  deviceType: DeviceType | null | undefined,
): boolean {
  return Boolean(deviceType && UNSUPPORTED_MULTISIG_USB_SIGNERS.includes(deviceType));
}

function requestHasMultisigXpubs(request: PSBTSignRequest): boolean {
  return Object.keys(request.multisigXpubs ?? {}).length > 0;
}

function requestHasMultisigPath(request: PSBTSignRequest): boolean {
  const paths = [request.accountPath, ...(request.inputPaths ?? [])];
  return paths.some(isMultisigDerivationPath);
}

function psbtHasMultisigSignal(psbt: PsbtLike | null | undefined): boolean {
  // A witnessScript input is outside Ledger/BitBox simple single-sig signing in this release.
  return Boolean(psbt?.data?.inputs?.some(input =>
    Boolean(input.witnessScript)
    || input.bip32Derivation?.some(derivation => isMultisigDerivationPath(derivation.path))
  ));
}

export function isMultisigSigningRequest(
  request: PSBTSignRequest,
  psbt?: PsbtLike | null,
): boolean {
  return requestHasMultisigXpubs(request)
    || requestHasMultisigPath(request)
    || psbtHasMultisigSignal(psbt);
}

export function getUnsupportedMultisigHardwareSigningMessage(deviceName: string): string {
  return [
    `${deviceName} multisig USB signing is blocked in this release.`,
    'Sanctuary does not have physical fixture coverage for that device and script family yet.',
    'Use PSBT file/QR signing with a supported signer, or use a supported Trezor multisig USB flow.',
  ].join(' ');
}
