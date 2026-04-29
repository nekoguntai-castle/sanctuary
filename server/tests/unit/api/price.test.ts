/**
 * Tests for price.ts API routes
 * Tests Bitcoin price data endpoints
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express, { Express } from "express";
import request from "supertest";

// Mock JWT verification
vi.mock("jsonwebtoken", () => ({
  default: {
    verify: vi.fn((token: string) => {
      if (token === "admin-token") {
        return {
          userId: "admin-1",
          username: "admin",
          type: "access",
          isAdmin: true,
        };
      }
      if (token === "user-token") {
        return {
          userId: "user-1",
          username: "user",
          type: "access",
          isAdmin: false,
        };
      }
      throw new Error("Invalid token");
    }),
  },
}));

// Mock prisma for admin check
vi.mock("../../../src/models/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn().mockImplementation(({ where }) => {
        if (where.id === "admin-1") {
          return Promise.resolve({ id: "admin-1", role: "admin" });
        }
        if (where.id === "user-1") {
          return Promise.resolve({ id: "user-1", role: "user" });
        }
        return Promise.resolve(null);
      }),
    },
  },
}));

// Use vi.hoisted() to define mocks before vi.mock hoisting
const { mockPriceService } = vi.hoisted(() => ({
  mockPriceService: {
    getPrice: vi.fn(),
    getPrices: vi.fn(),
    getPriceFrom: vi.fn(),
    convertToFiat: vi.fn(),
    convertToSats: vi.fn(),
    getSupportedCurrencies: vi.fn(),
    getProviders: vi.fn(),
    getProviderDiagnostics: vi.fn(),
    testProvider: vi.fn(),
    testAllProviders: vi.fn(),
    healthCheck: vi.fn(),
    getCacheStats: vi.fn(),
    clearCache: vi.fn(),
    setCacheDuration: vi.fn(),
    getHistoricalPrice: vi.fn(),
    getPriceHistory: vi.fn(),
  },
}));

vi.mock("../../../src/services/price", () => ({
  getPriceService: () => mockPriceService,
}));

// Mock logger
vi.mock("../../../src/utils/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock requestContext (needed by errorHandler and auth middleware)
vi.mock("../../../src/utils/requestContext", () => ({
  requestContext: {
    getRequestId: () => "test-request-id",
    setUser: vi.fn(),
    get: () => undefined,
    run: (_ctx: unknown, fn: () => unknown) => fn(),
    getUserId: () => undefined,
    getTraceId: () => undefined,
    setTraceId: vi.fn(),
    getDuration: () => 0,
    generateRequestId: () => "test-request-id",
  },
}));

// Import router after mocks
import priceRouter from "../../../src/api/price";
import { errorHandler } from "../../../src/errors/errorHandler";

describe("Price API Routes", () => {
  let app: Express;

  const mockPriceData = {
    price: 45000,
    currency: "USD",
    timestamp: new Date().toISOString(),
    provider: "coinbase",
  };

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use("/api/v1/price", priceRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPriceService.getSupportedCurrencies.mockReturnValue([
      "USD",
      "EUR",
      "GBP",
      "JPY",
    ]);
    mockPriceService.getProviders.mockReturnValue([
      "coinbase",
      "binance",
      "kraken",
    ]);
    mockPriceService.getProviderDiagnostics.mockReturnValue([
      {
        name: "coinbase",
        priority: 70,
        supportedCurrencies: ["USD", "EUR", "GBP", "CAD"],
        enabled: true,
      },
      {
        name: "binance",
        priority: 60,
        supportedCurrencies: ["USD", "EUR", "GBP"],
        enabled: false,
      },
    ]);
  });

  // ========================================
  // PUBLIC PRICE ENDPOINTS
  // ========================================

  describe("GET /", () => {
    it("should return current price", async () => {
      mockPriceService.getPrice.mockResolvedValue(mockPriceData);

      const response = await request(app).get("/api/v1/price");

      expect(response.status).toBe(200);
      expect(response.body.price).toBe(45000);
      expect(mockPriceService.getPrice).toHaveBeenCalledWith("USD", true);
    });

    it("should accept currency parameter", async () => {
      mockPriceService.getPrice.mockResolvedValue({
        ...mockPriceData,
        currency: "EUR",
        price: 42000,
      });

      const response = await request(app).get("/api/v1/price?currency=EUR");

      expect(response.status).toBe(200);
      expect(response.body.currency).toBe("EUR");
      expect(mockPriceService.getPrice).toHaveBeenCalledWith("EUR", true);
    });

    it("should accept useCache=false parameter", async () => {
      mockPriceService.getPrice.mockResolvedValue(mockPriceData);

      const response = await request(app).get("/api/v1/price?useCache=false");

      expect(response.status).toBe(200);
      expect(mockPriceService.getPrice).toHaveBeenCalledWith("USD", false);
    });

    it("should return 500 on error", async () => {
      mockPriceService.getPrice.mockRejectedValue(
        new Error("Provider unavailable"),
      );

      const response = await request(app).get("/api/v1/price");

      expect(response.status).toBe(500);
      expect(response.body.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("GET /multiple", () => {
    it("should return prices for multiple currencies", async () => {
      mockPriceService.getPrices.mockResolvedValue({
        USD: 45000,
        EUR: 42000,
        GBP: 38000,
      });

      const response = await request(app).get(
        "/api/v1/price/multiple?currencies=USD,EUR,GBP",
      );

      expect(response.status).toBe(200);
      expect(response.body.USD).toBe(45000);
      expect(mockPriceService.getPrices).toHaveBeenCalledWith([
        "USD",
        "EUR",
        "GBP",
      ]);
    });

    it("should return 400 without currencies parameter", async () => {
      const response = await request(app).get("/api/v1/price/multiple");

      expect(response.status).toBe(400);
      expect(response.body.message).toContain(
        "currencies parameter is required",
      );
    });

    it("should return 500 on internal error", async () => {
      mockPriceService.getPrices.mockRejectedValue(
        new Error("Service unavailable"),
      );

      const response = await request(app).get(
        "/api/v1/price/multiple?currencies=USD",
      );

      expect(response.status).toBe(500);
    });
  });

  describe("GET /from/:provider", () => {
    it("should return price from specific provider", async () => {
      mockPriceService.getPriceFrom.mockResolvedValue({
        ...mockPriceData,
        provider: "binance",
      });

      const response = await request(app).get("/api/v1/price/from/binance");

      expect(response.status).toBe(200);
      expect(response.body.provider).toBe("binance");
      expect(mockPriceService.getPriceFrom).toHaveBeenCalledWith(
        "binance",
        "USD",
      );
    });

    it("should accept currency parameter", async () => {
      mockPriceService.getPriceFrom.mockResolvedValue({
        ...mockPriceData,
        provider: "kraken",
        currency: "EUR",
      });

      const response = await request(app).get(
        "/api/v1/price/from/kraken?currency=EUR",
      );

      expect(response.status).toBe(200);
      expect(mockPriceService.getPriceFrom).toHaveBeenCalledWith(
        "kraken",
        "EUR",
      );
    });

    it("should return 500 on invalid provider", async () => {
      mockPriceService.getPriceFrom.mockRejectedValue(
        new Error("Unknown provider"),
      );

      const response = await request(app).get("/api/v1/price/from/invalid");

      expect(response.status).toBe(500);
    });
  });

  // ========================================
  // CONVERSION ENDPOINTS
  // ========================================

  describe("POST /convert/to-fiat", () => {
    it("should convert satoshis to fiat", async () => {
      mockPriceService.convertToFiat.mockResolvedValue(45);

      const response = await request(app)
        .post("/api/v1/price/convert/to-fiat")
        .send({ sats: 100000, currency: "USD" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        sats: 100000,
        fiatAmount: 45,
        currency: "USD",
      });
      expect(mockPriceService.convertToFiat).toHaveBeenCalledWith(
        100000,
        "USD",
      );
    });

    it("should use USD as default currency", async () => {
      mockPriceService.convertToFiat.mockResolvedValue(45);

      const response = await request(app)
        .post("/api/v1/price/convert/to-fiat")
        .send({ sats: 100000 });

      expect(response.status).toBe(200);
      expect(mockPriceService.convertToFiat).toHaveBeenCalledWith(
        100000,
        "USD",
      );
    });

    it("should return 400 when sats is not a number", async () => {
      const response = await request(app)
        .post("/api/v1/price/convert/to-fiat")
        .send({ sats: "invalid" });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("sats must be a number");
    });

    it("should return 500 on conversion error", async () => {
      mockPriceService.convertToFiat.mockRejectedValue(
        new Error("Conversion failed"),
      );

      const response = await request(app)
        .post("/api/v1/price/convert/to-fiat")
        .send({ sats: 100000 });

      expect(response.status).toBe(500);
    });
  });

  describe("POST /convert/to-sats", () => {
    it("should convert fiat to satoshis", async () => {
      mockPriceService.convertToSats.mockResolvedValue(100000);

      const response = await request(app)
        .post("/api/v1/price/convert/to-sats")
        .send({ amount: 45, currency: "USD" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        amount: 45,
        currency: "USD",
        sats: 100000,
      });
      expect(mockPriceService.convertToSats).toHaveBeenCalledWith(45, "USD");
    });

    it("should use USD as default currency", async () => {
      mockPriceService.convertToSats.mockResolvedValue(100000);

      const response = await request(app)
        .post("/api/v1/price/convert/to-sats")
        .send({ amount: 45 });

      expect(response.status).toBe(200);
      expect(mockPriceService.convertToSats).toHaveBeenCalledWith(45, "USD");
    });

    it("should return 400 when amount is not a number", async () => {
      const response = await request(app)
        .post("/api/v1/price/convert/to-sats")
        .send({ amount: "invalid" });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("amount must be a number");
    });

    it("should return 500 on conversion error", async () => {
      mockPriceService.convertToSats.mockRejectedValue(
        new Error("Conversion failed"),
      );

      const response = await request(app)
        .post("/api/v1/price/convert/to-sats")
        .send({ amount: 45 });

      expect(response.status).toBe(500);
    });
  });

  // ========================================
  // INFO ENDPOINTS
  // ========================================

  describe("GET /currencies", () => {
    it("should return supported currencies", async () => {
      const response = await request(app).get("/api/v1/price/currencies");

      expect(response.status).toBe(200);
      expect(response.body.currencies).toEqual(["USD", "EUR", "GBP", "JPY"]);
      expect(response.body.count).toBe(4);
    });
  });

  describe("GET /providers", () => {
    it("should return available providers", async () => {
      const response = await request(app).get("/api/v1/price/providers");

      expect(response.status).toBe(200);
      expect(response.body.providers).toEqual([
        "coinbase",
        "binance",
        "kraken",
      ]);
      expect(response.body.count).toBe(3);
    });
  });

  describe("GET /providers/status", () => {
    it("should return provider diagnostics metadata", async () => {
      const response = await request(app)
        .get("/api/v1/price/providers/status")
        .set("Authorization", "Bearer admin-token");

      expect(response.status).toBe(200);
      expect(response.body.providers).toHaveLength(2);
      expect(response.body.providers[0]).toMatchObject({
        name: "coinbase",
        enabled: true,
      });
      expect(response.body.count).toBe(2);
    });

    it("should require admin access for provider diagnostics metadata", async () => {
      const response = await request(app)
        .get("/api/v1/price/providers/status")
        .set("Authorization", "Bearer user-token");

      expect(response.status).toBe(403);
      expect(mockPriceService.getProviderDiagnostics).not.toHaveBeenCalled();
    });
  });

  describe("POST /providers/test", () => {
    it("should test all known providers", async () => {
      mockPriceService.testAllProviders.mockResolvedValue([
        {
          provider: "coinbase",
          enabled: true,
          ok: true,
          currency: "USD",
          latencyMs: 42,
          price: 50000,
          timestamp: new Date().toISOString(),
        },
      ]);

      const response = await request(app)
        .post("/api/v1/price/providers/test")
        .set("Authorization", "Bearer admin-token")
        .send({ currency: "usd" });

      expect(response.status).toBe(200);
      expect(response.body.currency).toBe("USD");
      expect(response.body.providers[0].ok).toBe(true);
      expect(mockPriceService.testAllProviders).toHaveBeenCalledWith("usd");
    });

    it("should default provider tests to USD", async () => {
      mockPriceService.testAllProviders.mockResolvedValue([]);

      const response = await request(app)
        .post("/api/v1/price/providers/test")
        .set("Authorization", "Bearer admin-token")
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.currency).toBe("USD");
      expect(mockPriceService.testAllProviders).toHaveBeenCalledWith("USD");
    });

    it("should require admin access before testing all providers", async () => {
      const response = await request(app)
        .post("/api/v1/price/providers/test")
        .set("Authorization", "Bearer user-token")
        .send({});

      expect(response.status).toBe(403);
      expect(mockPriceService.testAllProviders).not.toHaveBeenCalled();
    });
  });

  describe("POST /providers/:provider/test", () => {
    it("should test an individual provider", async () => {
      mockPriceService.testProvider.mockResolvedValue({
        provider: "binance",
        enabled: false,
        ok: false,
        currency: "USD",
        latencyMs: 51,
        error: "HTTP request failed",
      });

      const response = await request(app)
        .post("/api/v1/price/providers/binance/test")
        .set("Authorization", "Bearer admin-token")
        .send({ currency: "USD" });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        provider: "binance",
        enabled: false,
        ok: false,
        error: "HTTP request failed",
      });
      expect(mockPriceService.testProvider).toHaveBeenCalledWith(
        "binance",
        "USD",
      );
    });

    it("should require admin access before testing one provider", async () => {
      const response = await request(app)
        .post("/api/v1/price/providers/binance/test")
        .set("Authorization", "Bearer user-token")
        .send({ currency: "USD" });

      expect(response.status).toBe(403);
      expect(mockPriceService.testProvider).not.toHaveBeenCalled();
    });
  });

  describe("GET /health", () => {
    it("should return health status", async () => {
      mockPriceService.healthCheck.mockResolvedValue({
        healthy: true,
        providers: {
          coinbase: { healthy: true, latency: 50 },
          binance: { healthy: true, latency: 60 },
        },
      });

      const response = await request(app).get("/api/v1/price/health");

      expect(response.status).toBe(200);
      expect(response.body.healthy).toBe(true);
    });

    it("should return 500 on health check error", async () => {
      mockPriceService.healthCheck.mockRejectedValue(
        new Error("Health check failed"),
      );

      const response = await request(app).get("/api/v1/price/health");

      expect(response.status).toBe(500);
      expect(response.body.code).toBe("INTERNAL_ERROR");
    });
  });

  // ========================================
  // ADMIN CACHE ENDPOINTS
  // ========================================

  describe("GET /cache/stats", () => {
    it("should return cache stats for admin", async () => {
      mockPriceService.getCacheStats.mockReturnValue({
        hits: 100,
        misses: 10,
        size: 5,
      });

      const response = await request(app)
        .get("/api/v1/price/cache/stats")
        .set("Authorization", "Bearer admin-token");

      expect(response.status).toBe(200);
      expect(response.body.hits).toBe(100);
    });

    it("should return 401 without authentication", async () => {
      const response = await request(app).get("/api/v1/price/cache/stats");

      expect(response.status).toBe(401);
    });

    it("should return 403 for non-admin user", async () => {
      const response = await request(app)
        .get("/api/v1/price/cache/stats")
        .set("Authorization", "Bearer user-token");

      expect(response.status).toBe(403);
    });
  });

  describe("POST /cache/clear", () => {
    it("should clear cache for admin", async () => {
      const response = await request(app)
        .post("/api/v1/price/cache/clear")
        .set("Authorization", "Bearer admin-token");

      expect(response.status).toBe(200);
      expect(response.body.message).toContain("cleared");
      expect(mockPriceService.clearCache).toHaveBeenCalled();
    });

    it("should return 401 without authentication", async () => {
      const response = await request(app).post("/api/v1/price/cache/clear");

      expect(response.status).toBe(401);
    });

    it("should return 403 for non-admin user", async () => {
      const response = await request(app)
        .post("/api/v1/price/cache/clear")
        .set("Authorization", "Bearer user-token");

      expect(response.status).toBe(403);
    });
  });

  describe("POST /cache/duration", () => {
    it("should set cache duration for admin", async () => {
      const response = await request(app)
        .post("/api/v1/price/cache/duration")
        .set("Authorization", "Bearer admin-token")
        .send({ duration: 60000 });

      expect(response.status).toBe(200);
      expect(response.body.duration).toBe(60000);
      expect(mockPriceService.setCacheDuration).toHaveBeenCalledWith(60000);
    });

    it("should return 400 for invalid duration", async () => {
      const response = await request(app)
        .post("/api/v1/price/cache/duration")
        .set("Authorization", "Bearer admin-token")
        .send({ duration: -1 });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("positive number");
    });

    it("should return 400 for non-numeric duration", async () => {
      const response = await request(app)
        .post("/api/v1/price/cache/duration")
        .set("Authorization", "Bearer admin-token")
        .send({ duration: "invalid" });

      expect(response.status).toBe(400);
    });

    it("should return 401 without authentication", async () => {
      const response = await request(app)
        .post("/api/v1/price/cache/duration")
        .send({ duration: 60000 });

      expect(response.status).toBe(401);
    });

    it("should return 403 for non-admin user", async () => {
      const response = await request(app)
        .post("/api/v1/price/cache/duration")
        .set("Authorization", "Bearer user-token")
        .send({ duration: 60000 });

      expect(response.status).toBe(403);
    });
  });

  // ========================================
  // HISTORICAL PRICE ENDPOINTS
  // ========================================

  describe("GET /historical", () => {
    it("should return historical price for date", async () => {
      mockPriceService.getHistoricalPrice.mockResolvedValue(35000);

      const response = await request(app).get(
        "/api/v1/price/historical?date=2023-01-15",
      );

      expect(response.status).toBe(200);
      expect(response.body.price).toBe(35000);
      expect(response.body.currency).toBe("USD");
    });

    it("should accept currency parameter", async () => {
      mockPriceService.getHistoricalPrice.mockResolvedValue(32000);

      const response = await request(app).get(
        "/api/v1/price/historical?date=2023-01-15&currency=EUR",
      );

      expect(response.status).toBe(200);
      expect(mockPriceService.getHistoricalPrice).toHaveBeenCalledWith(
        "EUR",
        expect.any(Date),
      );
    });

    it("should return 400 without date parameter", async () => {
      const response = await request(app).get("/api/v1/price/historical");

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("date parameter is required");
    });

    it("should return 400 for invalid date format", async () => {
      const response = await request(app).get(
        "/api/v1/price/historical?date=invalid",
      );

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("Invalid date format");
    });

    it("should return 400 for future date", async () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const response = await request(app).get(
        `/api/v1/price/historical?date=${futureDate.toISOString()}`,
      );

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("cannot be in the future");
    });

    it("should return 500 on service error", async () => {
      mockPriceService.getHistoricalPrice.mockRejectedValue(
        new Error("Data not available"),
      );

      const response = await request(app).get(
        "/api/v1/price/historical?date=2023-01-15",
      );

      expect(response.status).toBe(500);
    });
  });

  describe("GET /history", () => {
    it("should return price history", async () => {
      mockPriceService.getPriceHistory.mockResolvedValue([
        { timestamp: new Date("2023-01-01"), price: 40000 },
        { timestamp: new Date("2023-01-02"), price: 41000 },
      ]);

      const response = await request(app).get("/api/v1/price/history");

      expect(response.status).toBe(200);
      expect(response.body.days).toBe(30); // default
      expect(response.body.dataPoints).toBe(2);
      expect(response.body.history).toHaveLength(2);
    });

    it("should accept days parameter", async () => {
      mockPriceService.getPriceHistory.mockResolvedValue([]);

      const response = await request(app).get("/api/v1/price/history?days=7");

      expect(response.status).toBe(200);
      expect(mockPriceService.getPriceHistory).toHaveBeenCalledWith("USD", 7);
    });

    it("should accept currency parameter", async () => {
      mockPriceService.getPriceHistory.mockResolvedValue([]);

      const response = await request(app).get(
        "/api/v1/price/history?currency=EUR",
      );

      expect(response.status).toBe(200);
      expect(mockPriceService.getPriceHistory).toHaveBeenCalledWith("EUR", 30);
    });

    it("should return 400 for invalid days", async () => {
      const response = await request(app).get(
        "/api/v1/price/history?days=invalid",
      );

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("days must be a number");
    });

    it("should return 400 for days < 1", async () => {
      const response = await request(app).get("/api/v1/price/history?days=0");

      expect(response.status).toBe(400);
    });

    it("should return 400 for days > 365", async () => {
      const response = await request(app).get("/api/v1/price/history?days=400");

      expect(response.status).toBe(400);
    });

    it("should return 500 on service error", async () => {
      mockPriceService.getPriceHistory.mockRejectedValue(
        new Error("Data not available"),
      );

      const response = await request(app).get("/api/v1/price/history");

      expect(response.status).toBe(500);
    });
  });
});
