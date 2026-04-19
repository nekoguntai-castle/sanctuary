import type { Prisma, WalletAgent } from '../../generated/prisma/client';

export type OperationalDestinationClassification =
  | 'external_spend'
  | 'known_self_transfer'
  | 'change_like_movement'
  | 'unknown_destination';

export type UnknownDestinationHandlingMode =
  | 'notify_only'
  | 'pause_agent'
  | 'notify_and_pause'
  | 'record_only';

export interface OperationalDestinationOutput {
  address?: string | null;
  amount?: bigint | null;
  isOurs?: boolean | null;
}

export interface OperationalDestinationWallet {
  walletId: string;
  walletName?: string | null;
}

export interface OperationalTransactionDetails {
  txid: string;
  type?: string | null;
  counterpartyAddress?: string | null;
  outputs?: OperationalDestinationOutput[] | null;
}

export interface OperationalDestinationClassificationResult {
  classification: OperationalDestinationClassification;
  destinationAddress: string | null;
  knownDestinationWalletId: string | null;
  knownDestinationWalletName: string | null;
  outputCount: number;
  ownedOutputCount: number;
  externalOutputCount: number;
  classificationSource: 'outputs' | 'counterparty' | 'missing_details';
}

export interface OperationalTransactionEvaluation {
  agentId: string;
  agentName: string;
  txid: string;
  destinationClassification: OperationalDestinationClassification;
  unknownDestinationHandlingMode: UnknownDestinationHandlingMode;
  shouldNotify: boolean;
  shouldPause: boolean;
  metadata: Prisma.InputJsonObject;
}

export function uniqueDestinationAddresses(addresses: Array<string | null | undefined>): string[] {
  return Array.from(new Set(addresses.map(normalizeAddress).filter((address): address is string => Boolean(address))));
}

export function getUnknownDestinationHandlingMode(
  agent: Pick<WalletAgent, 'notifyOnOperationalSpend' | 'pauseOnUnexpectedSpend'>
): UnknownDestinationHandlingMode {
  if (agent.notifyOnOperationalSpend && agent.pauseOnUnexpectedSpend) return 'notify_and_pause';
  if (agent.pauseOnUnexpectedSpend) return 'pause_agent';
  if (agent.notifyOnOperationalSpend) return 'notify_only';
  return 'record_only';
}

export function classifyOperationalSpendDestination(
  walletId: string,
  details: OperationalTransactionDetails,
  knownWalletsByAddress: Map<string, OperationalDestinationWallet> = new Map()
): OperationalDestinationClassificationResult {
  if (details.type === 'consolidation' || details.type === 'self_transfer') {
    return buildChangeLikeClassification(walletId, details);
  }

  const outputs = details.outputs ?? [];
  if (outputs.length > 0) {
    return classifyFromOutputs(walletId, outputs, knownWalletsByAddress);
  }

  return classifyFromCounterparty(walletId, details.counterpartyAddress, knownWalletsByAddress);
}

export function buildUnknownClassification(
  outputCount: number,
  classificationSource: OperationalDestinationClassificationResult['classificationSource']
): OperationalDestinationClassificationResult {
  return {
    classification: 'unknown_destination',
    destinationAddress: null,
    knownDestinationWalletId: null,
    knownDestinationWalletName: null,
    outputCount,
    ownedOutputCount: 0,
    externalOutputCount: 0,
    classificationSource,
  };
}

export function buildDestinationMetadata(
  result: OperationalDestinationClassificationResult,
  handlingMode: UnknownDestinationHandlingMode,
  policy: { shouldNotify: boolean; shouldPause: boolean }
): Prisma.InputJsonObject {
  return {
    destinationClassification: result.classification,
    unknownDestinationHandlingMode: handlingMode,
    classificationSource: result.classificationSource,
    outputCount: result.outputCount,
    ownedOutputCount: result.ownedOutputCount,
    externalOutputCount: result.externalOutputCount,
    shouldNotify: policy.shouldNotify,
    shouldPauseAgent: policy.shouldPause,
    ...(result.destinationAddress && { destinationAddress: result.destinationAddress }),
    ...(result.knownDestinationWalletId && { knownDestinationWalletId: result.knownDestinationWalletId }),
    ...(result.knownDestinationWalletName && { knownDestinationWalletName: result.knownDestinationWalletName }),
  };
}

function normalizeAddress(address: string | null | undefined): string | null {
  const trimmed = address?.trim();
  return trimmed ? trimmed : null;
}

function buildChangeLikeClassification(
  walletId: string,
  details: OperationalTransactionDetails
): OperationalDestinationClassificationResult {
  return {
    classification: 'change_like_movement',
    destinationAddress: null,
    knownDestinationWalletId: walletId,
    knownDestinationWalletName: null,
    outputCount: details.outputs?.length ?? 0,
    ownedOutputCount: details.outputs?.length ?? 0,
    externalOutputCount: 0,
    classificationSource: details.outputs?.length ? 'outputs' : 'counterparty',
  };
}

function classifyFromOutputs(
  walletId: string,
  outputs: OperationalDestinationOutput[],
  knownWalletsByAddress: Map<string, OperationalDestinationWallet>
): OperationalDestinationClassificationResult {
  const usableOutputs = outputs
    .map(output => normalizeOutput(output))
    .filter((output): output is OperationalDestinationOutput & { address: string } => output !== null);

  if (usableOutputs.length === 0) {
    return buildUnknownClassification(outputs.length, 'outputs');
  }

  const currentWalletOutputs = usableOutputs.filter(output =>
    isCurrentWalletOutput(walletId, output, knownWalletsByAddress)
  );
  const externalOutputs = usableOutputs.filter(output =>
    !isCurrentWalletOutput(walletId, output, knownWalletsByAddress)
  );
  const unknownExternal = externalOutputs.find(output =>
    !getKnownWalletForAddress(knownWalletsByAddress, output.address)
  );
  const knownInternal = findKnownInternalOutput(externalOutputs, knownWalletsByAddress);

  if (unknownExternal) {
    return buildExternalClassification(unknownExternal.address, outputs.length, currentWalletOutputs.length, externalOutputs.length, 'outputs');
  }

  if (knownInternal) {
    return buildKnownInternalClassification(knownInternal.output.address, knownInternal.knownWallet, outputs.length, currentWalletOutputs.length, externalOutputs.length, 'outputs');
  }

  const changeOutput = currentWalletOutputs[0];
  /* v8 ignore next 3 -- non-empty usable outputs partition into current or external outputs; external-only cases return above */
  if (!changeOutput) {
    return buildUnknownClassification(outputs.length, 'outputs');
  }

  return {
    classification: 'change_like_movement',
    destinationAddress: changeOutput.address,
    knownDestinationWalletId: walletId,
    knownDestinationWalletName: null,
    outputCount: outputs.length,
    ownedOutputCount: currentWalletOutputs.length,
    externalOutputCount: externalOutputs.length,
    classificationSource: 'outputs',
  };
}

function classifyFromCounterparty(
  walletId: string,
  counterpartyAddress: string | null | undefined,
  knownWalletsByAddress: Map<string, OperationalDestinationWallet>
): OperationalDestinationClassificationResult {
  const normalizedCounterparty = normalizeAddress(counterpartyAddress);
  if (!normalizedCounterparty) {
    return buildUnknownClassification(0, 'missing_details');
  }

  const knownWallet = getKnownWalletForAddress(knownWalletsByAddress, normalizedCounterparty);
  if (knownWallet?.walletId === walletId) {
    return {
      classification: 'change_like_movement',
      destinationAddress: normalizedCounterparty,
      knownDestinationWalletId: walletId,
      knownDestinationWalletName: knownWallet.walletName ?? null,
      outputCount: 0,
      ownedOutputCount: 1,
      externalOutputCount: 0,
      classificationSource: 'counterparty',
    };
  }

  if (knownWallet) {
    return buildKnownInternalClassification(normalizedCounterparty, knownWallet, 0, 0, 1, 'counterparty');
  }

  return buildExternalClassification(normalizedCounterparty, 0, 0, 1, 'counterparty');
}

function normalizeOutput(
  output: OperationalDestinationOutput
): (OperationalDestinationOutput & { address: string }) | null {
  const address = normalizeAddress(output.address);
  return address ? { ...output, address } : null;
}

function getKnownWalletForAddress(
  knownWalletsByAddress: Map<string, OperationalDestinationWallet>,
  address: string
): OperationalDestinationWallet | null {
  return knownWalletsByAddress.get(address) ?? null;
}

function isCurrentWalletOutput(
  walletId: string,
  output: OperationalDestinationOutput & { address: string },
  knownWalletsByAddress: Map<string, OperationalDestinationWallet>
): boolean {
  const knownWallet = getKnownWalletForAddress(knownWalletsByAddress, output.address);
  return output.isOurs === true || knownWallet?.walletId === walletId;
}

function findKnownInternalOutput(
  externalOutputs: Array<OperationalDestinationOutput & { address: string }>,
  knownWalletsByAddress: Map<string, OperationalDestinationWallet>
): { output: OperationalDestinationOutput & { address: string }; knownWallet: OperationalDestinationWallet } | null {
  for (const output of externalOutputs) {
    const knownWallet = getKnownWalletForAddress(knownWalletsByAddress, output.address);
    if (knownWallet) return { output, knownWallet };
  }
  return null;
}

function buildExternalClassification(
  destinationAddress: string,
  outputCount: number,
  ownedOutputCount: number,
  externalOutputCount: number,
  classificationSource: OperationalDestinationClassificationResult['classificationSource']
): OperationalDestinationClassificationResult {
  return {
    classification: 'external_spend',
    destinationAddress,
    knownDestinationWalletId: null,
    knownDestinationWalletName: null,
    outputCount,
    ownedOutputCount,
    externalOutputCount,
    classificationSource,
  };
}

function buildKnownInternalClassification(
  destinationAddress: string,
  knownWallet: OperationalDestinationWallet,
  outputCount: number,
  ownedOutputCount: number,
  externalOutputCount: number,
  classificationSource: OperationalDestinationClassificationResult['classificationSource']
): OperationalDestinationClassificationResult {
  return {
    classification: 'known_self_transfer',
    destinationAddress,
    knownDestinationWalletId: knownWallet.walletId,
    knownDestinationWalletName: knownWallet.walletName ?? null,
    outputCount,
    ownedOutputCount,
    externalOutputCount,
    classificationSource,
  };
}
