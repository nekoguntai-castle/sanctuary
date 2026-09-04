import { BITCOIN_NETWORKS } from "@sanctuary/shared/constants/bitcoin";
import { WALLET_SCRIPT_TYPE_VALUES } from "@sanctuary/shared/constants/walletIdentity";
import { MOBILE_API_REQUEST_LIMITS } from "@sanctuary/shared/schemas/mobileApiRequests";
import { NODE_POOL_LOAD_BALANCING_VALUES } from "@sanctuary/shared/constants/nodeConfig";
import {
  SERVER_AVAILABILITY_VALUES,
  POOL_FALLBACK_REASON_VALUES,
} from "@sanctuary/shared/types/nodeOperationalStatus";

export { SERVER_AVAILABILITY_VALUES, POOL_FALLBACK_REASON_VALUES };
import { ELECTRUM_SERVER_USAGE_VALUES } from "../../../services/bitcoin/electrum/capabilities";

export { syncSchemas } from "./bitcoinSync";
export { priceSchemas } from "./price";

const SILENT_PAYMENT_READINESS_BLOCKERS = [
  "FEATURE_DISABLED",
  "NO_SILENT_PAYMENT_ENDPOINT",
  "NO_COMPATIBLE_SERVER",
  "FEATURE_POOL_UNHEALTHY",
  "FEATURE_POOL_UNAVAILABLE",
] as const;

export const bitcoinSchemas = {
  BitcoinSimpleErrorResponse: {
    type: "object",
    properties: {
      error: { type: "string" },
      message: { type: "string" },
    },
    required: ["error", "message"],
  },
  BitcoinStatus: {
    type: "object",
    properties: {
      connected: { type: "boolean" },
      server: { type: "string" },
      protocol: { type: "string" },
      blockHeight: { type: "integer" },
      network: { type: "string" },
      host: { type: "string" },
      useSsl: { type: "boolean" },
      explorerUrl: { type: "string" },
      confirmationThreshold: { type: "integer" },
      deepConfirmationThreshold: { type: "integer" },
      error: { type: "string" },
      pool: {
        oneOf: [{ type: "null" }, { $ref: "#/components/schemas/BitcoinStatusPool" }],
      },
      // Present for normal connected/disconnected envelopes; omitted only in
      // the minimal legacy envelope emitted when configuration read itself
      // failed (`{ connected: false, error }`).
      operational: {
        oneOf: [{ type: "null" }, { $ref: "#/components/schemas/NodeOperationalStatus" }],
      },
    },
    required: ["connected"],
  },
  BitcoinStatusServerStats: {
    type: "object",
    properties: {
      serverId: { type: "string" },
      label: { type: "string" },
      host: { type: "string" },
      port: { type: "integer" },
      connectionCount: { type: "integer" },
      healthyConnections: { type: "integer" },
      totalRequests: { type: "integer" },
      failedRequests: { type: "integer" },
      isHealthy: { type: "boolean" },
      lastHealthCheck: { type: "string", format: "date-time", nullable: true },
      consecutiveFailures: { type: "integer" },
      backoffLevel: { type: "integer" },
      cooldownUntil: { type: "string", format: "date-time", nullable: true },
      weight: { type: "number" },
      // Legacy raw health-check history; kept loosely typed since it is
      // internal diagnostic detail, not part of the public contract.
      healthHistory: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
      serverUsage: {
        type: "string",
        enum: [...ELECTRUM_SERVER_USAGE_VALUES],
      },
      supportsVerbose: { type: "boolean", nullable: true },
      supportsSilentPaymentsV0: { type: "boolean", nullable: true },
      lastCapabilityCheck: { type: "string", format: "date-time", nullable: true },
      lastCapabilityError: { type: "string", nullable: true },
    },
    required: [
      "serverId",
      "label",
      "host",
      "port",
      "connectionCount",
      "healthyConnections",
      "totalRequests",
      "failedRequests",
      "isHealthy",
      "lastHealthCheck",
      "consecutiveFailures",
      "backoffLevel",
      "cooldownUntil",
      "weight",
      "healthHistory",
    ],
    additionalProperties: true,
  },
  BitcoinStatusPoolStats: {
    type: "object",
    properties: {
      totalConnections: { type: "integer" },
      activeConnections: { type: "integer" },
      idleConnections: { type: "integer" },
      waitingRequests: { type: "integer" },
      totalAcquisitions: { type: "integer" },
      averageAcquisitionTimeMs: { type: "number" },
      healthCheckFailures: { type: "integer" },
      serverCount: { type: "integer" },
      servers: {
        type: "array",
        items: { $ref: "#/components/schemas/BitcoinStatusServerStats" },
      },
    },
    required: [
      "totalConnections",
      "activeConnections",
      "idleConnections",
      "waitingRequests",
      "totalAcquisitions",
      "averageAcquisitionTimeMs",
      "healthCheckFailures",
      "serverCount",
      "servers",
    ],
    additionalProperties: true,
  },
  BitcoinStatusPool: {
    type: "object",
    properties: {
      enabled: { type: "boolean" },
      minConnections: { type: "integer" },
      maxConnections: { type: "integer" },
      configuredMin: { type: "integer" },
      configuredMax: { type: "integer" },
      stats: {
        oneOf: [{ type: "null" }, { $ref: "#/components/schemas/BitcoinStatusPoolStats" }],
      },
    },
    required: ["enabled", "minConnections", "maxConnections", "stats"],
    additionalProperties: true,
  },
  ServerAvailability: {
    type: "string",
    enum: [...SERVER_AVAILABILITY_VALUES],
  },
  PoolFallbackReason: {
    type: "string",
    enum: [...POOL_FALLBACK_REASON_VALUES],
  },
  NodeRouteObservation: {
    oneOf: [
      {
        type: "object",
        properties: {
          transport: { type: "string", enum: ["pool"] },
          observedAt: { type: "string", format: "date-time" },
          serverId: { type: "string" },
        },
        required: ["transport", "observedAt", "serverId"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          transport: { type: "string", enum: ["singleton"] },
          observedAt: { type: "string", format: "date-time" },
          serverId: { type: "null" },
        },
        required: ["transport", "observedAt", "serverId"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          transport: { type: "string", enum: ["singleton_fallback"] },
          observedAt: { type: "string", format: "date-time" },
          serverId: { type: "null" },
          fallbackReason: { $ref: "#/components/schemas/PoolFallbackReason" },
        },
        required: ["transport", "observedAt", "serverId", "fallbackReason"],
        additionalProperties: false,
      },
    ],
  },
  OperationalServer: {
    type: "object",
    properties: {
      serverId: { type: "string" },
      label: { type: "string" },
      host: { type: "string" },
      port: { type: "integer" },
      priority: { type: "integer" },
      availability: { $ref: "#/components/schemas/ServerAvailability" },
      checkedAt: { type: "string", format: "date-time", nullable: true },
    },
    required: ["serverId", "label", "host", "port", "priority", "availability", "checkedAt"],
    additionalProperties: false,
  },
  PoolOperationalStatus: {
    type: "object",
    properties: {
      strategy: {
        type: "string",
        enum: [...NODE_POOL_LOAD_BALANCING_VALUES],
      },
      online: { type: "integer", minimum: 0 },
      offline: { type: "integer", minimum: 0 },
      cooldown: { type: "integer", minimum: 0 },
      unchecked: { type: "integer", minimum: 0 },
      stale: { type: "integer", minimum: 0 },
      primaryServerId: { type: "string", nullable: true },
      preferredServerId: { type: "string", nullable: true },
      nextFailoverServerId: { type: "string", nullable: true },
      servers: {
        type: "array",
        items: { $ref: "#/components/schemas/OperationalServer" },
      },
    },
    required: [
      "strategy",
      "online",
      "offline",
      "cooldown",
      "unchecked",
      "stale",
      "primaryServerId",
      "preferredServerId",
      "nextFailoverServerId",
      "servers",
    ],
    additionalProperties: false,
  },
  NodeOperationalStatus: {
    type: "object",
    properties: {
      configuredMode: { type: "string", enum: ["singleton", "pool"] },
      attemptedAt: { type: "string", format: "date-time" },
      route: {
        oneOf: [{ type: "null" }, { $ref: "#/components/schemas/NodeRouteObservation" }],
      },
      pool: {
        oneOf: [{ type: "null" }, { $ref: "#/components/schemas/PoolOperationalStatus" }],
      },
    },
    required: ["configuredMode", "attemptedAt", "route", "pool"],
    additionalProperties: false,
  },
  SilentPaymentReadinessBlocker: {
    type: "string",
    enum: [...SILENT_PAYMENT_READINESS_BLOCKERS],
  },
  SilentPaymentServerReadiness: {
    type: "object",
    properties: {
      id: { type: "string" },
      label: { type: "string" },
      host: { type: "string" },
      port: { type: "integer", minimum: 1, maximum: 65535 },
      useSsl: { type: "boolean" },
      serverUsage: {
        type: "string",
        enum: [...ELECTRUM_SERVER_USAGE_VALUES],
      },
      capabilityStatus: {
        type: "string",
        enum: ["supported", "unsupported", "unknown", "stale", "error"],
      },
      supportsSilentPaymentsV0: { type: "boolean", nullable: true },
      silentPaymentVersions: {
        type: "array",
        items: { type: "integer", minimum: 0 },
      },
      lastCapabilityCheck: { type: "string", format: "date-time", nullable: true },
      lastCapabilityError: { type: "string", nullable: true },
    },
    required: [
      "id",
      "label",
      "host",
      "port",
      "useSsl",
      "serverUsage",
      "capabilityStatus",
      "supportsSilentPaymentsV0",
      "silentPaymentVersions",
      "lastCapabilityCheck",
      "lastCapabilityError",
    ],
    additionalProperties: false,
  },
  SilentPaymentReadiness: {
    type: "object",
    properties: {
      featureEnabled: { type: "boolean" },
      ready: { type: "boolean" },
      network: { type: "string", enum: [...BITCOIN_NETWORKS] },
      requiredFeatures: {
        type: "array",
        items: { type: "string", enum: ["silent_payments_v0"] },
      },
      blockers: {
        type: "array",
        items: { $ref: "#/components/schemas/SilentPaymentReadinessBlocker" },
      },
      compatibleServerCount: { type: "integer", minimum: 0 },
      endpointCount: { type: "integer", minimum: 0 },
      featurePoolHealthy: { type: "boolean" },
      servers: {
        type: "array",
        items: { $ref: "#/components/schemas/SilentPaymentServerReadiness" },
      },
    },
    required: [
      "featureEnabled",
      "ready",
      "network",
      "requiredFeatures",
      "blockers",
      "compatibleServerCount",
      "endpointCount",
      "featurePoolHealthy",
      "servers",
    ],
    additionalProperties: false,
  },
  BitcoinMempoolBlock: {
    type: "object",
    properties: {
      height: {
        oneOf: [{ type: "integer" }, { type: "string" }],
      },
      medianFee: { type: "number" },
      avgFeeRate: { type: "number" },
      feeRange: { type: "string" },
      size: { type: "number" },
      time: { type: "string" },
      status: { type: "string", enum: ["pending", "confirmed"] },
      txCount: { type: "integer", minimum: 0 },
      totalFees: { type: "number" },
    },
    required: [
      "height",
      "medianFee",
      "feeRange",
      "size",
      "time",
      "status",
      "txCount",
    ],
    additionalProperties: true,
  },
  BitcoinMempoolResponse: {
    type: "object",
    properties: {
      mempool: {
        type: "array",
        items: { $ref: "#/components/schemas/BitcoinMempoolBlock" },
      },
      blocks: {
        type: "array",
        items: { $ref: "#/components/schemas/BitcoinMempoolBlock" },
      },
      mempoolInfo: {
        type: "object",
        properties: {
          count: { type: "integer", minimum: 0 },
          size: { type: "number", minimum: 0 },
          totalFees: { type: "number", minimum: 0 },
        },
        required: ["count", "size", "totalFees"],
      },
      queuedBlocksSummary: {
        type: "object",
        nullable: true,
        properties: {
          blockCount: { type: "integer", minimum: 0 },
          totalTransactions: { type: "integer", minimum: 0 },
          averageFee: { type: "number", minimum: 0 },
          totalFees: { type: "number", minimum: 0 },
        },
        required: [
          "blockCount",
          "totalTransactions",
          "averageFee",
          "totalFees",
        ],
      },
      stale: { type: "boolean" },
    },
    required: ["mempool", "blocks", "mempoolInfo"],
    additionalProperties: true,
  },
  BitcoinRecentBlock: {
    type: "object",
    additionalProperties: true,
  },
  BitcoinBlockHeader: {
    type: "object",
    additionalProperties: true,
  },
  BitcoinTransactionDetails: {
    type: "object",
    additionalProperties: true,
  },
  FeeEstimates: {
    type: "object",
    properties: {
      fastest: { type: "number" },
      halfHour: { type: "number" },
      hour: { type: "number" },
      economy: { type: "number" },
      minimum: { type: "number" },
      source: { type: "string", enum: ["mempool", "electrum"] },
    },
    required: ["fastest", "halfHour", "hour", "economy", "minimum", "source"],
  },
  AdvancedFeeTier: {
    type: "object",
    properties: {
      feeRate: { type: "number", minimum: 0 },
      blocks: { type: "integer", minimum: 1 },
      minutes: { type: "integer", minimum: 0 },
    },
    required: ["feeRate", "blocks", "minutes"],
  },
  AdvancedFeeEstimates: {
    type: "object",
    properties: {
      fastest: { $ref: "#/components/schemas/AdvancedFeeTier" },
      fast: { $ref: "#/components/schemas/AdvancedFeeTier" },
      medium: { $ref: "#/components/schemas/AdvancedFeeTier" },
      slow: { $ref: "#/components/schemas/AdvancedFeeTier" },
      minimum: { $ref: "#/components/schemas/AdvancedFeeTier" },
    },
    required: ["fastest", "fast", "medium", "slow", "minimum"],
    additionalProperties: true,
  },
  BitcoinScriptType: {
    type: "string",
    enum: [...WALLET_SCRIPT_TYPE_VALUES],
  },
  BitcoinFeePriority: {
    type: "string",
    enum: ["fastest", "fast", "medium", "slow", "minimum"],
  },
  EstimateFeeRequest: {
    type: "object",
    properties: {
      inputCount: { type: "integer", minimum: 1 },
      outputCount: { type: "integer", minimum: 1 },
      scriptType: { $ref: "#/components/schemas/BitcoinScriptType" },
      feeRate: { type: "number", minimum: 0 },
    },
    required: ["inputCount", "outputCount", "feeRate"],
    additionalProperties: false,
  },
  EstimateFeeResponse: {
    type: "object",
    properties: {
      size: { type: "integer", minimum: 0 },
      fee: { type: "integer", minimum: 0 },
      feeRate: { type: "number", minimum: 0 },
    },
    required: ["size", "fee", "feeRate"],
  },
  EstimateOptimalFeeRequest: {
    type: "object",
    properties: {
      inputCount: { type: "integer", minimum: 1 },
      outputCount: { type: "integer", minimum: 1 },
      priority: { $ref: "#/components/schemas/BitcoinFeePriority" },
      scriptType: { $ref: "#/components/schemas/BitcoinScriptType" },
      network: {
        type: "string",
        enum: [...BITCOIN_NETWORKS],
        default: "mainnet",
      },
    },
    required: ["inputCount", "outputCount"],
    additionalProperties: false,
  },
  EstimateOptimalFeeResponse: {
    type: "object",
    properties: {
      fee: { type: "integer", minimum: 0 },
      feeRate: { type: "number", minimum: 0 },
      size: { type: "integer", minimum: 0 },
      confirmationTime: { type: "string" },
    },
    required: ["fee", "feeRate", "size", "confirmationTime"],
    additionalProperties: true,
  },
  AddressValidationRequest: {
    type: "object",
    properties: {
      address: { type: "string", minLength: 1 },
      network: {
        type: "string",
        enum: [...BITCOIN_NETWORKS],
        default: "mainnet",
      },
    },
    required: ["address"],
    additionalProperties: false,
  },
  AddressValidationResponse: {
    type: "object",
    properties: {
      valid: { type: "boolean" },
      error: { type: "string" },
      balance: { type: "number" },
      transactionCount: { type: "integer", minimum: 0 },
    },
    required: ["valid"],
    additionalProperties: true,
  },
  AddressInfoResponse: {
    type: "object",
    properties: {
      address: { type: "string" },
      balance: { type: "number" },
      transactionCount: { type: "integer", minimum: 0 },
      type: { type: "string" },
    },
    required: ["address", "balance", "transactionCount", "type"],
  },
  AddressSyncResponse: {
    $ref: "#/components/schemas/WalletSyncAdmissionResponse",
  },
  AddressLookupRequest: {
    type: "object",
    properties: {
      addresses: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: { type: "string", minLength: 1 },
      },
    },
    required: ["addresses"],
    additionalProperties: false,
  },
  AddressLookupResponse: {
    type: "object",
    properties: {
      lookup: {
        type: "object",
        additionalProperties: {
          type: "object",
          properties: {
            walletId: { type: "string" },
            walletName: { type: "string" },
          },
          required: ["walletId", "walletName"],
        },
      },
    },
    required: ["lookup"],
  },
  BroadcastRequest: {
    type: "object",
    properties: {
      rawTx: { type: "string", description: "Signed raw transaction hex." },
      network: {
        type: "string",
        enum: [...BITCOIN_NETWORKS],
        default: "mainnet",
      },
    },
    required: ["rawTx"],
    additionalProperties: false,
  },
  BroadcastResponse: {
    type: "object",
    properties: {
      txid: { type: "string" },
      broadcasted: { type: "boolean" },
    },
    required: ["txid", "broadcasted"],
    additionalProperties: true,
  },
  RbfCheckResponse: {
    type: "object",
    properties: {
      replaceable: { type: "boolean" },
      currentFeeRate: { type: "number" },
      minNewFeeRate: { type: "number" },
      reason: { type: "string" },
    },
    required: ["replaceable"],
    additionalProperties: true,
  },
  RbfCheckRequest: {
    type: "object",
    properties: {
      walletId: { type: "string" },
    },
    required: ["walletId"],
    additionalProperties: false,
  },
  RbfRequest: {
    type: "object",
    properties: {
      newFeeRate: {
        type: "number",
        minimum: MOBILE_API_REQUEST_LIMITS.minFeeRate,
        maximum: MOBILE_API_REQUEST_LIMITS.maxFeeRate,
      },
      walletId: { type: "string" },
    },
    required: ["newFeeRate", "walletId"],
    additionalProperties: false,
  },
  RbfResponse: {
    type: "object",
    properties: {
      psbtBase64: { type: "string" },
      signingContext: { $ref: "#/components/schemas/PsbtSigningContext" },
      intentId: { type: "string" },
      intentDigest: { type: "string", pattern: "^[0-9a-f]{64}$" },
      fee: { type: "integer", minimum: 0 },
      feeRate: { type: "number", minimum: 0 },
      feeDelta: { type: "integer" },
      inputs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
        },
      },
      outputs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
        },
      },
      inputPaths: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "psbtBase64",
      "signingContext",
      "intentId",
      "intentDigest",
      "fee",
      "feeRate",
      "feeDelta",
      "inputs",
      "outputs",
      "inputPaths",
    ],
  },
  CpfpRequest: {
    type: "object",
    properties: {
      parentTxid: { type: "string" },
      parentVout: { type: "integer", minimum: 0 },
      targetFeeRate: {
        type: "number",
        minimum: MOBILE_API_REQUEST_LIMITS.minFeeRate,
        maximum: MOBILE_API_REQUEST_LIMITS.maxFeeRate,
      },
      recipientAddress: { type: "string" },
      walletId: { type: "string" },
    },
    required: [
      "parentTxid",
      "parentVout",
      "targetFeeRate",
      "recipientAddress",
      "walletId",
    ],
    additionalProperties: false,
  },
  CpfpResponse: {
    type: "object",
    properties: {
      psbtBase64: { type: "string" },
      signingContext: { $ref: "#/components/schemas/PsbtSigningContext" },
      intentId: { type: "string" },
      intentDigest: { type: "string", pattern: "^[0-9a-f]{64}$" },
      childFee: { type: "integer", minimum: 0 },
      childFeeRate: { type: "number", minimum: 0 },
      parentFeeRate: { type: "number", minimum: 0 },
      effectiveFeeRate: { type: "number", minimum: 0 },
    },
    required: [
      "psbtBase64",
      "signingContext",
      "intentId",
      "intentDigest",
      "childFee",
      "childFeeRate",
      "parentFeeRate",
      "effectiveFeeRate",
    ],
  },
  BatchTransactionRecipient: {
    type: "object",
    properties: {
      address: { type: "string" },
      amount: { type: "number", minimum: 0 },
    },
    required: ["address", "amount"],
    additionalProperties: true,
  },
  BatchTransactionRequest: {
    type: "object",
    properties: {
      recipients: {
        type: "array",
        minItems: 1,
        items: { $ref: "#/components/schemas/BatchTransactionRecipient" },
      },
      feeRate: {
        type: "number",
        minimum: MOBILE_API_REQUEST_LIMITS.minFeeRate,
        maximum: MOBILE_API_REQUEST_LIMITS.maxFeeRate,
      },
      walletId: { type: "string" },
      selectedUtxoIds: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["recipients", "feeRate", "walletId"],
    additionalProperties: false,
  },
  BatchTransactionResponse: {
    type: "object",
    properties: {
      psbtBase64: { type: "string" },
      signingContext: { $ref: "#/components/schemas/PsbtSigningContext" },
      intentId: { type: "string" },
      intentDigest: { type: "string", pattern: "^[0-9a-f]{64}$" },
      fee: { type: "integer", minimum: 0 },
      totalInput: { type: "integer", minimum: 0 },
      totalOutput: { type: "integer", minimum: 0 },
      changeAmount: { type: "integer", minimum: 0 },
      savedFees: { type: "integer" },
      recipientCount: { type: "integer", minimum: 0 },
    },
    required: [
      "psbtBase64",
      "signingContext",
      "intentId",
      "intentDigest",
      "fee",
      "totalInput",
      "totalOutput",
      "changeAmount",
      "savedFees",
      "recipientCount",
    ],
  },
  NodeConnectionTestRequest: {
    type: "object",
    properties: {
      nodeType: { type: "string", enum: ["electrum"], default: "electrum" },
      host: { type: "string", minLength: 1 },
      port: {
        oneOf: [
          { type: "integer", minimum: 1, maximum: 65535 },
          { type: "string", minLength: 1 },
        ],
      },
      protocol: { type: "string", enum: ["tcp", "ssl"] },
      allowSelfSignedCertificate: { type: "boolean", default: false },
    },
    required: ["host", "port", "protocol"],
    additionalProperties: false,
  },
  NodeConnectionTestResponse: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      message: { type: "string" },
      serverInfo: {
        type: "object",
        additionalProperties: true,
      },
    },
    required: ["success", "message"],
  },
} as const;
