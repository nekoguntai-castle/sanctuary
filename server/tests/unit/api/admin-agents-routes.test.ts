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
  alertFixture,
  draftFixture,
  keyFixture,
  transactionFixture,
} from "./admin-agents-routes.fixtures";

describe("Admin wallet agent routes", () => {
  let app: Express;
  const {
    userId,
    fundingWalletId,
    operationalWalletId,
    signerDeviceId,
    agentId,
    keyId,
  } = ADMIN_AGENT_TEST_IDS;
  const now = ADMIN_AGENT_TEST_NOW;

  beforeAll(() => {
    app = createAdminAgentsRouteTestApp();
  });

  beforeEach(() => {
    resetAdminAgentsRouteMocks();
  });

  it("lists admin-visible agent form options", async () => {
    const response = await request(app)
      .get("/api/v1/admin/agents/options")
      .expect(200);

    expect(response.body.users).toEqual([
      expect.objectContaining({ id: userId, username: "alice" }),
    ]);
    expect(response.body.wallets).toEqual([
      expect.objectContaining({
        id: fundingWalletId,
        accessUserIds: [userId],
        deviceIds: [signerDeviceId],
      }),
      expect.objectContaining({
        id: operationalWalletId,
        accessUserIds: [userId],
        deviceIds: [],
      }),
    ]);
    expect(response.body.devices).toEqual([
      expect.objectContaining({
        id: signerDeviceId,
        label: "Agent signer",
        walletIds: [fundingWalletId],
      }),
    ]);
  });

  it("lists wallet agents without key secrets", async () => {
    mocks.agentRepository.findAgents.mockResolvedValue([
      agentFixture({
        apiKeys: [keyFixture({ keyHash: "secret" })],
      }),
    ]);

    const response = await request(app)
      .get(`/api/v1/admin/agents?walletId=${fundingWalletId}`)
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      id: agentId,
      name: "Treasury Agent",
      maxFundingAmountSats: "100000",
      apiKeys: [{ id: keyId, keyPrefix: "agt_prefix" }],
    });
    expect(response.body[0].apiKeys[0].keyHash).toBeUndefined();
    expect(mocks.agentRepository.findAgents).toHaveBeenCalledWith({
      walletId: fundingWalletId,
    });
  });

  it("lists agent wallet dashboard rows", async () => {
    mocks.agentRepository.findDashboardRows.mockResolvedValue([
      {
        agent: agentFixture({ apiKeys: [keyFixture({ keyHash: "secret" })] }),
        operationalBalanceSats: 82000n,
        pendingFundingDraftCount: 1,
        openAlertCount: 2,
        activeKeyCount: 1,
        lastFundingDraft: draftFixture({ amount: 50000n }),
        lastOperationalSpend: transactionFixture({ amount: 12000n, fee: 350n }),
        recentFundingDrafts: [draftFixture({ amount: 50000n })],
        recentOperationalSpends: [
          transactionFixture({ amount: 12000n, fee: 350n }),
        ],
        recentAlerts: [alertFixture({ type: "operational_balance_low" })],
      },
    ]);

    const response = await request(app)
      .get("/api/v1/admin/agents/dashboard")
      .expect(200);

    expect(response.body).toEqual([
      expect.objectContaining({
        operationalBalanceSats: "82000",
        pendingFundingDraftCount: 1,
        openAlertCount: 2,
        activeKeyCount: 1,
        agent: expect.objectContaining({
          id: agentId,
          apiKeys: [
            expect.objectContaining({ id: keyId, keyPrefix: "agt_prefix" }),
          ],
        }),
        lastFundingDraft: expect.objectContaining({
          amountSats: "50000",
          feeSats: "250",
        }),
        lastOperationalSpend: expect.objectContaining({
          amountSats: "12000",
          feeSats: "350",
        }),
        recentAlerts: [
          expect.objectContaining({ type: "operational_balance_low" }),
        ],
      }),
    ]);
    expect(response.body[0].agent.apiKeys[0].keyHash).toBeUndefined();
    expect(mocks.agentRepository.findDashboardRows).toHaveBeenCalledWith();
  });

  it("rejects invalid wallet agent list filters", async () => {
    await request(app)
      .get("/api/v1/admin/agents?walletId=not-a-wallet-id")
      .expect(400);
    expect(mocks.agentRepository.findAgents).not.toHaveBeenCalled();
  });

  it("creates a wallet agent after validating wallet and signer relationships", async () => {
    mocks.agentRepository.createAgent.mockImplementation(async (input) =>
      agentFixture({
        ...input,
        id: agentId,
        createdAt: now,
        updatedAt: now,
      }),
    );
    mocks.agentRepository.findAgentByIdWithDetails.mockResolvedValue(
      agentFixture(),
    );

    const response = await request(app)
      .post("/api/v1/admin/agents")
      .send({
        userId,
        name: "  Treasury Agent  ",
        fundingWalletId,
        operationalWalletId,
        signerDeviceId,
        maxFundingAmountSats: "100000",
        minOperationalBalanceSats: "25000",
        largeOperationalSpendSats: "75000",
        largeOperationalFeeSats: "5000",
        repeatedFailureThreshold: 3,
        repeatedFailureLookbackMinutes: 60,
        alertDedupeMinutes: 120,
        cooldownMinutes: 10,
      })
      .expect(201);

    expect(response.body.maxFundingAmountSats).toBe("100000");
    expect(response.body.minOperationalBalanceSats).toBeNull();
    expect(mocks.walletRepository.hasAccess).toHaveBeenCalledTimes(2);
    expect(mocks.agentRepository.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        name: "Treasury Agent",
        fundingWalletId,
        operationalWalletId,
        signerDeviceId,
        maxFundingAmountSats: 100000n,
        minOperationalBalanceSats: 25000n,
        largeOperationalSpendSats: 75000n,
        largeOperationalFeeSats: 5000n,
        repeatedFailureThreshold: 3,
        repeatedFailureLookbackMinutes: 60,
        alertDedupeMinutes: 120,
        cooldownMinutes: 10,
        requireHumanApproval: true,
      }),
    );
    expect(mocks.logFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      "wallet.agent_create",
      "wallet",
      {
        details: expect.objectContaining({
          agentId,
          fundingWalletId,
          operationalWalletId,
        }),
      },
    );
  });

  it("rejects invalid wallet-agent links", async () => {
    await request(app)
      .post("/api/v1/admin/agents")
      .send({
        userId,
        name: "same wallet",
        fundingWalletId,
        operationalWalletId: fundingWalletId,
        signerDeviceId,
      })
      .expect(400);

    await request(app)
      .post("/api/v1/admin/agents")
      .send({
        userId,
        name: "",
        fundingWalletId,
        operationalWalletId,
        signerDeviceId,
      })
      .expect(400);

    mocks.walletRepository.findById.mockImplementationOnce(async () => ({
      id: fundingWalletId,
      type: "watch_only",
      network: "testnet",
    }));
    await request(app)
      .post("/api/v1/admin/agents")
      .send({
        userId,
        name: "bad funding",
        fundingWalletId,
        operationalWalletId,
        signerDeviceId,
      })
      .expect(400);

    mocks.walletRepository.findByIdWithSigningDevices.mockResolvedValueOnce({
      id: fundingWalletId,
      devices: [],
    });
    await request(app)
      .post("/api/v1/admin/agents")
      .send({
        userId,
        name: "bad signer",
        fundingWalletId,
        operationalWalletId,
        signerDeviceId,
      })
      .expect(400);

    mocks.walletRepository.findByIdWithSigningDevices.mockResolvedValueOnce(
      null,
    );
    await request(app)
      .post("/api/v1/admin/agents")
      .send({
        userId,
        name: "missing signer wallet devices",
        fundingWalletId,
        operationalWalletId,
        signerDeviceId,
      })
      .expect(400);
  });

  it("creates a wallet agent with default nullable policy fields when details are unavailable", async () => {
    mocks.agentRepository.createAgent.mockImplementation(async (input) =>
      agentFixture({
        ...input,
        id: agentId,
        createdAt: now,
        updatedAt: now,
      }),
    );
    mocks.agentRepository.findAgentByIdWithDetails.mockResolvedValue(null);

    const response = await request(app)
      .post("/api/v1/admin/agents")
      .send({
        userId,
        name: "Default Policy Agent",
        fundingWalletId,
        operationalWalletId,
        signerDeviceId,
      })
      .expect(201);

    expect(response.body).toMatchObject({
      id: agentId,
      name: "Default Policy Agent",
      status: "active",
      maxFundingAmountSats: null,
      requireHumanApproval: true,
      notifyOnOperationalSpend: true,
      pauseOnUnexpectedSpend: false,
    });
    expect(mocks.agentRepository.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        maxFundingAmountSats: null,
        maxOperationalBalanceSats: null,
        dailyFundingLimitSats: null,
        weeklyFundingLimitSats: null,
        cooldownMinutes: null,
        minOperationalBalanceSats: null,
        largeOperationalSpendSats: null,
        largeOperationalFeeSats: null,
        repeatedFailureThreshold: null,
        repeatedFailureLookbackMinutes: null,
        alertDedupeMinutes: null,
      }),
    );
  });

  it("rejects missing or incompatible wallet-agent link resources", async () => {
    mocks.userRepository.findById.mockResolvedValueOnce(null);
    await request(app)
      .post("/api/v1/admin/agents")
      .send({
        userId,
        name: "missing user",
        fundingWalletId,
        operationalWalletId,
        signerDeviceId,
      })
      .expect(404);

    mocks.walletRepository.findById.mockImplementationOnce(async () => null);
    await request(app)
      .post("/api/v1/admin/agents")
      .send({
        userId,
        name: "missing funding",
        fundingWalletId,
        operationalWalletId,
        signerDeviceId,
      })
      .expect(404);

    mocks.walletRepository.findById
      .mockResolvedValueOnce({
        id: fundingWalletId,
        name: "Funding",
        type: "multi_sig",
        network: "testnet",
      })
      .mockResolvedValueOnce(null);
    await request(app)
      .post("/api/v1/admin/agents")
      .send({
        userId,
        name: "missing operational",
        fundingWalletId,
        operationalWalletId,
        signerDeviceId,
      })
      .expect(404);

    mocks.walletRepository.findById
      .mockResolvedValueOnce({
        id: fundingWalletId,
        name: "Funding",
        type: "multi_sig",
        network: "testnet",
      })
      .mockResolvedValueOnce({
        id: operationalWalletId,
        name: "Operational",
        type: "multi_sig",
        network: "testnet",
      });
    await request(app)
      .post("/api/v1/admin/agents")
      .send({
        userId,
        name: "bad operational type",
        fundingWalletId,
        operationalWalletId,
        signerDeviceId,
      })
      .expect(400);

    mocks.walletRepository.findById
      .mockResolvedValueOnce({
        id: fundingWalletId,
        name: "Funding",
        type: "multi_sig",
        network: "testnet",
      })
      .mockResolvedValueOnce({
        id: operationalWalletId,
        name: "Operational",
        type: "single_sig",
        network: "mainnet",
      });
    await request(app)
      .post("/api/v1/admin/agents")
      .send({
        userId,
        name: "bad network",
        fundingWalletId,
        operationalWalletId,
        signerDeviceId,
      })
      .expect(400);

    mocks.walletRepository.hasAccess
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await request(app)
      .post("/api/v1/admin/agents")
      .send({
        userId,
        name: "no funding access",
        fundingWalletId,
        operationalWalletId,
        signerDeviceId,
      })
      .expect(400);

    mocks.walletRepository.hasAccess
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await request(app)
      .post("/api/v1/admin/agents")
      .send({
        userId,
        name: "no operational access",
        fundingWalletId,
        operationalWalletId,
        signerDeviceId,
      })
      .expect(400);
  });

  it("updates and revokes wallet agents", async () => {
    mocks.agentRepository.findAgentById.mockResolvedValue(agentFixture());
    mocks.agentRepository.updateAgent.mockResolvedValue(
      agentFixture({
        status: "paused",
        maxFundingAmountSats: null,
      }),
    );
    mocks.agentRepository.findAgentByIdWithDetails.mockResolvedValue(
      agentFixture({
        status: "paused",
        maxFundingAmountSats: null,
      }),
    );

    const response = await request(app)
      .patch(`/api/v1/admin/agents/${agentId}`)
      .send({
        status: "paused",
        maxFundingAmountSats: null,
        minOperationalBalanceSats: null,
      })
      .expect(200);

    expect(response.body.status).toBe("paused");
    expect(response.body.maxFundingAmountSats).toBeNull();
    expect(mocks.agentRepository.updateAgent).toHaveBeenCalledWith(
      agentId,
      expect.objectContaining({
        status: "paused",
        maxFundingAmountSats: null,
        minOperationalBalanceSats: null,
        revokedAt: null,
      }),
    );

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(agentFixture());
    mocks.agentRepository.updateAgent.mockResolvedValueOnce(
      agentFixture({
        status: "revoked",
        revokedAt: now,
      }),
    );
    await request(app).delete(`/api/v1/admin/agents/${agentId}`).expect(200);
    expect(mocks.agentRepository.updateAgent).toHaveBeenCalledWith(
      agentId,
      expect.objectContaining({
        status: "revoked",
        revokedAt: expect.any(Date),
      }),
    );
  });

  it("updates every mutable policy field and rejects invalid agent ids", async () => {
    mocks.agentRepository.findAgentById.mockResolvedValue(agentFixture());
    mocks.agentRepository.updateAgent.mockResolvedValue(
      agentFixture({
        name: "Updated Agent",
        status: "active",
        maxFundingAmountSats: 200000n,
        maxOperationalBalanceSats: 500000n,
        dailyFundingLimitSats: 600000n,
        weeklyFundingLimitSats: 1000000n,
        cooldownMinutes: 20,
        minOperationalBalanceSats: 50000n,
        largeOperationalSpendSats: 90000n,
        largeOperationalFeeSats: 7000n,
        repeatedFailureThreshold: 4,
        repeatedFailureLookbackMinutes: 90,
        alertDedupeMinutes: 180,
        requireHumanApproval: false,
        notifyOnOperationalSpend: false,
        pauseOnUnexpectedSpend: true,
      }),
    );
    mocks.agentRepository.findAgentByIdWithDetails.mockResolvedValue(null);

    await request(app)
      .patch(`/api/v1/admin/agents/${agentId}`)
      .send({
        name: "  Updated Agent  ",
        status: "active",
        maxFundingAmountSats: "200000",
        maxOperationalBalanceSats: "500000",
        dailyFundingLimitSats: "600000",
        weeklyFundingLimitSats: "1000000",
        cooldownMinutes: 20,
        minOperationalBalanceSats: "50000",
        largeOperationalSpendSats: "90000",
        largeOperationalFeeSats: "7000",
        repeatedFailureThreshold: 4,
        repeatedFailureLookbackMinutes: 90,
        alertDedupeMinutes: 180,
        requireHumanApproval: false,
        notifyOnOperationalSpend: false,
        pauseOnUnexpectedSpend: true,
      })
      .expect(200);

    expect(mocks.agentRepository.updateAgent).toHaveBeenCalledWith(
      agentId,
      expect.objectContaining({
        name: "Updated Agent",
        maxOperationalBalanceSats: 500000n,
        dailyFundingLimitSats: 600000n,
        weeklyFundingLimitSats: 1000000n,
        cooldownMinutes: 20,
        largeOperationalFeeSats: 7000n,
        requireHumanApproval: false,
        notifyOnOperationalSpend: false,
        pauseOnUnexpectedSpend: true,
        revokedAt: null,
      }),
    );
    expect(mocks.logFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      "wallet.agent_update",
      "wallet",
      {
        details: expect.objectContaining({
          agentId,
          status: "active",
          notifyOnOperationalSpend: false,
          pauseOnUnexpectedSpend: true,
          unknownDestinationHandlingMode: "pause_agent",
        }),
      },
    );

    await request(app)
      .patch("/api/v1/admin/agents/not-a-uuid")
      .send({ status: "paused" })
      .expect(400);
    await request(app).delete("/api/v1/admin/agents/not-a-uuid").expect(400);

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(null);
    await request(app)
      .patch(`/api/v1/admin/agents/${agentId}`)
      .send({ status: "paused" })
      .expect(404);

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(agentFixture());
    mocks.agentRepository.updateAgent.mockResolvedValueOnce(
      agentFixture({
        status: "revoked",
        revokedAt: now,
      }),
    );
    await request(app)
      .patch(`/api/v1/admin/agents/${agentId}`)
      .send({ status: "revoked" })
      .expect(200);
    expect(mocks.agentRepository.updateAgent).toHaveBeenLastCalledWith(
      agentId,
      expect.objectContaining({
        status: "revoked",
        revokedAt: expect.any(Date),
      }),
    );

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(null);
    await request(app).delete(`/api/v1/admin/agents/${agentId}`).expect(404);

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(
      agentFixture({
        status: "revoked",
        revokedAt: now,
      }),
    );
    await request(app).delete(`/api/v1/admin/agents/${agentId}`).expect(200);
  });

  it("lists persisted wallet agent alerts", async () => {
    mocks.agentRepository.findAgentById.mockResolvedValue(agentFixture());
    mocks.agentRepository.findAlerts.mockResolvedValue([
      alertFixture({
        type: "large_operational_spend",
        amountSats: 75000n,
        thresholdSats: 50000n,
      }),
    ]);

    const response = await request(app)
      .get(
        `/api/v1/admin/agents/${agentId}/alerts?status=open&type=large_operational_spend&limit=10`,
      )
      .expect(200);

    expect(response.body).toEqual([
      expect.objectContaining({
        id: "77777777-7777-4777-8777-777777777777",
        agentId,
        type: "large_operational_spend",
        severity: "warning",
        status: "open",
        amountSats: "75000",
        thresholdSats: "50000",
      }),
    ]);
    expect(mocks.agentRepository.findAlerts).toHaveBeenCalledWith({
      agentId,
      status: "open",
      type: "large_operational_spend",
      limit: 10,
    });

    await request(app)
      .get(`/api/v1/admin/agents/${agentId}/alerts?limit=0`)
      .expect(400);

    mocks.agentRepository.findAgentById.mockResolvedValueOnce(null);
    await request(app)
      .get(`/api/v1/admin/agents/${agentId}/alerts`)
      .expect(404);
  });
});
