import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";
import {
  createAdminAgentsRouteTestApp,
  mocks,
  resetAdminAgentsRouteMocks,
} from "./adminAgentsRoutes.testHarness";
import {
  ADMIN_AGENT_TEST_IDS,
  ADMIN_AGENT_TEST_NOW,
  agentFixture,
  keyFixture,
  overrideFixture,
} from "./admin-agents-routes.fixtures";

describe("Admin wallet agent route controls", () => {
  let app: Express;
  const { fundingWalletId, operationalWalletId, agentId, keyId } =
    ADMIN_AGENT_TEST_IDS;
  const now = ADMIN_AGENT_TEST_NOW;

  beforeAll(() => {
    app = createAdminAgentsRouteTestApp();
  });

  beforeEach(() => {
    resetAdminAgentsRouteMocks();
  });

  it("creates, lists, and revokes owner funding overrides", async () => {
    const overrideId = "88888888-8888-4888-8888-888888888888";
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();

    mocks.agentRepository.findAgentById.mockResolvedValue(agentFixture());
    mocks.agentRepository.findFundingOverrides.mockResolvedValue([
      overrideFixture({ id: overrideId }),
    ]);
    mocks.agentRepository.createFundingOverride.mockImplementation(
      async (input) =>
        overrideFixture({
          id: overrideId,
          ...input,
          status: "active",
          createdAt: now,
          updatedAt: now,
        }),
    );

    const list = await request(app)
      .get(`/api/v1/admin/agents/${agentId}/overrides?status=active&limit=10`)
      .expect(200);

    expect(list.body).toEqual([
      expect.objectContaining({
        id: overrideId,
        agentId,
        maxAmountSats: "150000",
        status: "active",
      }),
    ]);
    expect(mocks.agentRepository.findFundingOverrides).toHaveBeenCalledWith({
      agentId,
      status: "active",
      limit: 10,
    });

    const created = await request(app)
      .post(`/api/v1/admin/agents/${agentId}/overrides`)
      .send({
        maxAmountSats: "250000",
        expiresAt,
        reason: "  emergency refill  ",
      })
      .expect(201);

    expect(created.body).toEqual(
      expect.objectContaining({
        id: overrideId,
        maxAmountSats: "250000",
        reason: "emergency refill",
        status: "active",
      }),
    );
    expect(mocks.agentRepository.createFundingOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId,
        fundingWalletId,
        operationalWalletId,
        createdByUserId: "admin-1",
        maxAmountSats: 250000n,
        reason: "emergency refill",
        expiresAt: expect.any(Date),
      }),
    );
    expect(mocks.logFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      "wallet.agent_override_create",
      "wallet",
      expect.objectContaining({
        details: expect.objectContaining({ overrideId }),
      }),
    );

    mocks.agentRepository.findFundingOverrideById.mockResolvedValueOnce(
      overrideFixture({ id: overrideId }),
    );
    mocks.agentRepository.revokeFundingOverride.mockResolvedValueOnce(
      overrideFixture({
        id: overrideId,
        status: "revoked",
        revokedAt: now,
      }),
    );

    await request(app)
      .delete(`/api/v1/admin/agents/${agentId}/overrides/${overrideId}`)
      .expect(200);

    expect(mocks.agentRepository.revokeFundingOverride).toHaveBeenCalledWith(
      overrideId,
    );
    expect(mocks.logFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      "wallet.agent_override_revoke",
      "wallet",
      expect.objectContaining({
        details: expect.objectContaining({ overrideId }),
      }),
    );
  });

  it("rejects invalid owner funding override requests", async () => {
    mocks.agentRepository.findAgentById.mockResolvedValue(agentFixture());

    await request(app)
      .get(`/api/v1/admin/agents/${agentId}/overrides?status=invalid`)
      .expect(400);

    await request(app)
      .post(`/api/v1/admin/agents/${agentId}/overrides`)
      .send({
        maxAmountSats: "0",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        reason: "zero",
      })
      .expect(400);

    await request(app)
      .post(`/api/v1/admin/agents/${agentId}/overrides`)
      .send({
        maxAmountSats: "1000",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        reason: "expired",
      })
      .expect(400);

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(null);
    await request(app)
      .get(`/api/v1/admin/agents/${agentId}/overrides`)
      .expect(404);

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(null);
    await request(app)
      .post(`/api/v1/admin/agents/${agentId}/overrides`)
      .send({
        maxAmountSats: "1000",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        reason: "missing agent",
      })
      .expect(404);
  });

  it("rejects owner overrides for revoked agents and protects revoke tenant boundaries", async () => {
    const overrideId = "88888888-8888-4888-8888-888888888888";

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(
      agentFixture({
        status: "revoked",
        revokedAt: now,
      }),
    );
    await request(app)
      .post(`/api/v1/admin/agents/${agentId}/overrides`)
      .send({
        maxAmountSats: "250000",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        reason: "revoked agent",
      })
      .expect(400);
    expect(mocks.agentRepository.createFundingOverride).not.toHaveBeenCalled();

    mocks.agentRepository.findFundingOverrideById.mockResolvedValueOnce(null);
    await request(app)
      .delete(`/api/v1/admin/agents/${agentId}/overrides/${overrideId}`)
      .expect(404);

    mocks.agentRepository.findFundingOverrideById.mockResolvedValueOnce(
      overrideFixture({
        id: overrideId,
        agentId: "99999999-9999-4999-8999-999999999999",
      }),
    );
    await request(app)
      .delete(`/api/v1/admin/agents/${agentId}/overrides/${overrideId}`)
      .expect(404);
  });

  it("does not revoke an already inactive owner override a second time", async () => {
    const overrideId = "88888888-8888-4888-8888-888888888888";
    mocks.agentRepository.findFundingOverrideById.mockResolvedValueOnce(
      overrideFixture({
        id: overrideId,
        status: "used",
        usedAt: now,
        usedDraftId: "draft-1",
      }),
    );

    await request(app)
      .delete(`/api/v1/admin/agents/${agentId}/overrides/${overrideId}`)
      .expect(200);

    expect(mocks.agentRepository.revokeFundingOverride).not.toHaveBeenCalled();
    expect(mocks.logFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      "wallet.agent_override_revoke",
      "wallet",
      expect.objectContaining({
        details: expect.objectContaining({
          overrideId,
          alreadyInactive: true,
        }),
      }),
    );
  });

  it("rejects invalid override path params", async () => {
    await request(app)
      .delete(`/api/v1/admin/agents/${agentId}/overrides/not-a-uuid`)
      .expect(400);
  });

  it("creates, lists, and revokes scoped agent API keys", async () => {
    mocks.agentRepository.findAgentById.mockResolvedValue(agentFixture());
    mocks.agentRepository.findApiKeysByAgentId.mockResolvedValue([
      keyFixture(),
    ]);
    mocks.agentRepository.createApiKey.mockImplementation(async (input) =>
      keyFixture({
        ...input,
        id: keyId,
        createdAt: now,
      }),
    );

    const list = await request(app)
      .get(`/api/v1/admin/agents/${agentId}/keys`)
      .expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({ id: keyId, keyPrefix: "agt_prefix" }),
    ]);

    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const create = await request(app)
      .post(`/api/v1/admin/agents/${agentId}/keys`)
      .send({ name: " Runtime ", expiresAt })
      .expect(201);

    expect(create.body.apiKey).toMatch(/^agt_[a-f0-9]{64}$/);
    expect(create.body.keyPrefix).toBe(create.body.apiKey.slice(0, 16));
    expect(mocks.agentRepository.createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId,
        createdByUserId: "admin-1",
        name: "Runtime",
        keyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        keyPrefix: create.body.apiKey.slice(0, 16),
        scope: { allowedActions: ["create_funding_draft"] },
        expiresAt: expect.any(Date),
      }),
    );

    mocks.agentRepository.findApiKeyById.mockResolvedValueOnce(keyFixture());
    mocks.agentRepository.revokeApiKey.mockResolvedValueOnce(
      keyFixture({ revokedAt: now }),
    );
    await request(app)
      .delete(`/api/v1/admin/agents/${agentId}/keys/${keyId}`)
      .expect(200);
    expect(mocks.agentRepository.revokeApiKey).toHaveBeenCalledWith(keyId);
  });

  it("rejects invalid and ineligible scoped agent API key requests", async () => {
    mocks.agentRepository.findAgentById.mockResolvedValueOnce(null);
    await request(app).get(`/api/v1/admin/agents/${agentId}/keys`).expect(404);

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(
      agentFixture({
        status: "revoked",
        revokedAt: now,
      }),
    );
    await request(app)
      .post(`/api/v1/admin/agents/${agentId}/keys`)
      .send({ name: "Runtime" })
      .expect(400);

    await request(app)
      .post(`/api/v1/admin/agents/${agentId}/keys`)
      .send({
        name: "Expired",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      })
      .expect(400);

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(null);
    await request(app)
      .post(`/api/v1/admin/agents/${agentId}/keys`)
      .send({ name: "Missing agent" })
      .expect(404);

    await request(app)
      .delete(`/api/v1/admin/agents/${agentId}/keys/not-a-uuid`)
      .expect(400);

    mocks.agentRepository.findApiKeyById.mockResolvedValueOnce(
      keyFixture({
        agentId: "99999999-9999-4999-8999-999999999999",
      }),
    );
    await request(app)
      .delete(`/api/v1/admin/agents/${agentId}/keys/${keyId}`)
      .expect(404);

    mocks.agentRepository.findApiKeyById.mockResolvedValueOnce(
      keyFixture({ revokedAt: now }),
    );
    await request(app)
      .delete(`/api/v1/admin/agents/${agentId}/keys/${keyId}`)
      .expect(200);
    expect(mocks.agentRepository.revokeApiKey).not.toHaveBeenCalled();
  });
});
