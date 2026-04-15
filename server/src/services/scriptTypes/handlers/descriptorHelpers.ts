import { formatPathForDescriptor } from '../../../../../shared/utils/bitcoin';
import type { DescriptorBuildOptions, DeviceKeyInfo, MultiSigBuildOptions, Network } from '../types';

export function buildCoinTypeDerivationPath(purpose: number, network: Network, account: number = 0): string {
  const coinType = network === 'mainnet' ? '0' : '1';
  return `m/${purpose}'/${coinType}'/${account}'`;
}

export function buildBip48DerivationPath(network: Network, scriptTypeNumber: number, account: number = 0): string {
  const coinType = network === 'mainnet' ? '0' : '1';
  return `m/48'/${coinType}'/${account}'/${scriptTypeNumber}'`;
}

export function getDescriptorChain(options: DescriptorBuildOptions): '0' | '1' {
  return options.change ? '1' : '0';
}

export function buildRangedKeyExpression(
  device: DeviceKeyInfo,
  derivationPath: string,
  options: DescriptorBuildOptions
): string {
  const formattedPath = formatPathForDescriptor(derivationPath);
  return `[${device.fingerprint}/${formattedPath}]${device.xpub}/${getDescriptorChain(options)}/*`;
}

export function buildMultiSigKeyExpressions(
  devices: DeviceKeyInfo[],
  fallbackDerivationPath: string,
  options: MultiSigBuildOptions
): string[] {
  return devices.map((device) =>
    buildRangedKeyExpression(device, device.derivationPath || fallbackDerivationPath, options)
  );
}

export function buildSortedMulti(keyExpressions: string[], options: MultiSigBuildOptions): string {
  return `sortedmulti(${options.quorum},${keyExpressions.join(',')})`;
}

export function supportsAnyScriptType(deviceScriptTypes: string[], validTypes: string[]): boolean {
  return deviceScriptTypes.some((type) => validTypes.includes(type.toLowerCase()));
}
