import { BITCOIN_NETWORKS } from "@sanctuary/shared/constants/bitcoin";

export { syncSchemas } from "./bitcoinSync";
export { priceSchemas } from "./price";

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
      explorerUrl: { type: "string" },
      confirmationThreshold: { type: "integer" },
      deepConfirmationThreshold: { type: "integer" },
      error: { type: "string" },
      pool: {
        type: "object",
        nullable: true,
        additionalProperties: true,
      },
    },
    required: ["connected"],
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
    enum: ["legacy", "nested_segwit", "native_segwit", "taproot"],
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
    type: "object",
    properties: {
      message: { type: "string" },
    },
    required: ["message"],
    additionalProperties: true,
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
      network: {
        type: "string",
        enum: [...BITCOIN_NETWORKS],
        default: "mainnet",
      },
    },
    additionalProperties: false,
  },
  RbfRequest: {
    type: "object",
    properties: {
      newFeeRate: { type: "number", minimum: 0 },
      walletId: { type: "string" },
    },
    required: ["newFeeRate", "walletId"],
    additionalProperties: false,
  },
  RbfResponse: {
    type: "object",
    properties: {
      psbtBase64: { type: "string" },
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
      targetFeeRate: { type: "number", minimum: 0 },
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
      childFee: { type: "integer", minimum: 0 },
      childFeeRate: { type: "number", minimum: 0 },
      parentFeeRate: { type: "number", minimum: 0 },
      effectiveFeeRate: { type: "number", minimum: 0 },
    },
    required: [
      "psbtBase64",
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
      feeRate: { type: "number", minimum: 0 },
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
      fee: { type: "integer", minimum: 0 },
      totalInput: { type: "integer", minimum: 0 },
      totalOutput: { type: "integer", minimum: 0 },
      changeAmount: { type: "integer", minimum: 0 },
      savedFees: { type: "integer" },
      recipientCount: { type: "integer", minimum: 0 },
    },
    required: [
      "psbtBase64",
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
