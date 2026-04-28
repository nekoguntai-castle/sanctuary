import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { errorHandler } from "../../../src/errors/errorHandler";
import { ServiceUnavailableError } from "../../../src/errors/ApiError";

const mocks = vi.hoisted(() => {
  const rateLimitHits: string[] = [];

  return {
    listConsoleTools: vi.fn(),
    createConsoleSession: vi.fn(),
    deleteConsoleSession: vi.fn(),
    listConsoleSessions: vi.fn(),
    listConsoleTurns: vi.fn(),
    runConsoleTurn: vi.fn(),
    listPromptHistory: vi.fn(),
    clearPromptHistory: vi.fn(),
    updatePromptHistory: vi.fn(),
    deletePromptHistory: vi.fn(),
    replayPromptHistory: vi.fn(),
    rateLimitHits,
    authenticated: true,
    featureEnabled: true,
    rateLimitByUser: vi.fn(
      (policyName: string) => (_req: any, _res: any, next: () => void) => {
        rateLimitHits.push(policyName);
        next();
      },
    ),
  };
});

vi.mock("../../../src/middleware/auth", () => ({
  authenticate: (req: any, res: any, next: () => void) => {
    if (!mocks.authenticated) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "No authentication token provided",
      });
    }
    req.user = { userId: "user-1", username: "alice", isAdmin: true };
    next();
  },
  requireAuthenticatedUser: (req: any) => req.user,
}));

vi.mock("../../../src/middleware/featureGate", () => ({
  requireFeature:
    (feature: string) => (_req: any, res: any, next: () => void) => {
      if (!mocks.featureEnabled) {
        return res.status(403).json({
          error: "Feature disabled",
          feature,
        });
      }
      next();
    },
}));

vi.mock("../../../src/middleware/rateLimit", () => ({
  rateLimitByUser: mocks.rateLimitByUser,
}));

vi.mock("../../../src/services/auditService", () => ({
  getClientInfo: () => ({ ipAddress: "127.0.0.1", userAgent: "test-agent" }),
}));

vi.mock("../../../src/assistant/console/service", () => mocks);

import consoleRouter from "../../../src/api/console";

describe("console API routes", () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use("/api/v1/console", consoleRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimitHits.length = 0;
    mocks.authenticated = true;
    mocks.featureEnabled = true;
    mocks.listConsoleTools.mockReturnValue([{ name: "get_fee_estimates" }]);
    mocks.listConsoleSessions.mockResolvedValue([{ id: "session-1" }]);
    mocks.createConsoleSession.mockResolvedValue({ id: "session-1" });
    mocks.deleteConsoleSession.mockResolvedValue({ id: "session-1" });
    mocks.listConsoleTurns.mockResolvedValue([{ id: "turn-1" }]);
    mocks.runConsoleTurn.mockResolvedValue({ turn: { id: "turn-1" } });
    mocks.listPromptHistory.mockResolvedValue([{ id: "prompt-1" }]);
    mocks.clearPromptHistory.mockResolvedValue(2);
    mocks.updatePromptHistory.mockResolvedValue({
      id: "prompt-1",
      saved: true,
    });
    mocks.deletePromptHistory.mockResolvedValue({ id: "prompt-1" });
    mocks.replayPromptHistory.mockResolvedValue({ turn: { id: "turn-2" } });
  });

  it("lists tools and sessions for the authenticated actor", async () => {
    const tools = await request(app).get("/api/v1/console/tools");
    const sessions = await request(app).get(
      "/api/v1/console/sessions?limit=5&offset=2",
    );

    expect(tools.status).toBe(200);
    expect(tools.body.tools).toEqual([{ name: "get_fee_estimates" }]);
    expect(sessions.status).toBe(200);
    expect(mocks.listConsoleTools).toHaveBeenCalledWith({
      userId: "user-1",
      username: "alice",
      isAdmin: true,
    });
    expect(mocks.listConsoleSessions).toHaveBeenCalledWith(
      { userId: "user-1", username: "alice", isAdmin: true },
      5,
      2,
    );
  });

  it("applies the coarse console limiter and model-backed turn limiter", async () => {
    const tools = await request(app).get("/api/v1/console/tools");
    const turn = await request(app)
      .post("/api/v1/console/turns")
      .send({ prompt: "show recent wallet activity" });

    expect(tools.status).toBe(200);
    expect(turn.status).toBe(201);
    expect(mocks.rateLimitHits).toEqual([
      "api:default",
      "api:default",
      "ai:analyze",
    ]);
  });

  it("creates sessions and rejects malformed session requests", async () => {
    const valid = await request(app)
      .post("/api/v1/console/sessions")
      .send({ title: "Wallet Q&A", maxSensitivity: "wallet" });
    const invalid = await request(app)
      .post("/api/v1/console/sessions")
      .send({ title: "" });

    expect(valid.status).toBe(201);
    expect(valid.body.session).toEqual({ id: "session-1" });
    expect(mocks.createConsoleSession).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { userId: "user-1", username: "alice", isAdmin: true },
        title: "Wallet Q&A",
      }),
    );
    expect(invalid.status).toBe(400);
  });

  it("lists turns and runs turns with audit context", async () => {
    const turns = await request(app).get(
      "/api/v1/console/sessions/session-1/turns",
    );
    const run = await request(app)
      .post("/api/v1/console/turns")
      .send({
        prompt: "how long ago was block 840000?",
        clientContext: { mode: "auto" },
      });
    const invalidRun = await request(app)
      .post("/api/v1/console/turns")
      .send({ prompt: "" });

    expect(turns.status).toBe(200);
    expect(run.status).toBe(201);
    expect(invalidRun.status).toBe(400);
    expect(mocks.listConsoleTurns).toHaveBeenCalledWith(
      { userId: "user-1", username: "alice", isAdmin: true },
      "session-1",
    );
    expect(mocks.runConsoleTurn).toHaveBeenCalledWith(
      { userId: "user-1", username: "alice", isAdmin: true },
      expect.objectContaining({
        prompt: "how long ago was block 840000?",
        clientContext: { mode: "auto" },
      }),
      { ipAddress: "127.0.0.1", userAgent: "test-agent" },
    );
  });

  it("deletes selected sessions for the authenticated actor", async () => {
    const deleted = await request(app).delete(
      "/api/v1/console/sessions/session-1",
    );

    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ success: true });
    expect(mocks.deleteConsoleSession).toHaveBeenCalledWith(
      { userId: "user-1", username: "alice", isAdmin: true },
      "session-1",
    );
  });

  it("guards session and prompt clearing with authentication and the Console feature flag", async () => {
    mocks.authenticated = false;

    const unauthenticatedSessionClear = await request(app).delete(
      "/api/v1/console/sessions/session-1",
    );
    const unauthenticatedPromptClear = await request(app).delete(
      "/api/v1/console/prompts",
    );

    mocks.authenticated = true;
    mocks.featureEnabled = false;

    const disabledSessionClear = await request(app).delete(
      "/api/v1/console/sessions/session-1",
    );
    const disabledPromptClear = await request(app).delete(
      "/api/v1/console/prompts",
    );

    expect(unauthenticatedSessionClear.status).toBe(401);
    expect(unauthenticatedPromptClear.status).toBe(401);
    expect(disabledSessionClear.status).toBe(403);
    expect(disabledSessionClear.body).toMatchObject({
      feature: "sanctuaryConsole",
    });
    expect(disabledPromptClear.status).toBe(403);
    expect(disabledPromptClear.body).toMatchObject({
      feature: "sanctuaryConsole",
    });
    expect(mocks.deleteConsoleSession).not.toHaveBeenCalled();
    expect(mocks.clearPromptHistory).not.toHaveBeenCalled();
  });

  it("returns Console proxy timeout details from failed turns", async () => {
    mocks.runConsoleTurn.mockRejectedValueOnce(
      new ServiceUnavailableError(
        "AI proxy /console/plan request failed: The request took too long to process",
        "SERVICE_UNAVAILABLE",
        {
          path: "/console/plan",
          status: 408,
          proxyError: "The request took too long to process",
        },
      ),
    );

    const response = await request(app)
      .post("/api/v1/console/turns")
      .send({ prompt: "whats the current block?" });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message:
        "AI proxy /console/plan request failed: The request took too long to process",
      details: {
        path: "/console/plan",
        status: 408,
        proxyError: "The request took too long to process",
      },
    });
  });

  it("lists prompt history with strict boolean parsing and rejects invalid prompt queries", async () => {
    const valid = await request(app).get(
      "/api/v1/console/prompts?saved=false&includeExpired=1&search=fee",
    );
    const invalid = await request(app).get(
      "/api/v1/console/prompts?saved=definitely",
    );

    expect(valid.status).toBe(200);
    expect(mocks.listPromptHistory).toHaveBeenCalledWith(
      { userId: "user-1", username: "alice", isAdmin: true },
      expect.objectContaining({
        saved: false,
        includeExpired: true,
        search: "fee",
      }),
    );
    expect(invalid.status).toBe(400);
  });

  it("updates, deletes, clears, and replays prompt history", async () => {
    const patch = await request(app)
      .patch("/api/v1/console/prompts/prompt-1")
      .send({ saved: true, title: null });
    const invalidPatch = await request(app)
      .patch("/api/v1/console/prompts/prompt-1")
      .send({ title: "" });
    const deleted = await request(app).delete(
      "/api/v1/console/prompts/prompt-1",
    );
    const cleared = await request(app).delete("/api/v1/console/prompts");
    const replay = await request(app)
      .post("/api/v1/console/prompts/prompt-1/replay")
      .send({ clientContext: { mode: "auto" } });
    const invalidReplay = await request(app)
      .post("/api/v1/console/prompts/prompt-1/replay")
      .send({ maxSensitivity: "root" });

    expect(patch.status).toBe(200);
    expect(invalidPatch.status).toBe(400);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ success: true });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual({ success: true, deleted: 2 });
    expect(replay.status).toBe(201);
    expect(invalidReplay.status).toBe(400);
    expect(mocks.updatePromptHistory).toHaveBeenCalledWith(
      { userId: "user-1", username: "alice", isAdmin: true },
      "prompt-1",
      { saved: true, title: null },
    );
    expect(mocks.deletePromptHistory).toHaveBeenCalledWith(
      { userId: "user-1", username: "alice", isAdmin: true },
      "prompt-1",
    );
    expect(mocks.clearPromptHistory).toHaveBeenCalledWith({
      userId: "user-1",
      username: "alice",
      isAdmin: true,
    });
    expect(mocks.replayPromptHistory).toHaveBeenCalledWith(
      { userId: "user-1", username: "alice", isAdmin: true },
      "prompt-1",
      { clientContext: { mode: "auto" } },
      { ipAddress: "127.0.0.1", userAgent: "test-agent" },
    );
  });
});
