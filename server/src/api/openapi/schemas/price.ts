export const priceSchemas = {
  PriceSource: {
    type: "object",
    properties: {
      provider: { type: "string" },
      price: { type: "number" },
      currency: { type: "string" },
      timestamp: { type: "string", format: "date-time" },
      change24h: { type: "number" },
    },
    required: ["provider", "price", "currency", "timestamp"],
  },
  Price: {
    type: "object",
    properties: {
      price: { type: "number" },
      currency: { type: "string" },
      sources: {
        type: "array",
        items: { $ref: "#/components/schemas/PriceSource" },
      },
      median: { type: "number" },
      average: { type: "number" },
      timestamp: { type: "string", format: "date-time" },
      cached: { type: "boolean" },
      stale: { type: "boolean" },
      change24h: { type: "number" },
    },
    required: [
      "price",
      "currency",
      "sources",
      "median",
      "average",
      "timestamp",
      "cached",
    ],
  },
  PriceMultipleResponse: {
    type: "object",
    additionalProperties: { $ref: "#/components/schemas/Price" },
  },
  PriceConvertToFiatRequest: {
    type: "object",
    properties: {
      sats: { type: "number" },
      currency: { type: "string", default: "USD" },
    },
    required: ["sats"],
    additionalProperties: false,
  },
  PriceConvertToFiatResponse: {
    type: "object",
    properties: {
      sats: { type: "number" },
      fiatAmount: { type: "number" },
      currency: { type: "string" },
    },
    required: ["sats", "fiatAmount", "currency"],
  },
  PriceConvertToSatsRequest: {
    type: "object",
    properties: {
      amount: { type: "number" },
      currency: { type: "string", default: "USD" },
    },
    required: ["amount"],
    additionalProperties: false,
  },
  PriceConvertToSatsResponse: {
    type: "object",
    properties: {
      amount: { type: "number" },
      currency: { type: "string" },
      sats: { type: "integer" },
    },
    required: ["amount", "currency", "sats"],
  },
  PriceCurrencyListResponse: {
    type: "object",
    properties: {
      currencies: {
        type: "array",
        items: { type: "string" },
      },
      count: { type: "integer", minimum: 0 },
    },
    required: ["currencies", "count"],
  },
  PriceProviderListResponse: {
    type: "object",
    properties: {
      providers: {
        type: "array",
        items: { type: "string" },
      },
      count: { type: "integer", minimum: 0 },
    },
    required: ["providers", "count"],
  },
  PriceProviderDiagnosticsItem: {
    type: "object",
    properties: {
      name: { type: "string" },
      priority: { type: "integer" },
      supportedCurrencies: {
        type: "array",
        items: { type: "string" },
      },
      enabled: { type: "boolean" },
    },
    required: ["name", "priority", "supportedCurrencies", "enabled"],
  },
  PriceProviderDiagnosticsResponse: {
    type: "object",
    properties: {
      providers: {
        type: "array",
        items: { $ref: "#/components/schemas/PriceProviderDiagnosticsItem" },
      },
      count: { type: "integer", minimum: 0 },
    },
    required: ["providers", "count"],
  },
  PriceProviderEnablementRequest: {
    type: "object",
    properties: {
      enabled: { type: "boolean" },
    },
    required: ["enabled"],
    additionalProperties: false,
  },
  PriceProviderEnablementResponse: {
    type: "object",
    properties: {
      provider: { type: "string" },
      enabled: { type: "boolean" },
      providers: {
        type: "array",
        items: { $ref: "#/components/schemas/PriceProviderDiagnosticsItem" },
      },
      count: { type: "integer", minimum: 0 },
    },
    required: ["provider", "enabled", "providers", "count"],
  },
  PriceProviderTestRequest: {
    type: "object",
    properties: {
      currency: { type: "string", default: "USD" },
    },
    additionalProperties: false,
  },
  PriceProviderTestResult: {
    type: "object",
    properties: {
      provider: { type: "string" },
      enabled: { type: "boolean" },
      ok: { type: "boolean" },
      currency: { type: "string" },
      latencyMs: { type: "integer", minimum: 0 },
      price: { type: "number" },
      timestamp: { type: "string", format: "date-time" },
      error: { type: "string" },
    },
    required: ["provider", "enabled", "ok", "currency", "latencyMs"],
  },
  PriceProviderTestAllResponse: {
    type: "object",
    properties: {
      currency: { type: "string" },
      providers: {
        type: "array",
        items: { $ref: "#/components/schemas/PriceProviderTestResult" },
      },
    },
    required: ["currency", "providers"],
  },
  PriceHealthResponse: {
    type: "object",
    properties: {
      healthy: { type: "boolean" },
      providers: {
        type: "object",
        additionalProperties: { type: "boolean" },
      },
    },
    required: ["healthy", "providers"],
  },
  PriceCacheStats: {
    type: "object",
    properties: {
      size: { type: "integer", minimum: 0 },
      entries: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["size", "entries"],
    additionalProperties: true,
  },
  PriceCacheClearResponse: {
    type: "object",
    properties: {
      message: { type: "string" },
    },
    required: ["message"],
  },
  PriceCacheDurationRequest: {
    type: "object",
    properties: {
      duration: {
        type: "number",
        minimum: 0,
        description: "Cache duration in milliseconds.",
      },
    },
    required: ["duration"],
    additionalProperties: false,
  },
  PriceCacheDurationResponse: {
    type: "object",
    properties: {
      message: { type: "string" },
      duration: { type: "number", minimum: 0 },
    },
    required: ["message", "duration"],
  },
  PriceSimpleErrorResponse: {
    type: "object",
    properties: {
      error: { type: "string" },
      message: { type: "string" },
    },
    required: ["error", "message"],
  },
  PriceHistoricalResponse: {
    type: "object",
    properties: {
      date: { type: "string", format: "date-time" },
      currency: { type: "string" },
      price: { type: "number" },
      provider: { type: "string" },
    },
    required: ["date", "currency", "price", "provider"],
  },
  PriceHistoryPoint: {
    type: "object",
    properties: {
      timestamp: { type: "string", format: "date-time" },
      price: { type: "number" },
    },
    required: ["timestamp", "price"],
  },
  PriceHistoryResponse: {
    type: "object",
    properties: {
      currency: { type: "string" },
      days: { type: "integer", minimum: 1, maximum: 365 },
      dataPoints: { type: "integer", minimum: 0 },
      history: {
        type: "array",
        items: { $ref: "#/components/schemas/PriceHistoryPoint" },
      },
      provider: { type: "string" },
    },
    required: ["currency", "days", "dataPoints", "history", "provider"],
  },
} as const;
