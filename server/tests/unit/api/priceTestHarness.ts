import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { vi } from "vitest";

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

const priceMocks = vi.hoisted(() => ({
  mockPriceService: {
    getPrice: vi.fn(),
    getPrices: vi.fn(),
    getPriceFrom: vi.fn(),
    convertToFiat: vi.fn(),
    convertToSats: vi.fn(),
    getSupportedCurrencies: vi.fn(),
    getProviders: vi.fn(),
    getProviderDiagnostics: vi.fn(),
    setProviderEnabled: vi.fn(),
    testProvider: vi.fn(),
    testAllProviders: vi.fn(),
    healthCheck: vi.fn(),
    getCacheStats: vi.fn(),
    clearCache: vi.fn(),
    setCacheDuration: vi.fn(),
    getHistoricalPrice: vi.fn(),
    getPriceHistory: vi.fn(),
  },
  rateLimitHits: [] as string[],
}));

export const mockPriceService = priceMocks.mockPriceService;
export const rateLimitHits = priceMocks.rateLimitHits;

vi.mock("express-rate-limit", () => ({
  default: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => {
    rateLimitHits.push("express-rate-limit");
    next();
  }),
}));

vi.mock("../../../src/middleware/rateLimit", () => ({
  rateLimitByUser: vi.fn(
    (policyName: string) =>
      (_req: Request, _res: Response, next: NextFunction) => {
        rateLimitHits.push(policyName);
        next();
      },
  ),
}));

vi.mock("../../../src/services/price", () => ({
  getPriceService: () => priceMocks.mockPriceService,
}));

vi.mock("../../../src/utils/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

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

import priceRouter from "../../../src/api/price";
import { errorHandler } from "../../../src/errors/errorHandler";

export const bearerAdmin = "Bearer admin-token";
export const bearerUser = "Bearer user-token";

export const mockPriceData = {
  price: 45000,
  currency: "USD",
  timestamp: new Date().toISOString(),
  provider: "coinbase",
};

export function createPriceTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/price", priceRouter);
  app.use(errorHandler);
  return app;
}

export function resetPriceMocks() {
  vi.clearAllMocks();
  rateLimitHits.length = 0;
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
}
