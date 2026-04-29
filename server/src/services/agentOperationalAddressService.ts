import type { Address } from "../generated/prisma/client";
import { INITIAL_ADDRESS_COUNT } from "../constants";
import { InvalidInputError, NotFoundError } from "../errors";
import {
  addressRepository,
  agentRepository,
  walletRepository,
} from "../repositories";
import { deriveAddressFromDescriptor } from "./bitcoin/addressDerivation";
import { parseAddressDerivationPath } from "../../../shared/utils/bitcoin";

type SupportedNetwork = "mainnet" | "testnet" | "regtest";

export interface AgentOperationalReceiveAddress {
  walletId: string;
  address: string;
  derivationPath: string;
  index: number;
  generated: boolean;
}

export interface AgentOperationalAddressVerification {
  walletId: string;
  address: string;
  verified: boolean;
  derivationPath: string | null;
  index: number | null;
}

interface DerivationPathRecord {
  derivationPath: string;
  index: number;
}

function toSupportedNetwork(network: string): SupportedNetwork {
  if (network === "mainnet" || network === "testnet" || network === "regtest") {
    return network;
  }
  throw new InvalidInputError(
    `Unsupported operational wallet network: ${network}`,
  );
}

function isReceivePath(derivationPath: string): boolean {
  return parseAddressDerivationPath(derivationPath)?.chain === "receive";
}

function getNextReceiveIndex(paths: DerivationPathRecord[]): number {
  let maxReceiveIndex = -1;

  for (const record of paths) {
    const parsed = parseAddressDerivationPath(record.derivationPath);

    if (parsed?.chain === "receive") {
      maxReceiveIndex = Math.max(maxReceiveIndex, parsed.addressIndex);
    }
  }

  return maxReceiveIndex + 1;
}

function toOperationalReceiveAddress(
  address: Address,
  generated: boolean,
): AgentOperationalReceiveAddress {
  return {
    walletId: address.walletId,
    address: address.address,
    derivationPath: address.derivationPath,
    index: address.index,
    generated,
  };
}

/**
 * Return a verified operational receive address for an agent.
 *
 * The service never trusts agent-provided destination data. It first returns an
 * existing unused receive address. If none exists, it derives a fresh receive
 * gap from the linked operational wallet descriptor and returns the first
 * persisted receive address. Wallets without descriptor metadata remain
 * read-only and fail closed.
 */
export async function getOrCreateOperationalReceiveAddress(input: {
  agentId: string;
  operationalWalletId: string;
}): Promise<AgentOperationalReceiveAddress> {
  return agentRepository.withAgentFundingLock(input.agentId, async () => {
    const existingAddress = await addressRepository.findNextUnusedReceive(
      input.operationalWalletId,
    );
    if (existingAddress) {
      return toOperationalReceiveAddress(existingAddress, false);
    }

    const wallet = await walletRepository.findById(input.operationalWalletId);
    if (!wallet) {
      throw new NotFoundError("Operational wallet not found");
    }
    if (wallet.type !== "single_sig") {
      throw new InvalidInputError(
        "Linked operational wallet must be single-sig",
      );
    }
    if (!wallet.descriptor) {
      throw new InvalidInputError(
        "Linked operational wallet has no unused receive address available and no descriptor to derive one",
      );
    }

    const network = toSupportedNetwork(wallet.network);
    const existingPaths = await addressRepository.findDerivationPaths(
      input.operationalWalletId,
    );
    const startIndex = getNextReceiveIndex(existingPaths);
    const addressesToCreate = [];

    for (let offset = 0; offset < INITIAL_ADDRESS_COUNT; offset++) {
      const index = startIndex + offset;
      const { address, derivationPath } = deriveAddressFromDescriptor(
        wallet.descriptor,
        index,
        {
          network,
          change: false,
        },
      );

      if (!isReceivePath(derivationPath)) {
        throw new InvalidInputError(
          "Derived operational address is not a receive address",
        );
      }

      addressesToCreate.push({
        walletId: input.operationalWalletId,
        address,
        derivationPath,
        index,
        used: false,
      });
    }

    await addressRepository.createMany(addressesToCreate, {
      skipDuplicates: true,
    });

    const generatedAddress = await addressRepository.findNextUnusedReceive(
      input.operationalWalletId,
    );
    if (!generatedAddress) {
      throw new InvalidInputError(
        "Linked operational wallet has no unused receive address available",
      );
    }

    return toOperationalReceiveAddress(generatedAddress, true);
  });
}

/**
 * Verify an agent-provided destination address against the linked operational wallet.
 *
 * This endpoint-level helper is intentionally conservative: only known
 * persisted receive addresses from the linked operational wallet verify true.
 * Unknown addresses, change addresses, and addresses belonging to other wallets
 * all fail closed without leaking ownership metadata.
 */
export async function verifyOperationalReceiveAddress(input: {
  operationalWalletId: string;
  address: string;
}): Promise<AgentOperationalAddressVerification> {
  const record = await addressRepository.findByAddressWithWallet(input.address);
  const verified = Boolean(
    record &&
    record.walletId === input.operationalWalletId &&
    isReceivePath(record.derivationPath),
  );

  return {
    walletId: input.operationalWalletId,
    address: input.address,
    verified,
    derivationPath: verified && record ? record.derivationPath : null,
    index: verified && record ? record.index : null,
  };
}
