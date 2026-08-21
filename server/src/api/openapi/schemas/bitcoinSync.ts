import { BITCOIN_NON_REGTEST_NETWORKS } from "@sanctuary/shared/constants/bitcoin";
import {
  SYNC_EXECUTION_OWNER_VALUES,
  SYNC_PRIORITY_VALUES,
} from "@sanctuary/shared/constants/sync";

export const syncSchemas = {
  SyncPriority: {
    type: "string",
    enum: [...SYNC_PRIORITY_VALUES],
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
      executionOwner: {
        type: "string",
        enum: [...SYNC_EXECUTION_OWNER_VALUES],
        nullable: true,
      },
      retryCount: { type: "integer", minimum: 0 },
      nextRetryAt: { type: "string", format: "date-time", nullable: true },
      startedAt: { type: "string", format: "date-time", nullable: true },
      stateVersion: { type: "integer", minimum: 0 },
    },
    required: [
      "lastSyncedAt",
      "syncStatus",
      "syncInProgress",
      "isStale",
      "queuePosition",
      "executionOwner",
      "retryCount",
      "nextRetryAt",
      "startedAt",
      "stateVersion",
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
      status: { type: "string", enum: ["accepted", "deduplicated"] },
      walletId: { type: "string" },
    },
    required: ["success", "message", "status", "walletId"],
  },
  FullResyncEnqueueOutcome: {
    oneOf: [
      {
        type: "object",
        properties: {
          walletId: { type: "string" },
          status: { type: "string", enum: ["accepted", "deduplicated"] },
        },
        required: ["walletId", "status"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          walletId: { type: "string" },
          status: { type: "string", enum: ["rejected"] },
          reason: {
            type: "string",
            enum: ["queue_unavailable", "queue_error"],
          },
        },
        required: ["walletId", "status", "reason"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          walletId: { type: "string" },
          status: { type: "string", enum: ["indeterminate"] },
          reason: { type: "string", enum: ["queue_state_unknown"] },
        },
        required: ["walletId", "status", "reason"],
        additionalProperties: false,
      },
    ],
  },
  FullResyncUnavailableResponse: {
    allOf: [
      { $ref: "#/components/schemas/ApiError" },
      {
        type: "object",
        properties: {
          details: {
            type: "object",
            properties: {
              outcomes: {
                type: "array",
                items: { $ref: "#/components/schemas/FullResyncEnqueueOutcome" },
              },
            },
            required: ["outcomes"],
            additionalProperties: false,
          },
        },
        required: ["details"],
      },
    ],
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
          acceptedWalletIds: {
            type: "array",
            items: { type: "string" },
          },
          deduplicatedWalletIds: {
            type: "array",
            items: { type: "string" },
          },
          rejectedWallets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                walletId: { type: "string" },
                reason: {
                  type: "string",
                  enum: ["queue_unavailable", "queue_error"],
                },
              },
              required: ["walletId", "reason"],
              additionalProperties: false,
            },
          },
          indeterminateWallets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                walletId: { type: "string" },
                reason: { type: "string", enum: ["queue_state_unknown"] },
              },
              required: ["walletId", "reason"],
              additionalProperties: false,
            },
          },
          excludedWallets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                walletId: { type: "string" },
                reason: { type: "string", enum: ["network_not_syncable"] },
              },
              required: ["walletId", "reason"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "acceptedWalletIds",
          "deduplicatedWalletIds",
          "rejectedWallets",
          "indeterminateWallets",
          "excludedWallets",
        ],
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
