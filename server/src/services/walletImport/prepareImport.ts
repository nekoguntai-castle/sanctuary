/**
 * One import-preparation boundary used by preview and persistence. Format
 * precedence is exact descriptor input, wallet-export JSON, BIP389 descriptor,
 * then registered adapter formats; only complete descriptor policies proceed.
 */
import * as descriptorBuilder from '../bitcoin/descriptorBuilder';
import {
  resolveDescriptorTextPair,
  type JsonImportDevice,
  type Network,
  type ParsedDescriptor,
  type ScriptType,
} from '../bitcoin/descriptorParser';
import {
  parseImportInput,
  type ParseImportInputResult,
} from '../import';
import { safeJsonParseUntyped } from '../../utils/safeJson';
import {
  prepareDescriptorPolicy,
  type PreparedDescriptorPolicy,
} from '../wallet/descriptorPolicy';
import {
  resolveDetectedBitcoinNetwork,
  type BitcoinNetwork,
} from '../bitcoin/networks';

const resolvePreparedNetwork = (
  detected: ParsedDescriptor['network'],
  requested?: Network,
): Network => resolveDetectedBitcoinNetwork(
  detected,
  requested as BitcoinNetwork | undefined,
) as Network;

export interface PreparedWalletImport {
  format: ParseImportInputResult['format'];
  parsed: ParsedDescriptor;
  network: Network;
  descriptorPolicy?: PreparedDescriptorPolicy;
  originalDevices?: JsonImportDevice[];
  suggestedName?: string;
  availablePaths?: Array<{ scriptType: ScriptType; path: string }>;
}

interface PrepareWalletImportInput {
  data: string;
  changeDescriptor?: string;
  network?: Network;
  descriptorInput?: boolean;
}

function prepareDescriptorSource(
  descriptor: string,
  changeDescriptor: string | undefined,
  network: Network | undefined,
  format: 'descriptor' | 'wallet_export',
  suggestedName?: string,
): PreparedWalletImport {
  const source = resolveDescriptorTextPair(descriptor, changeDescriptor);
  const descriptorPolicy = prepareDescriptorPolicy({
    receiveDescriptor: source.receiveDescriptor,
    changeDescriptor: source.changeDescriptor,
    sourceKind: 'imported',
  });
  const parsed = parseImportInput(descriptorPolicy.descriptor).parsed;
  return {
    format,
    parsed,
    network: resolvePreparedNetwork(parsed.network, network),
    descriptorPolicy,
    suggestedName,
  };
}

function prepareAdapterPolicy(parsed: ParsedDescriptor): PreparedDescriptorPolicy {
  const descriptors = descriptorBuilder.buildDescriptorFromDevices(parsed.devices, {
    type: parsed.type,
    scriptType: parsed.scriptType,
    network: parsed.network,
    quorum: parsed.quorum,
  });
  return prepareDescriptorPolicy({
    receiveDescriptor: descriptors.descriptor,
    changeDescriptor: descriptors.changeDescriptor,
    // Adapter text/JSON did not contain these descriptor tokens. Mark the
    // materialized pair as generated so sourceDescriptor is not misrepresented
    // as verbatim imported descriptor evidence.
    sourceKind: 'generated_pair',
  });
}

function embeddedWalletExport(data: string): {
  descriptor: string;
  changeDescriptor?: string;
  suggestedName?: string;
} | null {
  if (!data.startsWith('{')) return null;
  const value = safeJsonParseUntyped<Record<string, unknown> | null>(
    data,
    null,
    'wallet export parse',
  );
  if (!value || typeof value.descriptor !== 'string') return null;
  if (value.changeDescriptor !== undefined && typeof value.changeDescriptor !== 'string') {
    throw new Error('Wallet export changeDescriptor must be a string');
  }
  const suggestedName = typeof value.name === 'string'
    ? value.name
    : typeof value.label === 'string' ? value.label : undefined;
  return {
    descriptor: value.descriptor,
    changeDescriptor: value.changeDescriptor,
    suggestedName,
  };
}

/** Parse and materialize the exact policy used by both preview and persistence. */
export function prepareWalletImport(input: PrepareWalletImportInput): PreparedWalletImport {
  if (input.descriptorInput) {
    return prepareDescriptorSource(input.data, input.changeDescriptor, input.network, 'descriptor');
  }
  const data = input.data.trim();

  const walletExport = embeddedWalletExport(data);
  if (walletExport) {
    return prepareDescriptorSource(
      walletExport.descriptor,
      walletExport.changeDescriptor,
      input.network,
      'wallet_export',
      walletExport.suggestedName,
    );
  }

  if (data.includes('<0;1>/*')) {
    return prepareDescriptorSource(input.data, undefined, input.network, 'descriptor');
  }

  const parsedInput = parseImportInput(data);
  if (parsedInput.format === 'wallet_export') {
    throw new Error('Invalid JSON in wallet export data');
  }
  if (parsedInput.format === 'descriptor') {
    return prepareDescriptorSource(input.data, undefined, input.network, 'descriptor');
  }
  return {
    ...parsedInput,
    network: resolvePreparedNetwork(parsedInput.parsed.network, input.network),
    descriptorPolicy: parsedInput.format === 'bluewallet_text' || parsedInput.format === 'coldcard'
      ? prepareAdapterPolicy(parsedInput.parsed)
      : undefined,
  };
}
