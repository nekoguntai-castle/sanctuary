import { formatPathForDescriptor } from '@sanctuary/shared/utils/bitcoin';
import { isNetworkType, type NetworkType } from '@sanctuary/shared/constants/bitcoin';
import {
  buildCanonicalAccountPath,
  findWalletPolicy,
  renderDescriptorWrapper,
} from '@sanctuary/shared/constants/walletPolicy';
import type { WalletScriptType, WalletType } from '@sanctuary/shared/constants/walletIdentity';
import type { DescriptorBuildOptions, DeviceKeyInfo, MultiSigBuildOptions, Network } from '../types';

function canonicalNetwork(network: Network): NetworkType {
  if (network === 'testnet') return 'testnet3';
  if (!isNetworkType(network)) throw new Error(`Unknown Bitcoin network: ${network}`);
  return network;
}

export function buildWalletPolicyDerivationPath(
  walletType: WalletType,
  scriptType: WalletScriptType,
  network: Network,
  account: number,
): string {
  return buildCanonicalAccountPath({
    walletType,
    scriptType,
    chainEnvironment: canonicalNetwork(network),
    account,
  });
}

export function wrapWalletPolicyDescriptor(
  walletType: WalletType,
  scriptType: WalletScriptType,
  expression: string,
): string {
  const policy = findWalletPolicy(walletType, scriptType);
  if (!policy) throw new Error('Unsupported wallet policy');
  return renderDescriptorWrapper(policy.descriptorWrapper, expression);
}

export function getDescriptorChain(options: DescriptorBuildOptions): '0' | '1' {
  return options.change ? '1' : '0';
}

export function buildRangedKeyExpression(
  device: DeviceKeyInfo,
  derivationPath: string,
  options: DescriptorBuildOptions
): string {
  if (!device.derivationPath || derivationPath !== device.derivationPath) {
    throw new Error('Device account origin is required');
  }
  const formattedPath = formatPathForDescriptor(derivationPath);
  return `[${device.fingerprint}/${formattedPath}]${device.xpub}/${getDescriptorChain(options)}/*`;
}

export function buildMultiSigKeyExpressions(
  devices: DeviceKeyInfo[],
  options: MultiSigBuildOptions
): string[] {
  return devices.map((device) =>
    buildRangedKeyExpression(device, device.derivationPath, options)
  );
}

export function buildSortedMulti(keyExpressions: string[], options: MultiSigBuildOptions): string {
  return `sortedmulti(${options.quorum},${keyExpressions.join(',')})`;
}

export function supportsAnyScriptType(deviceScriptTypes: string[], validTypes: string[]): boolean {
  return deviceScriptTypes.some((type) => validTypes.includes(type.toLowerCase()));
}
