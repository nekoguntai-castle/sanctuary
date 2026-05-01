import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";

import {
  createPriceTestApp,
  mockPriceData,
  mockPriceService,
  rateLimitHits,
  resetPriceMocks,
} from "./priceTestHarness";

describe("Price API public routes", () => {
  let app: Express;

  beforeAll(() => {
    app = createPriceTestApp();
  });

  beforeEach(() => {
    resetPriceMocks();
  });

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
      expect(rateLimitHits).toEqual([]);
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
});
