/**
 * Wallet Creation
 *
 * Self-contained wallet creation flow including descriptor building,
 * initial address generation, and audit hook execution.
 */

import {
  deviceRepository,
  addressRepository,
  walletRepository,
} from "../../repositories";
import * as descriptorBuilder from "../bitcoin/descriptorBuilder";
import { createLogger } from "../../utils/logger";
import { getErrorMessage } from "../../utils/errors";
import { hookRegistry, Operations } from "../hooks";
import { InvalidInputError, DeviceNotFoundError } from "../../errors";
import { generateInitialAddresses } from "./addressGeneration";
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

function buildDescriptorFromDevices(
  bindings: readonly WalletSignerBinding[],
  input: CreateWalletInput,
) {
  if (bindings.length === 0) {
    return {
      descriptor: input.descriptor,
      fingerprint: input.fingerprint,
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
    descriptor: descriptorResult.descriptor,
    fingerprint: descriptorResult.fingerprint,
  };
}

async function generateAddressesForWallet(
  walletId: string,
  descriptor: string | undefined,
  network: CreateWalletInput["network"],
): Promise<void> {
  if (!descriptor) {
    return;
  }

  try {
    const walletNetwork: WalletNetwork = network || "mainnet";
    const addressesToCreate = generateInitialAddresses(
      walletId,
      descriptor,
      walletNetwork,
    );
    await addressRepository.createMany(addressesToCreate);
  } catch (err) {
    log.error("Failed to generate initial addresses", {
      error: getErrorMessage(err),
    });
  }
}

async function buildWalletResult(
  wallet: Awaited<ReturnType<typeof walletRepository.createWithDeviceLinks>>,
) {
  const walletWithAddresses = await walletRepository.findByIdWithSelect(
    wallet.id,
    {
      id: true,
      addresses: true,
    },
  );

  return {
    ...wallet,
    balance: 0,
    deviceCount: wallet.devices.length,
    addressCount: walletWithAddresses?.addresses.length || 0,
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
  const { descriptor, fingerprint } = buildDescriptorFromDevices(
    bindings,
    input,
  );

  // Create wallet in database with atomic device linking
  const wallet = await walletRepository.createWithDeviceLinks(
    {
      name: input.name,
      type: input.type,
      scriptType: input.scriptType,
      network: input.network || "mainnet",
      quorum: input.quorum,
      totalSigners: input.totalSigners,
      descriptor,
      fingerprint,
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
  );

  await generateAddressesForWallet(wallet.id, descriptor, input.network);
  const result = await buildWalletResult(wallet);

  executeWalletCreateHooks(userId, input, result);

  return result;
}
