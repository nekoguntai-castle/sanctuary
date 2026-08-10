import { parseDerivationPath } from '@sanctuary/shared/utils/bitcoin';
import {
  WalletScriptType,
  WalletType,
  type WalletType as DescriptorType,
} from '@sanctuary/shared/constants/walletIdentity';
import { isPrivateExtendedKey } from '../addressDerivation/xpubConversion';
import type { DetectedNetwork, ParsedDescriptor, ParsedDevice, ScriptType } from './types';

export const PUBLIC_EXTENDED_KEY_PATTERN = '(?:xpub|ypub|zpub|Ypub|Zpub|tpub|upub|vpub|Upub|Vpub)';
const PRIVATE_EXTENDED_KEY_RE = /\b(?:xprv|yprv|zprv|Yprv|Zprv|tprv|uprv|vprv|Uprv|Vprv)[A-Za-z0-9]*\b/;
const DESCRIPTOR_KEY_RE = new RegExp(
  `\\[[a-fA-F0-9]{8}\\/[^\\]]+\\]${PUBLIC_EXTENDED_KEY_PATTERN}[A-Za-z0-9]+(?<suffix>\\/[^,\\)\\s]+)?`,
  'g',
);
const DESCRIPTOR_KEY_CANDIDATE_RE = /\[[a-fA-F0-9]{8}\/[^\]]+\][^,\)\s]+/g;
const MAX_BIP32_INDEX = 2_147_483_647;

type NetworkFamily = 'mainnet' | 'testnet';

interface ParsedPathComponent {
  index: number;
  hardened: boolean;
}

interface DeviceDomain {
  network: NetworkFamily;
  pathComponents: ParsedPathComponent[];
}

interface DescriptorDomainValidationOptions {
  allowAccountRootPath?: boolean;
  enforceScriptPurpose?: boolean;
}

export function validateRawDescriptorDomain(
  descriptor: string,
  expectedKeyCount: number,
): void {
  rejectPrivateExtendedKeys(descriptor);

  if (expectedKeyCount === 0) {
    return;
  }

  const branches = new Set<string>();
  for (const match of descriptor.matchAll(DESCRIPTOR_KEY_RE)) {
    const suffix = match.groups?.suffix;
    const branch = validateDescriptorSuffix(suffix);
    branches.add(branch);
  }

  const candidateKeyCount = Array.from(descriptor.matchAll(DESCRIPTOR_KEY_CANDIDATE_RE)).length;
  if (candidateKeyCount !== expectedKeyCount) {
    throw new Error('Invalid descriptor key expression');
  }

  if (branches.size > 1) {
    throw new Error('Descriptor key paths must use a single receive/change branch');
  }
  // The zero-key case returned before descriptor scanning, so reaching this
  // point already proves at least one key is required.
  if (branches.size === 0) {
    throw new Error('Descriptor key paths must end in /0/* or /1/*');
  }
}

export function validateParsedDescriptorDomain(
  parsed: ParsedDescriptor,
  options: DescriptorDomainValidationOptions = {},
): void {
  validateDescriptorShape(parsed);
  const domains = parsed.devices.map((device) =>
    validateDeviceDomain(device, parsed.scriptType, parsed.type, options),
  );
  validateConsistentNetworks(domains, parsed.network);
  if (parsed.type === WalletType.MULTI_SIG) {
    validateUniqueMultisigKeys(parsed.devices);
  }
}

function rejectPrivateExtendedKeys(value: string): void {
  const match = value.match(PRIVATE_EXTENDED_KEY_RE);
  if (match || isPrivateExtendedKey(value)) {
    throw new Error('Private extended keys are not allowed. Provide an extended public key instead.');
  }
}

function validateDescriptorSuffix(suffix: string | undefined): string {
  const match = suffix?.match(/^\/([01])\/\*$/);
  if (!match) {
    throw new Error('Descriptor key paths must end in /0/* or /1/*');
  }
  return match[1];
}

const validateDescriptorShape = (parsed: ParsedDescriptor): void => {
  if (parsed.type === WalletType.SINGLE_SIG && parsed.devices.length !== 1) {
    throw new Error('Single-sig descriptors must contain exactly one signer');
  }
  if (parsed.type === WalletType.MULTI_SIG) {
    validateMultisigQuorum(parsed);
  }
};

const validateMultisigQuorum = (parsed: ParsedDescriptor): void => {
  const quorum = parsed.quorum;
  if (!Number.isInteger(quorum) || quorum === undefined || quorum < 1) {
    throw new Error('Multisig quorum must be a positive integer');
  }
  if (quorum > parsed.devices.length) {
    throw new Error('Multisig quorum cannot exceed signer count');
  }
};

const validateDeviceDomain = (
  device: ParsedDevice,
  scriptType: ScriptType,
  descriptorType: DescriptorType,
  options: DescriptorDomainValidationOptions,
): DeviceDomain => {
  rejectPrivateExtendedKeys(device.xpub);
  const keyNetwork = networkFromExtendedKey(device.xpub);
  const pathComponents = parsePathComponents(device.derivationPath);
  validatePathSyntax(device.derivationPath, pathComponents, options);
  validatePathNetwork(keyNetwork, pathComponents);
  if (options.enforceScriptPurpose) {
    validateScriptPath(scriptType, descriptorType, pathComponents);
  }
  return { network: keyNetwork, pathComponents };
};

const networkFromExtendedKey = (xpub: string): NetworkFamily => {
  if (/^(?:xpub|ypub|zpub|Ypub|Zpub)/.test(xpub)) {
    return 'mainnet';
  }
  if (/^(?:tpub|upub|vpub|Upub|Vpub)/.test(xpub)) {
    return 'testnet';
  }
  throw new Error('Unsupported extended public key prefix');
};

const parsePathComponents = (path: string): ParsedPathComponent[] => {
  return path.replace(/^m\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(parsePathComponent);
};

const parsePathComponent = (component: string): ParsedPathComponent => {
  const hardened = component.endsWith("'");
  const indexText = hardened ? component.slice(0, -1) : component;
  if (!/^\d+$/.test(indexText)) {
    throw new Error('Invalid descriptor derivation path component');
  }

  const index = Number.parseInt(indexText, 10);
  if (!Number.isSafeInteger(index) || index > MAX_BIP32_INDEX) {
    throw new Error('Descriptor derivation path component is out of range');
  }
  return { index, hardened };
};

const validatePathSyntax = (
  path: string,
  components: ParsedPathComponent[],
  options: DescriptorDomainValidationOptions,
): void => {
  const parsed = parseDerivationPath(path);
  if (!parsed.valid || (options.allowAccountRootPath === false && components.length === 0)) {
    throw new Error('Invalid descriptor derivation path');
  }
};

const validatePathNetwork = (keyNetwork: NetworkFamily, components: ParsedPathComponent[]): void => {
  const coinType = components[1]?.index;
  if (coinType === undefined) {
    return;
  }

  const pathNetwork = coinType === 0 ? 'mainnet' : coinType === 1 ? 'testnet' : null;
  if (pathNetwork === null) {
    throw new Error('Descriptor derivation path coin type is unsupported');
  }
  if (pathNetwork !== keyNetwork) {
    throw new Error('xpub network does not match derivation path coin type');
  }
};

const validateScriptPath = (
  scriptType: ScriptType,
  descriptorType: DescriptorType,
  components: ParsedPathComponent[],
): void => {
  const purpose = components[0]?.index;
  if (descriptorType === WalletType.SINGLE_SIG) {
    validateSingleSigPurpose(scriptType, purpose);
    return;
  }
  validateMultisigPurpose(scriptType, purpose, components[3]?.index);
};

const validateSingleSigPurpose = (scriptType: ScriptType, purpose: number | undefined): void => {
  const expectedPurposeByScript: Record<ScriptType, number> = {
    [WalletScriptType.LEGACY]: 44,
    [WalletScriptType.NESTED_SEGWIT]: 49,
    [WalletScriptType.NATIVE_SEGWIT]: 84,
    [WalletScriptType.TAPROOT]: 86,
  };
  if (purpose !== undefined && purpose !== expectedPurposeByScript[scriptType]) {
    throw new Error('descriptor script type does not match derivation path purpose');
  }
};

const validateMultisigPurpose = (
  scriptType: ScriptType,
  purpose: number | undefined,
  scriptPath: number | undefined,
): void => {
  if (scriptType === WalletScriptType.LEGACY) {
    if (purpose !== undefined && purpose !== 45 && purpose !== 48) {
      throw new Error('descriptor script type does not match derivation path purpose');
    }
    return;
  }

  if (purpose !== 48) {
    throw new Error('descriptor script type does not match derivation path purpose');
  }
  if (scriptType === WalletScriptType.NESTED_SEGWIT && scriptPath !== 1) {
    throw new Error('descriptor script type does not match derivation path purpose');
  }
  if (scriptType === WalletScriptType.NATIVE_SEGWIT && scriptPath !== 2) {
    throw new Error('descriptor script type does not match derivation path purpose');
  }
};

const validateConsistentNetworks = (domains: DeviceDomain[], parsedNetwork: DetectedNetwork): void => {
  const firstNetwork = domains[0]!.network;
  if (domains.some((domain) => domain.network !== firstNetwork)) {
    throw new Error('All descriptor keys must use the same network family');
  }
  validateParsedNetwork(firstNetwork, parsedNetwork);
};

const validateParsedNetwork = (deviceNetwork: NetworkFamily, parsedNetwork: DetectedNetwork): void => {
  if (deviceNetwork === 'mainnet' && parsedNetwork !== 'mainnet') {
    throw new Error('Descriptor network does not match extended public key network');
  }
  if (deviceNetwork === 'testnet' && parsedNetwork === 'mainnet') {
    throw new Error('Descriptor network does not match extended public key network');
  }
};

const validateUniqueMultisigKeys = (devices: ParsedDevice[]): void => {
  const seen = new Set<string>();
  for (const device of devices) {
    const key = `${device.fingerprint}:${device.derivationPath}:${device.xpub}`;
    if (seen.has(key)) {
      throw new Error('Duplicate multisig cosigner key');
    }
    seen.add(key);
  }
};
