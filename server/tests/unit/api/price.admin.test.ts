import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";

import {
  bearerAdmin,
  bearerUser,
  createPriceTestApp,
  mockPriceService,
  rateLimitHits,
  resetPriceMocks,
} from "./priceTestHarness";

describe("Price API admin routes", () => {
  let app: Express;

  beforeAll(() => {
    app = createPriceTestApp();
  });

  beforeEach(() => {
    resetPriceMocks();
  });

  describe("admin price rate limiting", () => {
    it.each([
      {
        route: "GET /providers/status",
        send: () =>
          request(app)
            .get("/api/v1/price/providers/status")
            .set("Authorization", bearerAdmin),
      },
      {
        route: "POST /providers/test",
        setup: () => mockPriceService.testAllProviders.mockResolvedValue([]),
        send: () =>
          request(app)
            .post("/api/v1/price/providers/test")
            .set("Authorization", bearerAdmin)
            .send({}),
      },
      {
        route: "POST /providers/:provider/test",
        setup: () =>
          mockPriceService.testProvider.mockResolvedValue({
            provider: "coinbase",
            enabled: true,
            ok: true,
            currency: "USD",
            latencyMs: 1,
            price: 50000,
            timestamp: new Date().toISOString(),
          }),
        send: () =>
          request(app)
            .post("/api/v1/price/providers/coinbase/test")
            .set("Authorization", bearerAdmin)
            .send({ currency: "USD" }),
      },
      {
        route: "PATCH /providers/:provider",
        setup: () =>
          mockPriceService.setProviderEnabled.mockResolvedValue([
            {
              name: "coinbase",
              priority: 70,
              supportedCurrencies: ["USD", "EUR", "GBP", "CAD"],
              enabled: false,
            },
          ]),
        send: () =>
          request(app)
            .patch("/api/v1/price/providers/coinbase")
            .set("Authorization", bearerAdmin)
            .send({ enabled: false }),
      },
      {
        route: "GET /cache/stats",
        setup: () =>
          mockPriceService.getCacheStats.mockReturnValue({
            hits: 1,
            misses: 0,
            size: 1,
          }),
        send: () =>
          request(app)
            .get("/api/v1/price/cache/stats")
            .set("Authorization", bearerAdmin),
      },
      {
        route: "POST /cache/clear",
        send: () =>
          request(app)
            .post("/api/v1/price/cache/clear")
            .set("Authorization", bearerAdmin),
      },
      {
        route: "POST /cache/duration",
        send: () =>
          request(app)
            .post("/api/v1/price/cache/duration")
            .set("Authorization", bearerAdmin)
            .send({ duration: 60000 }),
      },
    ])(
      "applies modeled and policy limiters to $route",
      async ({ setup, send }) => {
        setup?.();

        const response = await send();

        expect(response.status).toBe(200);
        expect(rateLimitHits).toEqual(["express-rate-limit", "admin:default"]);
      },
    );
  });

  describe("GET /providers/status", () => {
    it("should return provider diagnostics metadata", async () => {
      const response = await request(app)
        .get("/api/v1/price/providers/status")
        .set("Authorization", bearerAdmin);

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
        .set("Authorization", bearerUser);

      expect(response.status).toBe(403);
      expect(mockPriceService.getProviderDiagnostics).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /providers/:provider", () => {
    it("should update provider enablement for admins", async () => {
      mockPriceService.setProviderEnabled.mockResolvedValue([
        {
          name: "binance",
          priority: 60,
          supportedCurrencies: ["USD", "EUR", "GBP"],
          enabled: true,
        },
      ]);

      const response = await request(app)
        .patch("/api/v1/price/providers/binance")
        .set("Authorization", bearerAdmin)
        .send({ enabled: true });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        provider: "binance",
        enabled: true,
        count: 1,
      });
      expect(mockPriceService.setProviderEnabled).toHaveBeenCalledWith(
        "binance",
        true,
        "admin-1",
      );
    });

    it("should validate provider enablement payloads", async () => {
      const response = await request(app)
        .patch("/api/v1/price/providers/binance")
        .set("Authorization", bearerAdmin)
        .send({ enabled: "yes" });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("enabled must be a boolean");
      expect(mockPriceService.setProviderEnabled).not.toHaveBeenCalled();
    });

    it("should require admin access before updating provider enablement", async () => {
      const response = await request(app)
        .patch("/api/v1/price/providers/binance")
        .set("Authorization", bearerUser)
        .send({ enabled: true });

      expect(response.status).toBe(403);
      expect(mockPriceService.setProviderEnabled).not.toHaveBeenCalled();
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
        .set("Authorization", bearerAdmin)
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
        .set("Authorization", bearerAdmin)
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.currency).toBe("USD");
      expect(mockPriceService.testAllProviders).toHaveBeenCalledWith("USD");
    });

    it("should require admin access before testing all providers", async () => {
      const response = await request(app)
        .post("/api/v1/price/providers/test")
        .set("Authorization", bearerUser)
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
        .set("Authorization", bearerAdmin)
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
        .set("Authorization", bearerUser)
        .send({ currency: "USD" });

      expect(response.status).toBe(403);
      expect(mockPriceService.testProvider).not.toHaveBeenCalled();
    });
  });

  describe("GET /cache/stats", () => {
    it("should return cache stats for admin", async () => {
      mockPriceService.getCacheStats.mockReturnValue({
        hits: 100,
        misses: 10,
        size: 5,
      });

      const response = await request(app)
        .get("/api/v1/price/cache/stats")
        .set("Authorization", bearerAdmin);

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
        .set("Authorization", bearerUser);

      expect(response.status).toBe(403);
    });
  });

  describe("POST /cache/clear", () => {
    it("should clear cache for admin", async () => {
      const response = await request(app)
        .post("/api/v1/price/cache/clear")
        .set("Authorization", bearerAdmin);

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
        .set("Authorization", bearerUser);

      expect(response.status).toBe(403);
    });
  });

  describe("POST /cache/duration", () => {
    it("should set cache duration for admin", async () => {
      const response = await request(app)
        .post("/api/v1/price/cache/duration")
        .set("Authorization", bearerAdmin)
        .send({ duration: 60000 });

      expect(response.status).toBe(200);
      expect(response.body.duration).toBe(60000);
      expect(mockPriceService.setCacheDuration).toHaveBeenCalledWith(60000);
    });

    it("should return 400 for invalid duration", async () => {
      const response = await request(app)
        .post("/api/v1/price/cache/duration")
        .set("Authorization", bearerAdmin)
        .send({ duration: -1 });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("positive number");
    });

    it("should return 400 for non-numeric duration", async () => {
      const response = await request(app)
        .post("/api/v1/price/cache/duration")
        .set("Authorization", bearerAdmin)
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
        .set("Authorization", bearerUser)
        .send({ duration: 60000 });

      expect(response.status).toBe(403);
    });
  });
});
