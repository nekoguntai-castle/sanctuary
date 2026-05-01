/**
 * Remaining API Module Tests
 *
 * Coverage-focused unit tests for remaining low-coverage API modules:
 * - drafts, labels, payjoin, price, sync, transfers, twoFactor
 */

import { describe, expect, it } from "vitest";

import {
  mockDelete,
  mockGet,
  mockPatch,
  mockPost,
  mockPut,
  setupRemainingApiModuleMocks,
} from "./remainingApiModules.testHarness";

import * as draftsApi from "../../src/api/drafts";
import * as labelsApi from "../../src/api/labels";
import * as payjoinApi from "../../src/api/payjoin";
import * as priceApi from "../../src/api/price";
import * as syncApi from "../../src/api/sync";
import * as transfersApi from "../../src/api/transfers";
import * as twoFactorApi from "../../src/api/twoFactor";

describe("Remaining API Modules", () => {
  setupRemainingApiModuleMocks();

  describe("Drafts API", () => {
    it("calls draft CRUD endpoints", async () => {
      mockGet.mockResolvedValue([]);
      mockPost.mockResolvedValue({});
      mockPatch.mockResolvedValue({});
      mockDelete.mockResolvedValue({});

      await draftsApi.getDrafts("w1");
      await draftsApi.getDraft("w1", "d1");
      await draftsApi.createDraft("w1", {
        recipient: "bc1qdest",
        amount: 1000,
        feeRate: 5,
        psbtBase64: "psbt",
      });
      await draftsApi.updateDraft("w1", "d1", { status: "signed" });
      await draftsApi.deleteDraft("w1", "d1");

      expect(mockGet).toHaveBeenCalledWith("/wallets/w1/drafts");
      expect(mockGet).toHaveBeenCalledWith("/wallets/w1/drafts/d1");
      expect(mockPost).toHaveBeenCalledWith("/wallets/w1/drafts", {
        recipient: "bc1qdest",
        amount: 1000,
        feeRate: 5,
        psbtBase64: "psbt",
      });
      expect(mockPatch).toHaveBeenCalledWith("/wallets/w1/drafts/d1", {
        status: "signed",
      });
      expect(mockDelete).toHaveBeenCalledWith("/wallets/w1/drafts/d1");
    });
  });

  describe("Labels API", () => {
    it("calls label and item-label endpoints", async () => {
      mockGet.mockResolvedValue([]);
      mockPost.mockResolvedValue([]);
      mockPut.mockResolvedValue([]);
      mockDelete.mockResolvedValue({});

      await labelsApi.getLabels("w1");
      await labelsApi.getLabel("w1", "l1");
      await labelsApi.createLabel("w1", { name: "Important" });
      await labelsApi.updateLabel("w1", "l1", { color: "#ff0000" });
      await labelsApi.deleteLabel("w1", "l1");
      await labelsApi.getTransactionLabels("tx1");
      await labelsApi.addTransactionLabels("tx1", ["l1", "l2"]);
      await labelsApi.setTransactionLabels("tx1", ["l2"]);
      await labelsApi.removeTransactionLabel("tx1", "l2");
      await labelsApi.getAddressLabels("addr1");
      await labelsApi.addAddressLabels("addr1", ["l1"]);
      await labelsApi.setAddressLabels("addr1", ["l2"]);
      await labelsApi.removeAddressLabel("addr1", "l2");

      expect(mockGet).toHaveBeenCalledWith("/wallets/w1/labels");
      expect(mockGet).toHaveBeenCalledWith("/wallets/w1/labels/l1");
      expect(mockPost).toHaveBeenCalledWith("/wallets/w1/labels", {
        name: "Important",
      });
      expect(mockPut).toHaveBeenCalledWith("/wallets/w1/labels/l1", {
        color: "#ff0000",
      });
      expect(mockDelete).toHaveBeenCalledWith("/wallets/w1/labels/l1");
      expect(mockGet).toHaveBeenCalledWith("/transactions/tx1/labels");
      expect(mockPost).toHaveBeenCalledWith("/transactions/tx1/labels", {
        labelIds: ["l1", "l2"],
      });
      expect(mockPut).toHaveBeenCalledWith("/transactions/tx1/labels", {
        labelIds: ["l2"],
      });
      expect(mockDelete).toHaveBeenCalledWith("/transactions/tx1/labels/l2");
      expect(mockGet).toHaveBeenCalledWith("/addresses/addr1/labels");
      expect(mockPost).toHaveBeenCalledWith("/addresses/addr1/labels", {
        labelIds: ["l1"],
      });
      expect(mockPut).toHaveBeenCalledWith("/addresses/addr1/labels", {
        labelIds: ["l2"],
      });
      expect(mockDelete).toHaveBeenCalledWith("/addresses/addr1/labels/l2");
    });
  });

  describe("Payjoin API", () => {
    it("builds params and calls payjoin endpoints", async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});

      await payjoinApi.getPayjoinUri("addr-id");
      await payjoinApi.getPayjoinUri("addr-id", {
        amount: 1000,
        label: "Invoice",
        message: "Order #1",
      });
      await payjoinApi.parsePayjoinUri("bitcoin:bc1q...");
      await payjoinApi.attemptPayjoin("psbt1", "https://pj.example", "mainnet");
      await payjoinApi.checkPayjoinEligibility("w1");

      expect(mockGet).toHaveBeenCalledWith("/payjoin/address/addr-id/uri", {});
      expect(mockGet).toHaveBeenCalledWith("/payjoin/address/addr-id/uri", {
        amount: "1000",
        label: "Invoice",
        message: "Order #1",
      });
      expect(mockPost).toHaveBeenCalledWith("/payjoin/parse-uri", {
        uri: "bitcoin:bc1q...",
      });
      expect(mockPost).toHaveBeenCalledWith("/payjoin/attempt", {
        psbt: "psbt1",
        payjoinUrl: "https://pj.example",
        network: "mainnet",
      });
      expect(mockGet).toHaveBeenCalledWith("/payjoin/eligibility/w1");
    });
  });

  describe("Price API", () => {
    it("calls price and conversion endpoints with params", async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});

      await priceApi.getPrice();
      await priceApi.getPrice("EUR", false);
      await priceApi.getMultiplePrices(["USD", "EUR"]);
      await priceApi.getPriceFromProvider("coingecko", "JPY");
      await priceApi.convertToFiat({ sats: 100000, currency: "USD" });
      await priceApi.convertToSats({ amount: 20, currency: "USD" });
      await priceApi.getSupportedCurrencies();
      await priceApi.getProviders();
      await priceApi.getProviderDiagnostics();
      await priceApi.setPriceProviderEnabled("binance", true);
      await priceApi.testPriceProvider("binance", "EUR");
      await priceApi.testAllPriceProviders("JPY");
      await priceApi.checkProviderHealth();
      await priceApi.getCacheStats();
      await priceApi.clearCache();
      await priceApi.setCacheDuration(120);

      expect(mockGet).toHaveBeenCalledWith("/price", {
        currency: "USD",
        useCache: "true",
      });
      expect(mockGet).toHaveBeenCalledWith("/price", {
        currency: "EUR",
        useCache: "false",
      });
      expect(mockGet).toHaveBeenCalledWith("/price/multiple", {
        currencies: "USD,EUR",
      });
      expect(mockGet).toHaveBeenCalledWith("/price/from/coingecko", {
        currency: "JPY",
      });
      expect(mockPost).toHaveBeenCalledWith("/price/convert/to-fiat", {
        sats: 100000,
        currency: "USD",
      });
      expect(mockPost).toHaveBeenCalledWith("/price/convert/to-sats", {
        amount: 20,
        currency: "USD",
      });
      expect(mockGet).toHaveBeenCalledWith("/price/currencies");
      expect(mockGet).toHaveBeenCalledWith("/price/providers");
      expect(mockGet).toHaveBeenCalledWith("/price/providers/status");
      expect(mockPatch).toHaveBeenCalledWith("/price/providers/binance", {
        enabled: true,
      });
      expect(mockPost).toHaveBeenCalledWith("/price/providers/binance/test", {
        currency: "EUR",
      });
      expect(mockPost).toHaveBeenCalledWith("/price/providers/test", {
        currency: "JPY",
      });
      expect(mockGet).toHaveBeenCalledWith("/price/health");
      expect(mockGet).toHaveBeenCalledWith("/price/cache/stats");
      expect(mockPost).toHaveBeenCalledWith("/price/cache/clear");
      expect(mockPost).toHaveBeenCalledWith("/price/cache/duration", {
        duration: 120,
      });
    });
  });

  describe("Sync API", () => {
    it("calls wallet and network sync endpoints", async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});

      await syncApi.syncWallet("w1");
      await syncApi.queueSync("w1");
      await syncApi.queueSync("w1", "high");
      await syncApi.getSyncStatus("w1");
      await syncApi.queueUserWallets();
      await syncApi.queueUserWallets("low");
      await syncApi.resyncWallet("w1");
      await syncApi.syncNetworkWallets("mainnet");
      await syncApi.syncNetworkWallets("mainnet", "high");
      await syncApi.resyncNetworkWallets("testnet");
      await syncApi.getNetworkSyncStatus("signet");

      expect(mockPost).toHaveBeenCalledWith("/sync/wallet/w1");
      expect(mockPost).toHaveBeenCalledWith("/sync/queue/w1", {
        priority: "normal",
      });
      expect(mockPost).toHaveBeenCalledWith("/sync/queue/w1", {
        priority: "high",
      });
      expect(mockGet).toHaveBeenCalledWith("/sync/status/w1");
      expect(mockPost).toHaveBeenCalledWith("/sync/user", {
        priority: "normal",
      });
      expect(mockPost).toHaveBeenCalledWith("/sync/user", { priority: "low" });
      expect(mockPost).toHaveBeenCalledWith("/sync/resync/w1");
      expect(mockPost).toHaveBeenCalledWith("/sync/network/mainnet", {
        priority: "normal",
      });
      expect(mockPost).toHaveBeenCalledWith("/sync/network/mainnet", {
        priority: "high",
      });
      expect(mockPost).toHaveBeenCalledWith(
        "/sync/network/testnet/resync",
        {},
        { headers: { "X-Confirm-Resync": "true" } },
      );
      expect(mockGet).toHaveBeenCalledWith("/sync/network/signet/status");
    });

    it("returns logs array from getWalletLogs", async () => {
      mockGet.mockResolvedValue({ logs: [{ level: "info", message: "ok" }] });
      const logs = await syncApi.getWalletLogs("w1");
      expect(logs).toEqual([{ level: "info", message: "ok" }]);
      expect(mockGet).toHaveBeenCalledWith("/sync/logs/w1");
    });
  });

  describe("Transfers API", () => {
    it("calls transfer endpoints and builds filters", async () => {
      mockGet.mockResolvedValue({});
      mockPost.mockResolvedValue({});

      await transfersApi.initiateTransfer({
        resourceType: "wallet",
        resourceId: "w1",
        toUserId: "u2",
      } as any);
      await transfersApi.getTransfers();
      await transfersApi.getTransfers({
        role: "sender",
        status: "pending",
        resourceType: "wallet",
      } as any);
      await transfersApi.getTransferCounts();
      await transfersApi.getTransfer("t1");
      await transfersApi.acceptTransfer("t1");
      await transfersApi.declineTransfer("t1", { reason: "No thanks" });
      await transfersApi.cancelTransfer("t1");
      await transfersApi.confirmTransfer("t1");

      expect(mockPost).toHaveBeenCalledWith("/transfers", {
        resourceType: "wallet",
        resourceId: "w1",
        toUserId: "u2",
      });
      expect(mockGet).toHaveBeenCalledWith("/transfers", {});
      expect(mockGet).toHaveBeenCalledWith("/transfers", {
        role: "sender",
        status: "pending",
        resourceType: "wallet",
      });
      expect(mockGet).toHaveBeenCalledWith("/transfers/counts");
      expect(mockGet).toHaveBeenCalledWith("/transfers/t1");
      expect(mockPost).toHaveBeenCalledWith("/transfers/t1/accept");
      expect(mockPost).toHaveBeenCalledWith("/transfers/t1/decline", {
        reason: "No thanks",
      });
      expect(mockPost).toHaveBeenCalledWith("/transfers/t1/cancel");
      expect(mockPost).toHaveBeenCalledWith("/transfers/t1/confirm");
    });

    it("covers transfer helper predicates and status mapping", () => {
      const pending = {
        status: "pending",
        fromUserId: "u1",
        toUserId: "u2",
      } as any;
      const accepted = {
        status: "accepted",
        fromUserId: "u1",
        toUserId: "u2",
      } as any;
      const confirmed = {
        status: "confirmed",
        fromUserId: "u1",
        toUserId: "u2",
      } as any;

      expect(transfersApi.isTransferActive(pending)).toBe(true);
      expect(transfersApi.isTransferActive(confirmed)).toBe(false);
      expect(transfersApi.canAcceptTransfer(pending, "u2")).toBe(true);
      expect(transfersApi.canAcceptTransfer(pending, "u3")).toBe(false);
      expect(transfersApi.canConfirmTransfer(accepted, "u1")).toBe(true);
      expect(transfersApi.canCancelTransfer(accepted, "u1")).toBe(true);
      expect(transfersApi.canCancelTransfer(confirmed, "u1")).toBe(false);

      expect(transfersApi.getTransferStatusInfo("pending")).toEqual({
        label: "Pending Acceptance",
        color: "warning",
      });
      expect(transfersApi.getTransferStatusInfo("accepted")).toEqual({
        label: "Awaiting Confirmation",
        color: "info",
      });
      expect(transfersApi.getTransferStatusInfo("confirmed")).toEqual({
        label: "Completed",
        color: "success",
      });
      expect(transfersApi.getTransferStatusInfo("cancelled")).toEqual({
        label: "Cancelled",
        color: "error",
      });
      expect(transfersApi.getTransferStatusInfo("declined")).toEqual({
        label: "Declined",
        color: "error",
      });
      expect(transfersApi.getTransferStatusInfo("expired")).toEqual({
        label: "Expired",
        color: "error",
      });
      expect(transfersApi.getTransferStatusInfo("mystery")).toEqual({
        label: "mystery",
        color: "info",
      });
    });
  });

  describe("Two-Factor API", () => {
    it("calls setup, enable, disable, verify, and backup endpoints", async () => {
      // Phase 4: verify2FA no longer sets a JS token — the backend sets
      // browser auth cookies on this response and the ApiClient parses
      // X-Access-Expires-At from the headers. The helper just returns
      // the response payload.
      mockPost.mockResolvedValue({});

      await twoFactorApi.setup2FA();
      await twoFactorApi.enable2FA("123456");
      await twoFactorApi.disable2FA({ password: "p", token: "123456" });

      // Phase 6: verify2FA response body no longer carries a token field.
      const verifyResponse = { user: { id: "u1" } };
      mockPost.mockResolvedValueOnce(verifyResponse);
      const result = await twoFactorApi.verify2FA({
        tempToken: "tmp",
        code: "111111",
      });

      await twoFactorApi.getBackupCodesCount("password");
      await twoFactorApi.regenerateBackupCodes({
        password: "password",
        token: "222222",
      });

      expect(mockPost).toHaveBeenCalledWith("/auth/2fa/setup", {});
      expect(mockPost).toHaveBeenCalledWith("/auth/2fa/enable", {
        token: "123456",
      });
      expect(mockPost).toHaveBeenCalledWith("/auth/2fa/disable", {
        password: "p",
        token: "123456",
      });
      expect(mockPost).toHaveBeenCalledWith("/auth/2fa/verify", {
        tempToken: "tmp",
        code: "111111",
      });
      expect(result).toEqual(verifyResponse);
      expect(mockPost).toHaveBeenCalledWith("/auth/2fa/backup-codes", {
        password: "password",
      });
      expect(mockPost).toHaveBeenCalledWith(
        "/auth/2fa/backup-codes/regenerate",
        { password: "password", token: "222222" },
      );
    });
  });

});
