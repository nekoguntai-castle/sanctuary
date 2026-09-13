import { parseDerivationPath } from '@sanctuary/shared/utils/bitcoin';
import { createLogger } from '../../../../utils/logger';
import { uint8ArrayEquals, toHex } from '../../../../utils/bufferUtils';
import type { PSBTSignRequest } from '../../types';
import type { TrezorConnection } from './types';
import { getTrezorScriptType } from './pathUtils';
import { isTestnetPath } from '../../pathUtils';
import type { TrezorPsbt, TrezorSpendScriptType } from './signPsbtTypes';

const log = createLogger('TrezorAdapter');

export interface NetworkDetection {
  coin: 'Bitcoin' | 'Testnet';
  isTestnet: boolean;
  networkSource: string;
  pathToCheck: string;
}

export const getRequestScriptType = (request: PSBTSignRequest): TrezorSpendScriptType => {
  const path = request.accountPath || request.inputPaths?.[0];
  return path ? getTrezorScriptType(path) : 'SPENDWITNESS';
};

const updateNetworkFromPath = (
  pathToCheck: string,
  current: Pick<NetworkDetection, 'isTestnet' | 'networkSource'>
): Pick<NetworkDetection, 'isTestnet' | 'networkSource'> => {
  // Coin type is the second path segment (m/purpose'/coinType'/...); a substring match on
  // "/1'/" or "/1h/" misclassifies a mainnet path with account index 1 (m/84'/0'/1'/0/0) as
  // testnet, since the account index shares the same hardened-notation shape as the coin type.
  if (isTestnetPath(pathToCheck)) {
    return { isTestnet: true, networkSource: 'request.path' };
  }

  if (parseDerivationPath(pathToCheck).coinType === 0) {
    return { isTestnet: current.isTestnet, networkSource: 'request.path' };
  }

  return current;
};

const updateNetworkFromDerivation = (
  derivPath: string,
  current: Pick<NetworkDetection, 'isTestnet' | 'networkSource'>
): Pick<NetworkDetection, 'isTestnet' | 'networkSource'> => {
  const testnetMatch = derivPath.match(/^m?\/?\d+[h']\/1[h']\//);
  const mainnetMatch = derivPath.match(/^m?\/?\d+[h']\/0[h']\//);

  log.info('Network detection from PSBT', {
    derivPath,
    testnetMatch: !!testnetMatch,
    mainnetMatch: !!mainnetMatch,
    isTestnet: current.isTestnet || !!testnetMatch,
  });

  if (testnetMatch) {
    return { isTestnet: true, networkSource: 'bip32Derivation' };
  }

  if (mainnetMatch && current.networkSource === 'default') {
    return { isTestnet: current.isTestnet, networkSource: 'bip32Derivation' };
  }

  return current;
};

export const detectNetwork = (request: PSBTSignRequest, psbt: TrezorPsbt): NetworkDetection => {
  const pathToCheck = request.accountPath || request.inputPaths?.[0] || '';
  let network = updateNetworkFromPath(pathToCheck, { isTestnet: false, networkSource: 'default' });
  const firstInputPath = psbt.data.inputs[0]?.bip32Derivation?.[0]?.path;

  if (firstInputPath) {
    network = updateNetworkFromDerivation(firstInputPath, network);
  }

  return {
    coin: network.isTestnet ? 'Testnet' : 'Bitcoin',
    isTestnet: network.isTestnet,
    networkSource: network.networkSource,
    pathToCheck,
  };
};

export const getDeviceFingerprintBuffer = (connection: TrezorConnection): Buffer | null => {
  return connection.fingerprint ? Buffer.from(connection.fingerprint, 'hex') : null;
};

export const verifyDeviceIsCosigner = (
  psbt: TrezorPsbt,
  deviceFingerprint: string | undefined,
  deviceFingerprintBuffer: Buffer | null
): void => {
  const firstInput = psbt.data.inputs[0];
  if (!firstInput?.bip32Derivation || firstInput.bip32Derivation.length <= 1 || !deviceFingerprintBuffer) {
    return;
  }

  const isCosigner = firstInput.bip32Derivation.some(d =>
    uint8ArrayEquals(d.masterFingerprint, deviceFingerprintBuffer)
  );

  if (isCosigner) {
    return;
  }

  const cosignerFingerprints = firstInput.bip32Derivation.map(d => toHex(d.masterFingerprint));
  log.error('Device is not a cosigner for this multisig wallet', {
    deviceFingerprint,
    cosignerFingerprints,
  });
  throw new Error(
    `This Trezor (${deviceFingerprint}) is not a cosigner for this multisig wallet. ` +
    `Expected one of: ${cosignerFingerprints.join(', ')}. ` +
    `Please connect the correct device.`
  );
};
