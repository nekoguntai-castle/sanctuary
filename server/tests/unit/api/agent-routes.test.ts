import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";
import {
  agentContext,
  createAgentRouteTestApp,
  mockAgentRateLimitKeys,
  mockGetOrCreateOperationalReceiveAddress,
  mockVerifyOperationalReceiveAddress,
  resetAgentRouteMocks,
  walletRepository,
} from "./agentRoutes.testHarness";

describe("Agent Routes", () => {
  let app: Express;

  beforeAll(() => {
    app = createAgentRouteTestApp();
  });

  beforeEach(() => {
    resetAgentRouteMocks();
  });

  it("keys the scoped policy limiter by agent prefix with an IP fallback", () => {
    expect(mockAgentRateLimitKeys).toEqual(
      expect.arrayContaining([
        "agent:agt_prefix",
        "ip:203.0.113.10",
        "ip:unknown",
      ]),
    );
  });

  it("returns linked wallet summary for the scoped agent", async () => {
    const response = await request(app)
      .get("/api/v1/agent/wallets/funding-wallet/summary")
      .set("Authorization", "Bearer agt_test");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      agent: { id: "agent-1", name: "Treasury Agent" },
      fundingWallet: { id: "funding-wallet", balance: "20000" },
      operationalWallet: { id: "operational-wallet", balance: "5000" },
      allowedActions: ["create_funding_draft"],
    });
  });

  it("returns not found when linked wallets disappear before summary generation", async () => {
    (walletRepository.findById as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "operational-wallet",
        name: "Operational",
        type: "single_sig",
        network: "testnet",
      });

    await request(app)
      .get("/api/v1/agent/wallets/funding-wallet/summary")
      .set("Authorization", "Bearer agt_test")
      .expect(404);

    (walletRepository.findById as any)
      .mockResolvedValueOnce({
        id: "funding-wallet",
        name: "Funding",
        type: "multi_sig",
        network: "testnet",
      })
      .mockResolvedValueOnce(null);

    await request(app)
      .get("/api/v1/agent/wallets/funding-wallet/summary")
      .set("Authorization", "Bearer agt_test")
      .expect(404);
  });

  it("defaults summary allowed actions to an empty list when the credential scope omits them", async () => {
    agentContext.scope = {} as any;

    const response = await request(app)
      .get("/api/v1/agent/wallets/funding-wallet/summary")
      .set("Authorization", "Bearer agt_test")
      .expect(200);

    expect(response.body.allowedActions).toEqual([]);
  });

  it("returns the next known operational receive address", async () => {
    const response = await request(app)
      .get("/api/v1/agent/wallets/funding-wallet/operational-address")
      .set("Authorization", "Bearer agt_test");

    expect(response.status).toBe(200);
    expect(mockGetOrCreateOperationalReceiveAddress).toHaveBeenCalledWith({
      agentId: "agent-1",
      operationalWalletId: "operational-wallet",
    });
    expect(response.body).toEqual({
      walletId: "operational-wallet",
      address: "tb1qoperational",
      derivationPath: "m/84'/1'/0'/0/0",
      index: 0,
      generated: false,
    });
  });

  it("returns a generated operational receive address when the service derives one", async () => {
    mockGetOrCreateOperationalReceiveAddress.mockResolvedValueOnce({
      walletId: "operational-wallet",
      address: "tb1qgenerated",
      derivationPath: "m/84'/1'/0'/0/20",
      index: 20,
      generated: true,
    });

    const response = await request(app)
      .get("/api/v1/agent/wallets/funding-wallet/operational-address")
      .set("Authorization", "Bearer agt_test");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      walletId: "operational-wallet",
      address: "tb1qgenerated",
      derivationPath: "m/84'/1'/0'/0/20",
      index: 20,
      generated: true,
    });
  });

  it("verifies agent-provided operational receive addresses", async () => {
    const response = await request(app)
      .post("/api/v1/agent/wallets/funding-wallet/operational-address/verify")
      .set("Authorization", "Bearer agt_test")
      .send({ address: "tb1qoperational" });

    expect(response.status).toBe(200);
    expect(mockVerifyOperationalReceiveAddress).toHaveBeenCalledWith({
      operationalWalletId: "operational-wallet",
      address: "tb1qoperational",
    });
    expect(response.body).toEqual({
      walletId: "operational-wallet",
      address: "tb1qoperational",
      verified: true,
      derivationPath: "m/84'/1'/0'/0/0",
      index: 0,
    });
  });

  it("rejects empty operational address verification payloads", async () => {
    const response = await request(app)
      .post("/api/v1/agent/wallets/funding-wallet/operational-address/verify")
      .set("Authorization", "Bearer agt_test")
      .send({ address: "" });

    expect(response.status).toBe(400);
    expect(mockVerifyOperationalReceiveAddress).not.toHaveBeenCalled();
  });
});
