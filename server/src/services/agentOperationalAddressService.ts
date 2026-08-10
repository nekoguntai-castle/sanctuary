import type { Address } from "../generated/prisma/client";
import { INITIAL_ADDRESS_COUNT } from "../constants";
import { InvalidInputError, NotFoundError } from "../errors";
import {
  addressRepository,
  agentRepository,
  walletRepository,
} from "../repositories";
import { parseAddressDerivationPath } from "@sanctuary/shared/utils/bitcoin";
import { isBitcoinNetwork, type BitcoinNetwork } from "./bitcoin/networks";
import { WalletType } from "@sanctuary/shared/constants/walletIdentity";
import { assertWalletHardwareCapabilityById } from "./hardwareWalletCapabilities";
import { assertPersistedCanonicalPolicy } from './wallet/canonicalPolicy';
import { buildCanonicalAddressEvidence } from './wallet/addressGeneration';
import {
  assertCanonicalAddressesMatchWallet,
} from './wallet/canonicalAddressValidation';

type SupportedNetwork = BitcoinNetwork;

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


function toSupportedNetwork(network: string): SupportedNetwork {
  if (
    isBitcoinNetwork(network)
  ) {
    return network;
  }
  throw new InvalidInputError(
    `Unsupported operational wallet network: ${network}`,
  );
}

function isReceivePath(derivationPath: string): boolean {
  return parseAddressDerivationPath(derivationPath)?.chain === "receive";
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
    await assertWalletHardwareCapabilityById(
      input.operationalWalletId,
      "display",
    );
    const wallet = await walletRepository.findById(input.operationalWalletId);
    if (!wallet) {
      throw new NotFoundError("Operational wallet not found");
    }
    if (wallet.type !== WalletType.SINGLE_SIG) {
      throw new InvalidInputError(
        "Linked operational wallet must be single-sig",
      );
    }
    if (!wallet.descriptor || !wallet.changeDescriptor) {
      throw new InvalidInputError(
        "Linked operational wallet has no unused receive address available and no descriptor to derive one",
      );
    }
    const network = toSupportedNetwork(wallet.network);
    const policy = assertPersistedCanonicalPolicy(wallet);

    const existingAddress = await addressRepository.findNextUnusedReceive(
      input.operationalWalletId,
    );
    if (existingAddress) {
      assertCanonicalAddressesMatchWallet(wallet, [existingAddress], 0);
      return toOperationalReceiveAddress(existingAddress, false);
    }
    const receiveDescriptor = wallet.descriptor;
    const changeDescriptor = wallet.changeDescriptor;
    await addressRepository.createCanonicalBatch(
      input.operationalWalletId,
      { receive: INITIAL_ADDRESS_COUNT, change: 0 },
      (branch, index) => {
      const evidence = buildCanonicalAddressEvidence(
        receiveDescriptor,
        changeDescriptor,
        network,
        { canonicalPolicyId: policy.id, canonicalPolicyVersion: policy.version },
        branch,
        index,
      );

      if (!isReceivePath(evidence.derivationPath)) {
        throw new InvalidInputError(
          "Derived operational address is not a receive address",
        );
      }

      return evidence;
    });

    const generatedAddress = await addressRepository.findNextUnusedReceive(
      input.operationalWalletId,
    );
    if (!generatedAddress) {
      throw new InvalidInputError(
        "Linked operational wallet has no unused receive address available",
      );
    }
    assertCanonicalAddressesMatchWallet(wallet, [generatedAddress], 0);

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
  const record = await addressRepository.findByWalletIdAndAddressWithWallet(
    input.operationalWalletId,
    input.address,
  );
  let verified = false;
  if (record
    && record.wallet.type === WalletType.SINGLE_SIG
    && isReceivePath(record.derivationPath)) {
    try {
      assertCanonicalAddressesMatchWallet(record.wallet, [record], 0);
      verified = true;
    } catch {
      verified = false;
    }
  }

  return {
    walletId: input.operationalWalletId,
    address: input.address,
    verified,
    derivationPath: verified && record ? record.derivationPath : null,
    index: verified && record ? record.index : null,
  };
}
