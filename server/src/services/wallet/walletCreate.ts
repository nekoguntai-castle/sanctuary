/**
 * Wallet Creation
 *
 * Self-contained wallet creation flow including descriptor building,
 * initial address generation, and audit hook execution.
 */

import {
  deviceRepository,
  walletRepository,
} from "../../repositories";
import * as descriptorBuilder from "../bitcoin/descriptorBuilder";
import { parseDescriptorForImport } from "../bitcoin/descriptorParser";
import { createLogger } from "../../utils/logger";
import { getErrorMessage } from "../../utils/errors";
import { hookRegistry, Operations } from "../hooks";
import { InvalidInputError, DeviceNotFoundError } from "../../errors";
import { buildInitialAddressTemplates } from "./addressGeneration";
import type {
  CreateWalletInput,
  WalletNetwork,
  WalletSignerBinding,
  WalletWithBalance,
} from "./types";
import {
  descriptorDeviceInfo,
  resolveWalletSignerBindings,
} from "./walletAccountSelection";
import { isBitcoinNetwork } from "../bitcoin/networks";
import { WalletType } from "@sanctuary/shared/constants/walletIdentity";
import { assertHardwareWalletCapability } from "../hardwareWalletCapabilities";
import {
  descriptorPolicyFingerprint,
  prepareDescriptorPolicy,
} from "./descriptorPolicy";
import {
  canonicalPolicyIdentity,
  requireCanonicalWalletPolicy,
} from './canonicalPolicy';
import {
  INITIAL_SYNC_GENERATION,
  wakeInitialWalletSync,
} from '../sync/initialSyncIntent';

const log = createLogger("WALLET:SVC_CREATE");

type WalletDevice = Awaited<
  ReturnType<typeof deviceRepository.findByIdsAndUserWithAccounts>
>[number];

function validateWalletInput(input: CreateWalletInput): void {
  if (input.network && !isBitcoinNetwork(input.network)) {
    throw new InvalidInputError(
      "Invalid network. Must be mainnet, testnet3, testnet4, signet, or regtest.",
    );
  }

  if (input.changeDescriptor && !input.descriptor) {
    throw new InvalidInputError('Change descriptor requires a receive descriptor');
  }

  if (input.type !== WalletType.MULTI_SIG) {
    return;
  }

  if (!input.quorum || !input.totalSigners) {
    throw new InvalidInputError(
      "Quorum and totalSigners required for multi-sig wallets",
    );
  }

  if (input.quorum > input.totalSigners) {
    throw new InvalidInputError("Quorum cannot exceed total signers");
  }
}

const validateDeviceCount = (
  input: CreateWalletInput,
  signerCount: number,
): void => {
  if (input.type === WalletType.SINGLE_SIG && signerCount !== 1) {
    throw new InvalidInputError("Single-sig wallet requires exactly 1 device");
  }

  if (input.type === WalletType.MULTI_SIG && signerCount < 2) {
    throw new InvalidInputError("Multi-sig wallet requires at least 2 devices");
  }

  if (input.type === WalletType.MULTI_SIG && signerCount !== input.totalSigners) {
    throw new InvalidInputError("Multisig signer count must equal totalSigners");
  }
};

const loadWalletDevices = async (
  userId: string,
  input: CreateWalletInput,
): Promise<WalletDevice[]> => {
  if (!input.signers || input.signers.length === 0) {
    return [];
  }

  validateDeviceCount(input, input.signers.length);
  const deviceIds = input.signers.map((signer) => signer.deviceId);

  const devices = await deviceRepository.findByIdsAndUserWithAccounts(
    deviceIds,
    userId,
  );

  if (devices.length !== new Set(deviceIds).size) {
    throw new DeviceNotFoundError();
  }
  return devices;
};

function buildWalletDescriptorPolicy(
  bindings: readonly WalletSignerBinding[],
  input: CreateWalletInput,
) {
  if (bindings.length === 0) {
    if (!input.descriptor) {
      return {
        policy: undefined,
        fingerprint: input.fingerprint,
      };
    }
    const policy = prepareDescriptorPolicy({
      receiveDescriptor: input.descriptor,
      changeDescriptor: input.changeDescriptor,
      sourceKind: "imported",
    });
    assertDescriptorMatchesWalletInput(input, policy.descriptor);
    const fingerprint = descriptorPolicyFingerprint(policy.descriptor);
    if (input.fingerprint && input.fingerprint.toLowerCase() !== fingerprint.toLowerCase()) {
      throw new InvalidInputError("Wallet fingerprint does not match descriptor origins");
    }
    return {
      policy,
      fingerprint,
    };
  }

  const descriptorResult = descriptorBuilder.buildDescriptorFromDevices(
    bindings.map(descriptorDeviceInfo),
    {
      type: input.type,
      scriptType: input.scriptType,
      network: input.network || "mainnet",
      quorum: input.quorum,
    },
  );

  return {
    policy: prepareDescriptorPolicy({
      receiveDescriptor: descriptorResult.descriptor,
      changeDescriptor: descriptorResult.changeDescriptor,
      sourceKind: "generated_pair",
    }),
    fingerprint: descriptorResult.fingerprint,
  };
}

function descriptorNetworkMatchesWallet(
  descriptorNetwork: ReturnType<typeof parseDescriptorForImport>["network"],
  walletNetwork: WalletNetwork,
): boolean {
  // Extended keys distinguish mainnet from the coin-type-1 family, but cannot
  // distinguish testnet3, testnet4, signet, and regtest from one another.
  return descriptorNetwork === "mainnet"
    ? walletNetwork === "mainnet"
    : walletNetwork !== "mainnet";
}

function assertDescriptorMatchesWalletInput(
  input: CreateWalletInput,
  descriptor: string,
): void {
  const parsed = parseDescriptorForImport(descriptor);
  const walletNetwork: WalletNetwork = input.network || "mainnet";
  if (parsed.type !== input.type) {
    throw new InvalidInputError("Descriptor wallet type does not match requested wallet type");
  }
  if (parsed.scriptType !== input.scriptType) {
    throw new InvalidInputError("Descriptor script type does not match requested script type");
  }
  if (!descriptorNetworkMatchesWallet(parsed.network, walletNetwork)) {
    throw new InvalidInputError("Descriptor network family does not match requested network");
  }
  if (
    parsed.type === WalletType.MULTI_SIG
    && (parsed.quorum !== input.quorum || parsed.totalSigners !== input.totalSigners)
  ) {
    throw new InvalidInputError("Descriptor quorum does not match requested multisig policy");
  }
}

function buildWalletResult(
  wallet: Awaited<ReturnType<typeof walletRepository.createWithDeviceLinks>>,
) {
  return {
    ...wallet,
    balance: 0,
    deviceCount: wallet.devices.length,
    addressCount: wallet.addresses.length,
    isShared: false,
  };
}

function executeWalletCreateHooks(
  userId: string,
  input: CreateWalletInput,
  result: WalletWithBalance,
): void {
  hookRegistry
    .executeAfter(Operations.WALLET_CREATE, input, {
      userId,
      result,
      success: true,
    })
    .catch((err) =>
      log.warn("After hook failed", { error: getErrorMessage(err) }),
    );
}

/**
 * Create a new wallet
 */
export async function createWallet(
  userId: string,
  input: CreateWalletInput,
): Promise<WalletWithBalance> {
  validateWalletInput(input);
  const devices = await loadWalletDevices(userId, input);
  for (const device of devices) {
    assertHardwareWalletCapability(device, "import");
  }
  const bindings = input.signers
    ? resolveWalletSignerBindings(devices, { ...input, signers: input.signers })
    : [];
  const { policy, fingerprint } = buildWalletDescriptorPolicy(
    bindings,
    input,
  );
  const walletNetwork: WalletNetwork = input.network || "mainnet";
  const canonicalPolicy = requireCanonicalWalletPolicy(input.type, input.scriptType);
  const canonicalIdentity = canonicalPolicyIdentity(canonicalPolicy);
  const initialAddresses = policy
    ? buildInitialAddressTemplates(
      policy.descriptor,
      policy.changeDescriptor,
      walletNetwork,
      canonicalIdentity,
    )
    : [];

  // Create wallet in database with atomic device linking
  const wallet = await walletRepository.createWithDeviceLinks(
    {
      name: input.name,
      type: input.type,
      scriptType: input.scriptType,
      network: input.network || "mainnet",
      quorum: input.quorum,
      totalSigners: input.totalSigners,
      ...policy,
      ...(policy ? canonicalIdentity : {}),
      fingerprint,
      requestedIncrementalSyncGeneration: INITIAL_SYNC_GENERATION,
      /* v8 ignore start -- group association is optional and covered by admin group flows */
      group: input.groupId ? { connect: { id: input.groupId } } : undefined,
      /* v8 ignore stop */
      users: {
        create: {
          userId,
          role: "owner",
        },
      },
    },
    [...bindings],
    initialAddresses,
  );

  const result = buildWalletResult(wallet);

  executeWalletCreateHooks(userId, input, result);
  await wakeInitialWalletSync(wallet.id);

  return result;
}
