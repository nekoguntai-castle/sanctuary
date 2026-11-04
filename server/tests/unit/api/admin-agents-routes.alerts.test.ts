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
  alertFixture,
} from "./admin-agents-routes.fixtures";

describe("Admin wallet agent alert transitions", () => {
  let app: Express;
  const { agentId } = ADMIN_AGENT_TEST_IDS;
  const alertId = "77777777-7777-4777-8777-777777777777";
  const now = ADMIN_AGENT_TEST_NOW;
  const alertPath = (action: string, id = alertId) =>
    `/api/v1/admin/agents/${agentId}/alerts/${id}/${action}`;

  beforeAll(() => {
    app = createAdminAgentsRouteTestApp();
  });

  beforeEach(() => {
    resetAdminAgentsRouteMocks();
  });

  it("acknowledges an open alert and audits the transition", async () => {
    mocks.agentRepository.transitionAlertStatus.mockResolvedValueOnce({
      alert: alertFixture({ status: "acknowledged", acknowledgedAt: now }),
      changed: true,
    });

    const response = await request(app).post(alertPath("acknowledge")).expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        id: alertId,
        status: "acknowledged",
        acknowledgedAt: now.toISOString(),
        resolvedAt: null,
        amountSats: "20000",
      }),
    );
    expect(mocks.agentRepository.transitionAlertStatus).toHaveBeenCalledWith(
      agentId,
      alertId,
      "acknowledge",
    );
    expect(mocks.logFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      "wallet.agent_alert_acknowledge",
      "wallet",
      {
        details: {
          agentId,
          alertId,
          alertType: "operational_balance_low",
          alreadyInTargetStatus: false,
        },
      },
    );
  });

  it("resolves an alert and audits the transition", async () => {
    mocks.agentRepository.transitionAlertStatus.mockResolvedValueOnce({
      alert: alertFixture({ status: "resolved", resolvedAt: now }),
      changed: true,
    });

    const response = await request(app).post(alertPath("resolve")).expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({ id: alertId, status: "resolved", resolvedAt: now.toISOString() }),
    );
    expect(mocks.agentRepository.transitionAlertStatus).toHaveBeenCalledWith(
      agentId,
      alertId,
      "resolve",
    );
    expect(mocks.logFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      "wallet.agent_alert_resolve",
      "wallet",
      expect.objectContaining({
        details: expect.objectContaining({ alertId, alreadyInTargetStatus: false }),
      }),
    );
  });

  it("returns 200 for a repeated transition and records it as already applied", async () => {
    mocks.agentRepository.transitionAlertStatus.mockResolvedValueOnce({
      alert: alertFixture({ status: "resolved", resolvedAt: now }),
      changed: false,
    });

    await request(app).post(alertPath("resolve")).expect(200);

    expect(mocks.logFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      "wallet.agent_alert_resolve",
      "wallet",
      expect.objectContaining({
        details: expect.objectContaining({ alreadyInTargetStatus: true }),
      }),
    );
  });

  it("returns 409 when acknowledging a resolved alert", async () => {
    mocks.agentRepository.transitionAlertStatus.mockResolvedValueOnce({
      alert: alertFixture({ status: "resolved", resolvedAt: now }),
      changed: false,
    });

    await request(app).post(alertPath("acknowledge")).expect(409);
    expect(mocks.logFromRequest).not.toHaveBeenCalled();
  });

  it("returns 404 for an alert of another agent", async () => {
    mocks.agentRepository.transitionAlertStatus.mockResolvedValueOnce({
      alert: null,
      changed: false,
    });

    await request(app).post(alertPath("acknowledge")).expect(404);
    expect(mocks.logFromRequest).not.toHaveBeenCalled();
  });

  it("rejects invalid alert path params", async () => {
    await request(app).post(alertPath("acknowledge", "not-a-uuid")).expect(400);
    await request(app).post(alertPath("resolve", "not-a-uuid")).expect(400);
    await request(app)
      .post(`/api/v1/admin/agents/not-a-uuid/alerts/${alertId}/resolve`)
      .expect(400);
    expect(mocks.agentRepository.transitionAlertStatus).not.toHaveBeenCalled();
  });
});
