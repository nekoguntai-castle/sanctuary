import { BITCOIN_NON_REGTEST_NETWORKS } from "@sanctuary/shared/constants/bitcoin";

export const syncSchemas = {
  SyncPriority: {
    type: "string",
    enum: ["high", "normal", "low"],
  },
  SyncPriorityRequest: {
    type: "object",
    properties: {
      priority: { $ref: "#/components/schemas/SyncPriority" },
    },
    additionalProperties: false,
  },
  SyncResult: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      syncedAddresses: { type: "integer", minimum: 0 },
      newTransactions: { type: "integer", minimum: 0 },
      newUtxos: { type: "integer", minimum: 0 },
      error: { type: "string", nullable: true },
    },
    required: ["success", "syncedAddresses", "newTransactions", "newUtxos"],
  },
  QueuedWalletSyncResponse: {
    type: "object",
    properties: {
      queued: { type: "boolean", enum: [true] },
      queuePosition: { type: "integer", nullable: true, minimum: 0 },
      syncInProgress: { type: "boolean" },
    },
    required: ["queued", "queuePosition", "syncInProgress"],
  },
  WalletSyncStatus: {
    type: "object",
    properties: {
      lastSyncedAt: { type: "string", format: "date-time", nullable: true },
      syncStatus: { type: "string", nullable: true },
      syncInProgress: { type: "boolean" },
      isStale: { type: "boolean" },
      queuePosition: { type: "integer", nullable: true, minimum: 0 },
    },
    required: [
      "lastSyncedAt",
      "syncStatus",
      "syncInProgress",
      "isStale",
      "queuePosition",
    ],
  },
  WalletSyncLogsResponse: {
    type: "object",
    properties: {
      logs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
        },
      },
    },
    required: ["logs"],
  },
  SyncSimpleSuccessResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", enum: [true] },
      message: { type: "string" },
    },
    required: ["success", "message"],
  },
  ResyncWalletResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", enum: [true] },
      message: { type: "string" },
      deletedTransactions: { type: "integer", minimum: 0 },
    },
    required: ["success", "message", "deletedTransactions"],
  },
  NetworkSyncResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", enum: [true] },
      queued: { type: "integer", minimum: 0 },
      walletIds: {
        type: "array",
        items: { type: "string" },
      },
      message: { type: "string" },
    },
    required: ["success", "queued", "walletIds"],
  },
  NetworkResyncResponse: {
    allOf: [
      { $ref: "#/components/schemas/NetworkSyncResponse" },
      {
        type: "object",
        properties: {
          deletedTransactions: { type: "integer", minimum: 0 },
          clearedStuckFlags: { type: "integer", minimum: 0 },
        },
      },
    ],
  },
  NetworkSyncStatusResponse: {
    type: "object",
    properties: {
      network: { type: "string", enum: [...BITCOIN_NON_REGTEST_NETWORKS] },
      total: { type: "integer", minimum: 0 },
      syncing: { type: "integer", minimum: 0 },
      synced: { type: "integer", minimum: 0 },
      failed: { type: "integer", minimum: 0 },
      pending: { type: "integer", minimum: 0 },
      lastSyncAt: { type: "string", format: "date-time", nullable: true },
    },
    required: [
      "network",
      "total",
      "syncing",
      "synced",
      "failed",
      "pending",
      "lastSyncAt",
    ],
  },
  BitcoinLegacyWalletSyncResponse: {
    type: "object",
    properties: {
      message: { type: "string" },
    },
    required: ["message"],
    additionalProperties: true,
  },
  BitcoinUpdateConfirmationsResponse: {
    type: "object",
    properties: {
      message: { type: "string" },
      updated: {
        type: "array",
        items: {
          type: "object",
          properties: {
            txid: { type: "string" },
            oldConfirmations: { type: "integer", minimum: 0 },
            newConfirmations: { type: "integer", minimum: 0 },
          },
          required: ["txid", "oldConfirmations", "newConfirmations"],
        },
      },
    },
    required: ["message", "updated"],
  },
} as const;
