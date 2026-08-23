import { expect, it } from "vitest";
import { SYNC_PRIORITY_VALUES } from "@sanctuary/shared/constants/sync";

import {
  openApiSpec,
  browserOrBearerAuthSecurity,
  invokeRoute,
  expectDocumentedMethod,
  getOptionalProperty,
} from "./openapi.helpers";

import type { OpenApiPathKey } from "./openapi.helpers";

export function registerOpenApiCoreTests() {
  it("serves Swagger UI html", async () => {
    const response = await invokeRoute("GET", "/");

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["content-security-policy"]).toContain(
      "script-src 'self' 'unsafe-inline' https://unpkg.com",
    );
    expect(response.headers["content-security-policy"]).toContain(
      "style-src 'self' 'unsafe-inline' https://unpkg.com",
    );
    expect(String(response.body)).toContain("swagger-ui-bundle.js");
    expect(String(response.body)).toContain("/api/v1/docs/openapi.json");
  });

  it("serves OpenAPI spec json", async () => {
    const response = await invokeRoute("GET", "/openapi.json");

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-security-policy"]).toBeUndefined();
    const body = response.body as {
      openapi?: string;
      info?: { title?: string };
    };
    expect(body.openapi).toBe("3.0.3");
    expect(body.info?.title).toBe("Sanctuary API");
  });

  it("exports spec with core paths", () => {
    expect(openApiSpec.paths["/auth/login"]).toBeDefined();
    expect(openApiSpec.paths["/wallets"]).toBeDefined();
  });

  it("documents price routes including admin cache controls", () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ["/price", "get"],
      ["/price/multiple", "get"],
      ["/price/from/{provider}", "get"],
      ["/price/convert/to-fiat", "post"],
      ["/price/convert/to-sats", "post"],
      ["/price/currencies", "get"],
      ["/price/providers", "get"],
      ["/price/providers/status", "get"],
      ["/price/providers/test", "post"],
      ["/price/providers/{provider}/test", "post"],
      ["/price/health", "get"],
      ["/price/cache/stats", "get"],
      ["/price/cache/clear", "post"],
      ["/price/cache/duration", "post"],
      ["/price/historical", "get"],
      ["/price/history", "get"],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.paths["/price"].get.parameters).toContainEqual(
      expect.objectContaining({
        name: "useCache",
        schema: expect.objectContaining({ type: "boolean", default: true }),
      }),
    );
    expect(openApiSpec.components.schemas.Price.required).toEqual([
      "price",
      "currency",
      "sources",
      "median",
      "average",
      "timestamp",
      "cached",
    ]);
    expect(
      openApiSpec.components.schemas.Price.properties.sources.items,
    ).toEqual({
      $ref: "#/components/schemas/PriceSource",
    });
    expect(openApiSpec.components.schemas.PriceSource.required).toEqual([
      "provider",
      "price",
      "currency",
      "timestamp",
    ]);

    expect(openApiSpec.paths["/price/multiple"].get.parameters).toContainEqual(
      expect.objectContaining({
        name: "currencies",
        in: "query",
        required: true,
      }),
    );
    expect(
      openApiSpec.components.schemas.PriceMultipleResponse.additionalProperties,
    ).toEqual({
      $ref: "#/components/schemas/Price",
    });
    expect(
      openApiSpec.paths["/price/from/{provider}"].get.parameters,
    ).toContainEqual(
      expect.objectContaining({
        name: "provider",
        in: "path",
        required: true,
      }),
    );

    expect(
      openApiSpec.paths["/price/convert/to-fiat"].post.requestBody.content[
        "application/json"
      ].schema,
    ).toEqual({
      $ref: "#/components/schemas/PriceConvertToFiatRequest",
    });
    expect(
      openApiSpec.components.schemas.PriceConvertToFiatRequest.required,
    ).toEqual(["sats"]);
    expect(
      openApiSpec.components.schemas.PriceConvertToSatsRequest.required,
    ).toEqual(["amount"]);
    expect(
      openApiSpec.components.schemas.PriceCurrencyListResponse.required,
    ).toEqual(["currencies", "count"]);
    expect(
      openApiSpec.components.schemas.PriceProviderListResponse.required,
    ).toEqual(["providers", "count"]);
    expect(
      openApiSpec.components.schemas.PriceProviderDiagnosticsItem.required,
    ).toEqual(["name", "priority", "supportedCurrencies", "enabled"]);
    expect(
      openApiSpec.components.schemas.PriceProviderEnablementRequest.required,
    ).toEqual(["enabled"]);
    expect(
      openApiSpec.components.schemas.PriceProviderEnablementResponse.required,
    ).toEqual(["provider", "enabled", "providers", "count"]);
    expect(
      openApiSpec.components.schemas.PriceProviderTestResult.required,
    ).toEqual(["provider", "enabled", "ok", "currency", "latencyMs"]);
    expect(
      openApiSpec.paths["/price/providers/{provider}"].patch.parameters,
    ).toContainEqual(
      expect.objectContaining({
        name: "provider",
        in: "path",
        required: true,
      }),
    );
    expect(
      openApiSpec.paths["/price/providers/{provider}/test"].post.parameters,
    ).toContainEqual(
      expect.objectContaining({
        name: "provider",
        in: "path",
        required: true,
      }),
    );
    expect(openApiSpec.paths["/price/providers/status"].get.security).toEqual(
      browserOrBearerAuthSecurity,
    );
    expect(openApiSpec.paths["/price/providers/test"].post.security).toEqual(
      browserOrBearerAuthSecurity,
    );
    expect(
      openApiSpec.paths["/price/providers/{provider}"].patch.security,
    ).toEqual(browserOrBearerAuthSecurity);
    expect(
      openApiSpec.paths["/price/providers/{provider}/test"].post.security,
    ).toEqual(browserOrBearerAuthSecurity);
    expect(
      openApiSpec.paths["/price/providers/status"].get.responses,
    ).toHaveProperty("403");
    expect(
      openApiSpec.paths["/price/providers/test"].post.responses,
    ).toHaveProperty("403");
    expect(
      openApiSpec.paths["/price/providers/{provider}"].patch.responses,
    ).toHaveProperty("403");
    expect(
      openApiSpec.paths["/price/providers/{provider}/test"].post.responses,
    ).toHaveProperty("403");
    expect(
      openApiSpec.components.schemas.PriceHealthResponse.properties.providers
        .additionalProperties,
    ).toEqual({
      type: "boolean",
    });

    expect(openApiSpec.paths["/price/cache/stats"].get.security).toEqual(
      browserOrBearerAuthSecurity,
    );
    expect(openApiSpec.paths["/price/cache/clear"].post.security).toEqual(
      browserOrBearerAuthSecurity,
    );
    expect(openApiSpec.paths["/price/cache/duration"].post.security).toEqual(
      browserOrBearerAuthSecurity,
    );
    expect(
      openApiSpec.paths["/price/cache/stats"].get.responses,
    ).toHaveProperty("403");
    expect(openApiSpec.components.schemas.PriceCacheStats).toHaveProperty(
      "additionalProperties",
      true,
    );
    expect(openApiSpec.components.schemas.PriceCacheStats.required).toEqual([
      "size",
      "entries",
    ]);
    expect(
      openApiSpec.paths["/price/cache/duration"].post.requestBody.content[
        "application/json"
      ].schema,
    ).toEqual({
      $ref: "#/components/schemas/PriceCacheDurationRequest",
    });
    expect(
      openApiSpec.components.schemas.PriceCacheDurationRequest.required,
    ).toEqual(["duration"]);
    expect(
      openApiSpec.components.schemas.PriceCacheDurationRequest.properties
        .duration,
    ).toMatchObject({
      minimum: 0,
    });
    expect(
      openApiSpec.paths["/price/cache/duration"].post.responses[400].content[
        "application/json"
      ].schema,
    ).toEqual({
      $ref: "#/components/schemas/PriceSimpleErrorResponse",
    });

    expect(
      openApiSpec.paths["/price/historical"].get.parameters,
    ).toContainEqual(
      expect.objectContaining({
        name: "date",
        in: "query",
        required: true,
      }),
    );
    expect(openApiSpec.paths["/price/history"].get.parameters).toContainEqual(
      expect.objectContaining({
        name: "days",
        schema: expect.objectContaining({
          minimum: 1,
          maximum: 365,
          default: 30,
        }),
      }),
    );
    expect(
      openApiSpec.components.schemas.PriceHistoryResponse.properties.history
        .items,
    ).toEqual({
      $ref: "#/components/schemas/PriceHistoryPoint",
    });
  });

  it("documents broader Bitcoin utility and node routes", () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ["/bitcoin/status", "get"],
      ["/bitcoin/silent-payments/readiness", "get"],
      ["/bitcoin/mempool", "get"],
      ["/bitcoin/blocks/recent", "get"],
      ["/bitcoin/block/{height}", "get"],
      ["/bitcoin/fees", "get"],
      ["/bitcoin/fees/advanced", "get"],
      ["/bitcoin/utils/estimate-fee", "post"],
      ["/bitcoin/utils/estimate-optimal-fee", "post"],
      ["/bitcoin/address/validate", "post"],
      ["/bitcoin/address/{address}", "get"],
      ["/bitcoin/address/{addressId}/sync", "post"],
      ["/bitcoin/address-lookup", "post"],
      ["/bitcoin/transaction/{txid}", "get"],
      ["/bitcoin/broadcast", "post"],
      ["/bitcoin/transaction/{txid}/rbf-check", "post"],
      ["/bitcoin/transaction/{txid}/rbf", "post"],
      ["/bitcoin/transaction/cpfp", "post"],
      ["/bitcoin/transaction/batch", "post"],
      ["/bitcoin/wallet/{walletId}/sync", "post"],
      ["/bitcoin/wallet/{walletId}/update-confirmations", "post"],
      ["/node/test", "post"],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.tags).toContainEqual({
      name: "Node",
      description: "Bitcoin node connectivity checks",
    });
    expect(
      openApiSpec.paths["/bitcoin/silent-payments/readiness"].get.responses[200]
        .content["application/json"].schema,
    ).toEqual({
      $ref: "#/components/schemas/SilentPaymentReadiness",
    });
    expect(
      openApiSpec.components.schemas.SilentPaymentReadiness.required,
    ).toEqual([
      "featureEnabled",
      "ready",
      "network",
      "requiredFeatures",
      "blockers",
      "compatibleServerCount",
      "endpointCount",
      "featurePoolHealthy",
      "servers",
    ]);
    expect(
      openApiSpec.components.schemas.SilentPaymentServerReadiness.properties
        .serverUsage.enum,
    ).toEqual(["general", "silent_payments", "both"]);
    expect(
      openApiSpec.paths["/bitcoin/mempool"].get.responses[500].content[
        "application/json"
      ].schema,
    ).toEqual({
      $ref: "#/components/schemas/BitcoinSimpleErrorResponse",
    });
    expect(
      openApiSpec.components.schemas.BitcoinMempoolResponse.required,
    ).toEqual(["mempool", "blocks", "mempoolInfo"]);
    expect(
      openApiSpec.paths["/bitcoin/blocks/recent"].get.parameters,
    ).toContainEqual(
      expect.objectContaining({
        name: "count",
        schema: expect.objectContaining({
          minimum: 1,
          maximum: 100,
          default: 10,
        }),
      }),
    );
    expect(
      openApiSpec.paths["/bitcoin/block/{height}"].get.parameters,
    ).toContainEqual(
      expect.objectContaining({
        name: "height",
        in: "path",
        required: true,
        schema: expect.objectContaining({ minimum: 0 }),
      }),
    );

    expect(
      openApiSpec.components.schemas.AdvancedFeeEstimates.required,
    ).toEqual(["fastest", "fast", "medium", "slow", "minimum"]);
    expect(openApiSpec.components.schemas.BitcoinScriptType.enum).toEqual([
      "legacy",
      "nested_segwit",
      "native_segwit",
      "taproot",
    ]);
    expect(openApiSpec.components.schemas.BitcoinFeePriority.enum).toEqual([
      "fastest",
      "fast",
      "medium",
      "slow",
      "minimum",
    ]);
    expect(openApiSpec.components.schemas.EstimateFeeRequest.required).toEqual([
      "inputCount",
      "outputCount",
      "feeRate",
    ]);
    expect(
      openApiSpec.components.schemas.EstimateOptimalFeeRequest.required,
    ).toEqual(["inputCount", "outputCount"]);

    expect(
      openApiSpec.components.schemas.AddressValidationRequest.required,
    ).toEqual(["address"]);
    expect(
      openApiSpec.components.schemas.AddressValidationRequest.properties
        .network,
    ).toMatchObject({
      enum: ["mainnet", "testnet3", "testnet4", "signet", "regtest"],
      default: "mainnet",
    });
    expect(
      openApiSpec.components.schemas.AddressLookupRequest.properties.addresses,
    ).toMatchObject({
      minItems: 1,
      maxItems: 100,
    });
    expect(
      openApiSpec.paths["/bitcoin/address/{addressId}/sync"].post.security,
    ).toEqual(browserOrBearerAuthSecurity);
    expect(
      openApiSpec.paths["/bitcoin/address-lookup"].post.requestBody.content[
        "application/json"
      ].schema,
    ).toEqual({
      $ref: "#/components/schemas/AddressLookupRequest",
    });

    expect(openApiSpec.components.schemas.BroadcastRequest.required).toEqual([
      "rawTx",
    ]);
    expect(
      openApiSpec.components.schemas.BroadcastRequest.properties,
    ).not.toHaveProperty("hex");
    expect(
      openApiSpec.components.schemas.BroadcastRequest.properties,
    ).not.toHaveProperty("walletId");
    expect(openApiSpec.components.schemas.BroadcastResponse.required).toEqual([
      "txid",
      "broadcasted",
    ]);
    expect(
      openApiSpec.components.schemas.BroadcastResponse.properties,
    ).not.toHaveProperty("success");
    expect(openApiSpec.components.schemas.RbfCheckResponse.required).toEqual([
      "replaceable",
    ]);
    expect(
      openApiSpec.components.schemas.RbfCheckResponse.properties,
    ).toHaveProperty("minNewFeeRate");
    expect(
      openApiSpec.components.schemas.RbfCheckResponse.properties,
    ).not.toHaveProperty("canReplace");
    expect(openApiSpec.components.schemas.RbfCheckRequest.required).toEqual([
      "walletId",
    ]);
    expect(
      openApiSpec.components.schemas.RbfCheckRequest.properties,
    ).not.toHaveProperty("network");
    expect(openApiSpec.components.schemas.RbfRequest.required).toEqual([
      "newFeeRate",
      "walletId",
    ]);
    expect(openApiSpec.components.schemas.CpfpRequest.required).toEqual([
      "parentTxid",
      "parentVout",
      "targetFeeRate",
      "recipientAddress",
      "walletId",
    ]);
    expect(
      openApiSpec.components.schemas.BatchTransactionRequest.required,
    ).toEqual(["recipients", "feeRate", "walletId"]);
    expect(
      openApiSpec.components.schemas.BatchTransactionRequest.properties
        .recipients,
    ).toMatchObject({
      minItems: 1,
    });
    expect(
      openApiSpec.components.schemas.BitcoinLegacyWalletSyncResponse.$ref,
    ).toBe("#/components/schemas/WalletSyncAdmissionResponse");
    expect(openApiSpec.components.schemas.AddressSyncResponse.$ref).toBe(
      "#/components/schemas/WalletSyncAdmissionResponse",
    );
    expect(
      openApiSpec.components.schemas.BitcoinUpdateConfirmationsResponse
        .required,
    ).toEqual(["message", "updated"]);
    expect(
      openApiSpec.components.schemas.BitcoinUpdateConfirmationsResponse
        .properties.updated,
    ).toMatchObject({
      type: "array",
    });
    expect(
      openApiSpec.components.schemas.RbfResponse.properties.inputPaths.items,
    ).toEqual({ type: "string" });

    expect(openApiSpec.paths["/node/test"].post.security).toEqual(
      browserOrBearerAuthSecurity,
    );
    expect(openApiSpec.paths["/node/test"].post.description).toContain(
      "Admin-only",
    );
    expect(openApiSpec.paths["/node/test"].post.responses).toHaveProperty("403");
    expect(
      openApiSpec.components.schemas.NodeConnectionTestRequest.required,
    ).toEqual(["host", "port", "protocol"]);
    expect(
      openApiSpec.components.schemas.NodeConnectionTestRequest.properties
        .nodeType,
    ).toMatchObject({
      enum: ["electrum"],
      default: "electrum",
    });
    expect(
      openApiSpec.components.schemas.NodeConnectionTestRequest.properties
        .protocol.enum,
    ).toEqual(["tcp", "ssl"]);
    expect(
      openApiSpec.components.schemas.NodeConnectionTestRequest.properties
        .allowSelfSignedCertificate,
    ).toMatchObject({
      type: "boolean",
      default: false,
    });
    expect(
      openApiSpec.components.schemas.NodeConnectionTestRequest.properties.port
        .oneOf,
    ).toContainEqual({
      type: "integer",
      minimum: 1,
      maximum: 65535,
    });
  });

  it("documents sync management routes beyond gateway wallet sync", () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ["/sync/wallet/{walletId}", "post"],
      ["/sync/queue/{walletId}", "post"],
      ["/sync/status/{walletId}", "get"],
      ["/sync/logs/{walletId}", "get"],
      ["/sync/user", "post"],
      ["/sync/reset/{walletId}", "post"],
      ["/sync/resync/{walletId}", "post"],
      ["/sync/network/{network}", "post"],
      ["/sync/network/{network}/resync", "post"],
      ["/sync/network/{network}/status", "get"],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
    }

    expect(openApiSpec.components.schemas.SyncPriority.enum).toEqual([
      ...SYNC_PRIORITY_VALUES,
    ]);
    expect(
      openApiSpec.components.schemas.SyncPriorityRequest.additionalProperties,
    ).toBe(false);
    expect(
      openApiSpec.components.schemas.WalletSyncAdmissionResponse.required,
    ).toEqual(["success", "status", "generation", "wakeup", "message"]);
    expect(
      openApiSpec.components.schemas.WalletSyncAdmissionResponse.properties.status,
    ).toEqual({ type: "string", enum: ["requested", "merged"] });
    expect(
      openApiSpec.components.schemas.WalletSyncWakeupDisposition.enum,
    ).toEqual([
      "deferred_action_required",
      "deferred_full_resync",
      "deferred_retry",
      "enqueued",
      "unavailable",
    ]);
    expect(openApiSpec.components.schemas.SyncResult.$ref).toBe(
      "#/components/schemas/WalletSyncAdmissionResponse",
    );
    expect(
      openApiSpec.paths["/sync/wallet/{walletId}"].post.responses[200].content[
        "application/json"
      ].schema,
    ).toEqual({ $ref: "#/components/schemas/SyncResult" });
    expect(
      openApiSpec.paths["/bitcoin/wallet/{walletId}/sync"].post.responses[200]
        .content["application/json"].schema,
    ).toEqual({ $ref: "#/components/schemas/BitcoinLegacyWalletSyncResponse" });
    expect(
      openApiSpec.paths["/bitcoin/address/{addressId}/sync"].post.responses[200]
        .content["application/json"].schema,
    ).toEqual({ $ref: "#/components/schemas/AddressSyncResponse" });
    for (const path of [
      "/sync/wallet/{walletId}",
      "/sync/queue/{walletId}",
      "/bitcoin/wallet/{walletId}/sync",
      "/bitcoin/address/{addressId}/sync",
    ] as const) {
      expect(openApiSpec.paths[path].post.responses).toHaveProperty("503");
    }
    expect(
      openApiSpec.paths["/sync/queue/{walletId}"].post.requestBody,
    ).toMatchObject({
      required: false,
    });
    expect(
      openApiSpec.paths["/sync/queue/{walletId}"].post.requestBody.content[
        "application/json"
      ].schema,
    ).toEqual({
      $ref: "#/components/schemas/SyncPriorityRequest",
    });
    expect(openApiSpec.components.schemas.QueuedWalletSyncResponse.$ref).toBe(
      "#/components/schemas/WalletSyncAdmissionResponse",
    );
    expect(
      openApiSpec.paths["/sync/user"].post.responses[200].content[
        "application/json"
      ].schema,
    ).toEqual({ $ref: "#/components/schemas/WalletSyncBatchResponse" });
    expect(openApiSpec.components.schemas.WalletSyncBatchResponse.required).toEqual([
      "success",
      "requested",
      "merged",
      "rejected",
      "indeterminate",
      "outcomes",
    ]);
    expect(
      openApiSpec.components.schemas.WalletSyncBatchResponse.properties.outcomes.items,
    ).toEqual({ $ref: "#/components/schemas/WalletSyncBatchOutcome" });
    expect(openApiSpec.components.schemas.WalletSyncStatus.required).toEqual([
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
      "requestedIncrementalSyncGeneration",
      "claimedIncrementalSyncGeneration",
      "processedIncrementalSyncGeneration",
      "incrementalSyncClaimedAt",
      "incrementalSyncLeaseExpiresAt",
      "syncActionRequiredAt",
      "requestedFullResyncGeneration",
      "preparedFullResyncGeneration",
      "processedFullResyncGeneration",
    ]);
    expect(openApiSpec.components.schemas.WalletSyncStatus.properties).toMatchObject({
      executionOwner: {
        enum: ["inline", "worker"],
        nullable: true,
      },
      retryCount: { minimum: 0 },
      nextRetryAt: { format: "date-time", nullable: true },
      startedAt: { format: "date-time", nullable: true },
      stateVersion: { minimum: 0 },
      requestedIncrementalSyncGeneration: { minimum: 0 },
      claimedIncrementalSyncGeneration: { minimum: 0 },
      processedIncrementalSyncGeneration: { minimum: 0 },
      incrementalSyncClaimedAt: { format: "date-time", nullable: true },
      incrementalSyncLeaseExpiresAt: { format: "date-time", nullable: true },
      syncActionRequiredAt: { format: "date-time", nullable: true },
      requestedFullResyncGeneration: { minimum: 0 },
      preparedFullResyncGeneration: { minimum: 0 },
      processedFullResyncGeneration: { minimum: 0 },
    });
    expect(
      openApiSpec.components.schemas.WalletSyncLogsResponse.required,
    ).toEqual(["logs"]);
    expect(
      openApiSpec.components.schemas.ResyncWalletResponse.required,
    ).toEqual([
      "success", "message", "status", "walletId",
      "generation", "incrementalGeneration", "wakeup",
    ]);
    expect(
      openApiSpec.paths["/sync/resync/{walletId}"].post.responses[503].content[
        "application/json"
      ].schema,
    ).toEqual({ $ref: "#/components/schemas/FullResyncUnavailableResponse" });
    expect(
      openApiSpec.paths["/sync/network/{network}/resync"].post.responses[503].content[
        "application/json"
      ].schema,
    ).toEqual({ $ref: "#/components/schemas/FullResyncUnavailableResponse" });
    expect(
      openApiSpec.components.schemas.FullResyncUnavailableResponse.allOf[1]
        .properties.details.properties.outcomes.items,
    ).toEqual({ $ref: "#/components/schemas/FullResyncEnqueueOutcome" });
    expect(
      openApiSpec.components.schemas.FullResyncEnqueueOutcome.oneOf,
    ).toContainEqual(expect.objectContaining({
      properties: expect.objectContaining({
        status: { type: "string", enum: ["indeterminate"] },
        reason: { type: "string", enum: ["queue_state_unknown"] },
      }),
    }));
    expect(
      openApiSpec.paths["/sync/resync/{walletId}"].post.description,
    ).toContain("after exclusive sync ownership");
    expect(openApiSpec.components.schemas.NetworkSyncResponse.required).toEqual(
      [
        "success",
        "requested",
        "merged",
        "rejected",
        "indeterminate",
        "walletIds",
        "outcomes",
      ],
    );
    expect(
      openApiSpec.components.schemas.NetworkSyncResponse.properties.outcomes.items,
    ).toEqual({ $ref: "#/components/schemas/WalletSyncBatchOutcome" });
    expect(
      openApiSpec.components.schemas.NetworkResyncResponse.allOf,
    ).toContainEqual({
      $ref: "#/components/schemas/NetworkResyncBaseResponse",
    });
    expect(openApiSpec.components.schemas.NetworkResyncBaseResponse.required).toEqual([
      "success",
      "queued",
      "walletIds",
    ]);
    expect(
      openApiSpec.components.schemas.NetworkResyncResponse.allOf[1].required,
    ).toContain("indeterminateWallets");
    expect(
      openApiSpec.components.schemas.NetworkResyncResponse.allOf[1].required,
    ).toContain("deferredWalletIds");
    expect(
      openApiSpec.components.schemas.NetworkSyncStatusResponse.properties
        .network.enum,
    ).toEqual(["mainnet", "testnet3", "testnet4", "signet"]);
    expect(
      openApiSpec.paths["/sync/network/{network}"].post.parameters,
    ).toContainEqual(
      expect.objectContaining({
        name: "network",
        in: "path",
        schema: expect.objectContaining({
          enum: ["mainnet", "testnet3", "testnet4", "signet"],
        }),
      }),
    );
    expect(
      openApiSpec.paths["/sync/network/{network}/resync"].post.parameters,
    ).toContainEqual(
      expect.objectContaining({
        name: "X-Confirm-Resync",
        in: "header",
        required: true,
        schema: expect.objectContaining({ enum: ["true"] }),
      }),
    );
  });
}

export function registerOpenApiHealthTests() {
  it("documents API health and readiness routes", () => {
    const routes: Array<[OpenApiPathKey, string]> = [
      ["/health", "get"],
      ["/health/live", "get"],
      ["/health/ready", "get"],
      ["/health/circuits", "get"],
    ];

    for (const [path, method] of routes) {
      expectDocumentedMethod(path, method);
      expect(getOptionalProperty(openApiSpec.paths[path], method)).not.toHaveProperty("security");
    }

    expect(openApiSpec.components.schemas.HealthStatus.enum).toEqual([
      "healthy",
      "degraded",
      "unhealthy",
    ]);
    expect(
      openApiSpec.paths["/health"].get.responses[200].content[
        "application/json"
      ].schema,
    ).toEqual({
      $ref: "#/components/schemas/HealthResponse",
    });
    expect(
      openApiSpec.paths["/health"].get.responses[503].content[
        "application/json"
      ].schema,
    ).toEqual({
      $ref: "#/components/schemas/HealthResponse",
    });
    expect(openApiSpec.components.schemas.HealthResponse.required).toEqual([
      "status",
      "timestamp",
      "uptime",
      "version",
      "components",
    ]);
    expect(
      openApiSpec.components.schemas.HealthResponse.properties.components
        .required,
    ).toEqual([
      "database",
      "redis",
      "electrum",
      "websocket",
      "sync",
      "jobQueue",
      "cacheInvalidation",
      "startup",
      "circuitBreakers",
      "memory",
      "disk",
    ]);
    expect(
      openApiSpec.components.schemas.HealthLiveResponse.properties.status.enum,
    ).toEqual(["alive"]);
    expect(
      openApiSpec.components.schemas.HealthReadyResponse.properties.status.enum,
    ).toEqual(["ready", "not ready"]);
    expect(
      openApiSpec.paths["/health/ready"].get.responses[503].content[
        "application/json"
      ].schema,
    ).toEqual({
      $ref: "#/components/schemas/HealthReadyResponse",
    });
    expect(
      openApiSpec.components.schemas.CircuitBreakerHealth.properties.state.enum,
    ).toEqual(["closed", "open", "half-open"]);
    expect(
      openApiSpec.components.schemas.HealthCircuitsResponse.required,
    ).toEqual(["overall", "circuits"]);
  });
}
