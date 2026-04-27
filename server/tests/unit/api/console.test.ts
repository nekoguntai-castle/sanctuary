import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { errorHandler } from "../../../src/errors/errorHandler";

const mocks = vi.hoisted(() => {
  const rateLimitHits: string[] = [];

  return {
    listConsoleTools: vi.fn(),
    createConsoleSession: vi.fn(),
    listConsoleSessions: vi.fn(),
    listConsoleTurns: vi.fn(),
    runConsoleTurn: vi.fn(),
    listPromptHistory: vi.fn(),
    updatePromptHistory: vi.fn(),
    deletePromptHistory: vi.fn(),
    replayPromptHistory: vi.fn(),
    rateLimitHits,
    rateLimitByUser: vi.fn(
      (policyName: string) => (_req: any, _res: any, next: () => void) => {
        rateLimitHits.push(policyName);
        next();
      },
    ),
  };
});

vi.mock("../../../src/middleware/auth", () => ({
  authenticate: (req: any, _res: any, next: () => void) => {
    req.user = { userId: "user-1", username: "alice", isAdmin: true };
    next();
  },
  requireAuthenticatedUser: (req: any) => req.user,
}));

vi.mock("../../../src/middleware/featureGate", () => ({
  requireFeature: () => (_req: any, _res: any, next: () => void) => next(),
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
    mocks.listConsoleTools.mockReturnValue([{ name: "get_fee_estimates" }]);
    mocks.listConsoleSessions.mockResolvedValue([{ id: "session-1" }]);
    mocks.createConsoleSession.mockResolvedValue({ id: "session-1" });
    mocks.listConsoleTurns.mockResolvedValue([{ id: "turn-1" }]);
    mocks.runConsoleTurn.mockResolvedValue({ turn: { id: "turn-1" } });
    mocks.listPromptHistory.mockResolvedValue([{ id: "prompt-1" }]);
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

  it("updates, deletes, and replays prompt history", async () => {
    const patch = await request(app)
      .patch("/api/v1/console/prompts/prompt-1")
      .send({ saved: true, title: null });
    const invalidPatch = await request(app)
      .patch("/api/v1/console/prompts/prompt-1")
      .send({ title: "" });
    const deleted = await request(app).delete(
      "/api/v1/console/prompts/prompt-1",
    );
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
    expect(mocks.replayPromptHistory).toHaveBeenCalledWith(
      { userId: "user-1", username: "alice", isAdmin: true },
      "prompt-1",
      { clientContext: { mode: "auto" } },
      { ipAddress: "127.0.0.1", userAgent: "test-agent" },
    );
  });
});
