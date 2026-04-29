/**
 * Transactions - Address Router
 *
 * Endpoints for listing and generating wallet addresses
 */

import { Router } from "express";
import { requireWalletAccess } from "../../middleware/walletAccess";
import { walletRepository, addressRepository } from "../../repositories";
import * as addressDerivation from "../../services/bitcoin/addressDerivation";
import { createLogger } from "../../utils/logger";
import { bigIntToNumberOrZero, getErrorMessage } from "../../utils/errors";
import {
  extractPagination,
  setTruncationHeaders,
} from "../../utils/pagination";
import { asyncHandler } from "../../errors/errorHandler";
import { NotFoundError, ValidationError } from "../../errors/ApiError";
import { INITIAL_ADDRESS_COUNT } from "../../constants";
import { validate } from "../../middleware/validate";
import { GenerateAddressesBodySchema } from "../schemas/transactions";
import {
  parseAddressDerivationPath,
  type DerivationAddressChain,
} from "../../../../shared/utils/bitcoin";

const router = Router();
const log = createLogger("ADDRESS:ROUTE");

interface AddressIndexBounds {
  receive: number;
  change: number;
}

function chainFromQueryValue(
  value: unknown,
): DerivationAddressChain | undefined {
  if (value === undefined) return undefined;
  return value === "true" ? "change" : "receive";
}

function updateAddressIndexBounds(
  bounds: AddressIndexBounds,
  derivationPath: string,
): void {
  const parsed = parseAddressDerivationPath(derivationPath);
  if (!parsed) return;

  if (parsed.chain === "receive" && parsed.addressIndex > bounds.receive) {
    bounds.receive = parsed.addressIndex;
  } else if (parsed.chain === "change" && parsed.addressIndex > bounds.change) {
    bounds.change = parsed.addressIndex;
  }
}

function findAddressIndexBounds(
  addresses: Array<{ derivationPath: string }>,
): AddressIndexBounds {
  const bounds = { receive: -1, change: -1 };
  for (const address of addresses) {
    updateAddressIndexBounds(bounds, address.derivationPath);
  }
  return bounds;
}

/**
 * GET /api/v1/wallets/:walletId/addresses
 * Get all addresses for a wallet
 * Auto-generates addresses if wallet has descriptor but no addresses
 */
router.get(
  "/wallets/:walletId/addresses",
  requireWalletAccess("view"),
  asyncHandler(async (req, res) => {
    const walletId = req.walletId!;
    const { used, change } = req.query;
    const pagination = extractPagination(
      req.query as { limit?: string; offset?: string },
    );
    const { effectiveLimit, effectiveOffset } = pagination;

    // Get wallet for descriptor
    const wallet = await walletRepository.findById(walletId);

    if (!wallet) {
      throw new NotFoundError("Wallet not found");
    }

    const chain = chainFromQueryValue(change);

    // Check if addresses exist
    let addresses = await addressRepository.findByWalletIdWithLabels(walletId, {
      used: used !== undefined ? used === "true" : undefined,
      chain,
      take: effectiveLimit,
      skip: effectiveOffset,
    });

    // Auto-generate addresses if none exist and wallet has a descriptor
    if (addresses.length === 0 && wallet.descriptor && used === undefined) {
      try {
        const addressesToCreate = [];

        // Generate receive addresses (change = 0)
        for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
          const { address, derivationPath } =
            addressDerivation.deriveAddressFromDescriptor(
              wallet.descriptor,
              i,
              {
                network: wallet.network as "mainnet" | "testnet" | "regtest",
                change: false, // External/receive addresses
              },
            );
          addressesToCreate.push({
            walletId,
            address,
            derivationPath,
            index: i,
            used: false,
          });
        }

        // Generate change addresses (change = 1)
        for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
          const { address, derivationPath } =
            addressDerivation.deriveAddressFromDescriptor(
              wallet.descriptor,
              i,
              {
                network: wallet.network as "mainnet" | "testnet" | "regtest",
                change: true, // Internal/change addresses
              },
            );
          addressesToCreate.push({
            walletId,
            address,
            derivationPath,
            index: i,
            used: false,
          });
        }

        // Bulk insert addresses
        await addressRepository.createMany(addressesToCreate);

        // Re-fetch the created addresses (respect pagination)
        addresses = await addressRepository.findByWalletIdWithLabels(walletId, {
          take: effectiveLimit,
          skip: effectiveOffset,
        });
      } catch (err) {
        log.error("Failed to auto-generate addresses", {
          error: getErrorMessage(err),
        });
        // Return empty array if generation fails
      }
    }

    // Get balances for each address from UTXOs
    const addressList = addresses.map((addr) => addr.address);
    const utxos = await addressRepository.findUtxoBalancesByAddresses(
      walletId,
      addressList,
    );

    // Sum balances by address
    const addressBalances = new Map<string, number>();
    for (const utxo of utxos) {
      const current = addressBalances.get(utxo.address) || 0;
      addressBalances.set(
        utxo.address,
        current + bigIntToNumberOrZero(utxo.amount),
      );
    }

    // Add balance, labels, and isChange flag to each address
    const addressesWithBalance = addresses.map(({ addressLabels, ...addr }) => {
      const isChange =
        parseAddressDerivationPath(addr.derivationPath)?.chain === "change";

      return {
        ...addr,
        balance: addressBalances.get(addr.address) || 0,
        labels: addressLabels.map((al) => al.label),
        isChange,
      };
    });

    setTruncationHeaders(res, addresses.length, pagination);

    res.json(addressesWithBalance);
  }),
);

/**
 * GET /api/v1/wallets/:walletId/addresses/summary
 * Get summary counts and balances for a wallet's addresses
 */
router.get(
  "/wallets/:walletId/addresses/summary",
  requireWalletAccess("view"),
  asyncHandler(async (req, res) => {
    const walletId = req.walletId!;

    const summary = await addressRepository.getAddressSummary(walletId);

    let usedBalance = 0;
    let unusedBalance = 0;
    for (const row of summary.usedBalances) {
      if (row.used) {
        usedBalance = bigIntToNumberOrZero(row.balance);
      } else {
        unusedBalance = bigIntToNumberOrZero(row.balance);
      }
    }

    res.json({
      totalAddresses: summary.totalCount,
      usedCount: summary.usedCount,
      unusedCount: summary.unusedCount,
      totalBalance: bigIntToNumberOrZero(
        summary.totalBalanceResult._sum.amount,
      ),
      usedBalance,
      unusedBalance,
    });
  }),
);

/**
 * POST /api/v1/wallets/:walletId/addresses/generate
 * Generate more addresses for a wallet (requires edit access: owner or signer)
 */
router.post(
  "/wallets/:walletId/addresses/generate",
  requireWalletAccess("edit"),
  validate({ body: GenerateAddressesBodySchema }),
  asyncHandler(async (req, res) => {
    const walletId = req.walletId!;
    const { count } = req.body;

    // Fetch wallet data
    const wallet = await walletRepository.findById(walletId);

    if (!wallet) {
      throw new NotFoundError("Wallet not found");
    }

    if (!wallet.descriptor) {
      throw new ValidationError("Wallet does not have a descriptor");
    }

    // Get current max index for receive and change addresses
    const existingAddresses =
      await addressRepository.findDerivationPaths(walletId);

    const maxIndexes = findAddressIndexBounds(existingAddresses);

    const addressesToCreate = [];

    // Generate more receive addresses
    for (
      let i = maxIndexes.receive + 1;
      i < maxIndexes.receive + 1 + count;
      i++
    ) {
      try {
        const { address, derivationPath } =
          addressDerivation.deriveAddressFromDescriptor(wallet.descriptor, i, {
            network: wallet.network as "mainnet" | "testnet" | "regtest",
            change: false,
          });
        addressesToCreate.push({
          walletId,
          address,
          derivationPath,
          index: i,
          used: false,
        });
      } catch (err) {
        log.error(`Failed to derive receive address ${i}`, {
          error: getErrorMessage(err),
        });
      }
    }

    // Generate more change addresses
    for (
      let i = maxIndexes.change + 1;
      i < maxIndexes.change + 1 + count;
      i++
    ) {
      try {
        const { address, derivationPath } =
          addressDerivation.deriveAddressFromDescriptor(wallet.descriptor, i, {
            network: wallet.network as "mainnet" | "testnet" | "regtest",
            change: true,
          });
        addressesToCreate.push({
          walletId,
          address,
          derivationPath,
          index: i,
          used: false,
        });
      } catch (err) {
        log.error(`Failed to derive change address ${i}`, {
          error: getErrorMessage(err),
        });
      }
    }

    // Bulk insert addresses (skip duplicates)
    if (addressesToCreate.length > 0) {
      await addressRepository.createMany(addressesToCreate, {
        skipDuplicates: true,
      });
    }

    res.json({
      generated: addressesToCreate.length,
      receiveAddresses: count,
      changeAddresses: count,
    });
  }),
);

export default router;
