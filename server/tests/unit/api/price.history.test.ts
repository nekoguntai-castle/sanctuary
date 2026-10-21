import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";

import { InvalidInputError } from "../../../src/errors/ApiError";

import {
  createPriceTestApp,
  mockPriceService,
  resetPriceMocks,
} from "./priceTestHarness";

describe("Price API historical routes", () => {
  let app: Express;

  beforeAll(() => {
    app = createPriceTestApp();
  });

  beforeEach(() => {
    resetPriceMocks();
  });

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

    it("returns the service's 400 for an unsupported currency", async () => {
      mockPriceService.getHistoricalPrice.mockRejectedValue(
        new InvalidInputError("Unsupported currency: ZZZ", "currency"),
      );

      const response = await request(app).get(
        "/api/v1/price/historical?date=2023-01-15&currency=zzz",
      );

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Unsupported currency: ZZZ");
    });

    it("rejects a repeated currency parameter with 400", async () => {
      mockPriceService.getHistoricalPrice.mockResolvedValue(32000);

      const response = await request(app).get(
        "/api/v1/price/historical?date=2023-01-15&currency=usd&currency=eur",
      );

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("currency");
      expect(mockPriceService.getHistoricalPrice).not.toHaveBeenCalled();
    });

    it("responds with the upper-cased currency", async () => {
      mockPriceService.getHistoricalPrice.mockResolvedValue(32000);

      const response = await request(app).get(
        "/api/v1/price/historical?date=2023-01-15&currency=eur",
      );

      expect(response.status).toBe(200);
      expect(response.body.currency).toBe("EUR");
      expect(mockPriceService.getHistoricalPrice).toHaveBeenCalledWith(
        "EUR",
        expect.any(Date),
      );
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
      expect(response.body.days).toBe(30);
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

    it("returns the service's 400 for an unsupported currency", async () => {
      mockPriceService.getPriceHistory.mockRejectedValue(
        new InvalidInputError("Unsupported currency: ZZZ", "currency"),
      );

      const response = await request(app).get(
        "/api/v1/price/history?currency=zzz",
      );

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Unsupported currency: ZZZ");
    });

    it("rejects a repeated currency parameter with 400", async () => {
      mockPriceService.getPriceHistory.mockResolvedValue([]);

      const response = await request(app).get(
        "/api/v1/price/history?currency=usd&currency=eur",
      );

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("currency");
      expect(mockPriceService.getPriceHistory).not.toHaveBeenCalled();
    });

    it("responds with the upper-cased currency", async () => {
      mockPriceService.getPriceHistory.mockResolvedValue([]);

      const response = await request(app).get(
        "/api/v1/price/history?currency=eur",
      );

      expect(response.status).toBe(200);
      expect(response.body.currency).toBe("EUR");
      expect(mockPriceService.getPriceHistory).toHaveBeenCalledWith("EUR", 30);
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
