/**
 * Transactions - Address Router
 *
 * Endpoints for listing and generating wallet addresses
 */

import { Router } from "express";
import { requireWalletAccess } from "../../middleware/walletAccess";
import { walletRepository, addressRepository } from "../../repositories";
import { bigIntToNumberOrZero } from "../../utils/errors";
import {
  extractPagination,
  setTruncationHeaders,
} from "../../utils/pagination";
import { asyncHandler } from "../../errors/errorHandler";
import { NotFoundError, ValidationError } from "../../errors/ApiError";
import { validate } from "../../middleware/validate";
import { GenerateAddressesBodySchema } from "../schemas/transactions";
import { parseAddressDerivationPath, type DerivationAddressChain } from "@sanctuary/shared/utils/bitcoin";
import type { WalletNetwork } from "../../services/wallet/types";
import { assertWalletHardwareCapabilityById } from "../../services/hardwareWalletCapabilities";
import { assertPersistedCanonicalPolicy } from '../../services/wallet/canonicalPolicy';
import type { NextCanonicalAddressData } from '../../repositories/addressRepository';
import { buildCanonicalAddressEvidence } from '../../services/wallet/addressGeneration';
import { assertCanonicalAddressesMatchWallet } from '../../services/wallet/canonicalAddressValidation';

const router = Router();
function chainFromQueryValue(
  value: unknown,
): DerivationAddressChain | undefined {
  if (value === undefined) return undefined;
  return value === "true" ? "change" : "receive";
}

function deriveCanonicalRecord(
  wallet: {
    id: string;
    type: string;
    scriptType: string;
    network: string;
    descriptor: string | null;
    changeDescriptor: string | null;
    canonicalPolicyId: string | null;
    canonicalPolicyVersion: number | null;
  },
  branch: 0 | 1,
  index: number,
): NextCanonicalAddressData {
  if (!wallet.descriptor || !wallet.changeDescriptor) {
    throw new ValidationError('Wallet requires authoritative receive and change descriptors');
  }
  const policy = assertPersistedCanonicalPolicy(wallet);
  return buildCanonicalAddressEvidence(
    wallet.descriptor,
    wallet.changeDescriptor,
    wallet.network as WalletNetwork,
    { canonicalPolicyId: policy.id, canonicalPolicyVersion: policy.version },
    branch,
    index,
  );
}

/**
 * GET /api/v1/wallets/:walletId/addresses
 * Get all addresses for a wallet
 * This read path never generates addresses; explicit mutations own allocation.
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

    // Used-address history remains viewable for recovery/audit. Any response
    // that can surface a fresh deposit destination requires display evidence.
    if (used !== "true") {
      await assertWalletHardwareCapabilityById(walletId, "display");
    }

    const chain = chainFromQueryValue(change);

    // Check if addresses exist
    const addresses = await addressRepository.findByWalletIdWithLabels(walletId, {
      used: used !== undefined ? used === "true" : undefined,
      chain,
      take: effectiveLimit,
      skip: effectiveOffset,
      canonicalOnly: used !== "true",
    });
    if (used !== "true") {
      assertCanonicalAddressesMatchWallet(wallet, addresses);
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

    if (!wallet.descriptor || !wallet.changeDescriptor) {
      throw new ValidationError("Wallet does not have a descriptor");
    }

    await assertWalletHardwareCapabilityById(walletId, "display");

    const addressesToCreate = await addressRepository.createCanonicalBatch(
      walletId,
      { receive: count, change: count },
      (branch, index) => deriveCanonicalRecord(wallet, branch, index),
    );

    res.json({
      generated: addressesToCreate.length,
      receiveAddresses: count,
      changeAddresses: count,
    });
  }),
);

export default router;
