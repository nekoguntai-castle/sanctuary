import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const prisma = vi.hoisted(() => ({
  consoleSession: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  consoleTurn: {
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  consolePromptHistory: {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
  },
  consoleToolTrace: {
    create: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock("../../../src/models/prisma", () => ({
  __esModule: true,
  default: prisma,
}));

import { consoleRepository } from "../../../src/repositories/consoleRepository";

const userId = "user-1";
const sessionId = "session-1";
const turnId = "turn-1";
const promptId = "prompt-1";
const now = new Date("2026-04-26T00:00:00.000Z");

describe("consoleRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates, finds, lists, and updates sessions", async () => {
    const session = { id: sessionId, userId };
    (prisma.consoleSession.create as Mock).mockResolvedValue(session);
    (prisma.consoleSession.findFirst as Mock).mockResolvedValue(session);
    (prisma.consoleSession.findMany as Mock).mockResolvedValue([session]);
    (prisma.consoleSession.update as Mock).mockResolvedValue(session);

    await expect(
      consoleRepository.createSession({
        userId,
        title: undefined,
        scope: { kind: "general" },
        maxSensitivity: "wallet",
        expiresAt: undefined,
      }),
    ).resolves.toBe(session);
    await expect(
      consoleRepository.findSessionForUser(sessionId, userId),
    ).resolves.toBe(session);
    await expect(
      consoleRepository.listSessions(userId, 10, 5),
    ).resolves.toEqual([session]);
    await expect(
      consoleRepository.updateSessionScope(
        sessionId,
        { kind: "admin" },
        "admin",
      ),
    ).resolves.toBe(session);

    expect(prisma.consoleSession.create).toHaveBeenCalledWith({
      data: {
        userId,
        title: null,
        scope: { kind: "general" },
        maxSensitivity: "wallet",
        expiresAt: null,
      },
    });
    expect(prisma.consoleSession.findFirst).toHaveBeenCalledWith({
      where: { id: sessionId, userId, deletedAt: null },
    });
    expect(prisma.consoleSession.findMany).toHaveBeenCalledWith({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 10,
      skip: 5,
    });
  });

  it("soft deletes sessions and prompt history while list queries filter deleted rows", async () => {
    const deletedAt = new Date("2026-04-28T03:30:00.000Z");
    const session = { id: sessionId, userId, deletedAt };
    const prompt = { id: promptId, userId, prompt: "hello" };

    vi.useFakeTimers();
    vi.setSystemTime(deletedAt);
    try {
      (prisma.consoleSession.update as Mock).mockResolvedValue(session);
      (prisma.consoleSession.findMany as Mock).mockResolvedValue([]);
      (prisma.consolePromptHistory.updateMany as Mock).mockResolvedValue({
        count: 3,
      });
      (prisma.consolePromptHistory.findMany as Mock).mockResolvedValue([
        prompt,
      ]);

      await expect(
        consoleRepository.softDeleteSession(sessionId),
      ).resolves.toBe(session);
      await expect(
        consoleRepository.softDeletePromptsForUser(userId),
      ).resolves.toBe(3);
      await expect(
        consoleRepository.listSessions(userId, 10, 0),
      ).resolves.toEqual([]);
      await expect(
        consoleRepository.listPrompts(userId, { includeExpired: true }, 10, 0),
      ).resolves.toEqual([prompt]);

      expect(prisma.consoleSession.update).toHaveBeenCalledWith({
        where: { id: sessionId },
        data: { deletedAt },
      });
      expect(prisma.consolePromptHistory.updateMany).toHaveBeenCalledWith({
        where: { userId, deletedAt: null },
        data: { deletedAt, saved: false },
      });
      expect(prisma.consoleSession.findMany).toHaveBeenCalledWith({
        where: { userId, deletedAt: null },
        orderBy: { updatedAt: "desc" },
        take: 10,
        skip: 0,
      });
      expect(prisma.consolePromptHistory.findMany).toHaveBeenCalledWith({
        where: { userId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 10,
        skip: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates and completes turns, attaches prompt history, and lists traces", async () => {
    const turn = { id: turnId, sessionId };
    (prisma.consoleTurn.create as Mock).mockResolvedValue(turn);
    (prisma.consoleTurn.update as Mock).mockResolvedValue(turn);
    (prisma.consoleTurn.findMany as Mock).mockResolvedValue([
      { ...turn, toolTraces: [] },
    ]);

    await expect(
      consoleRepository.createTurn({
        sessionId,
        prompt: "hello",
        scope: { kind: "general" },
        maxSensitivity: "wallet",
        state: "accepted",
      }),
    ).resolves.toBe(turn);
    await expect(
      consoleRepository.updateTurnState(turnId, "planning"),
    ).resolves.toBe(turn);
    await expect(
      consoleRepository.completeTurn({
        id: turnId,
        response: "answer",
        providerProfileId: undefined,
        model: undefined,
        plannedTools: { toolCalls: [] },
      }),
    ).resolves.toBe(turn);
    await expect(
      consoleRepository.failTurn(turnId, { message: "failed" }),
    ).resolves.toBe(turn);
    await expect(
      consoleRepository.attachPromptToTurn(turnId, promptId),
    ).resolves.toBe(turn);
    await expect(consoleRepository.listTurns(sessionId, 20)).resolves.toEqual([
      { ...turn, toolTraces: [] },
    ]);

    expect(prisma.consoleTurn.create).toHaveBeenCalledWith({
      data: {
        sessionId,
        prompt: "hello",
        scope: { kind: "general" },
        maxSensitivity: "wallet",
        state: "accepted",
      },
    });
    expect(prisma.consoleTurn.findMany).toHaveBeenCalledWith({
      where: { sessionId },
      include: { toolTraces: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
  });

  it("creates, filters, updates, deletes, and replays prompt history", async () => {
    const prompt = { id: promptId, userId, prompt: "hello" };
    (prisma.consolePromptHistory.create as Mock).mockResolvedValue(prompt);
    (prisma.consolePromptHistory.findMany as Mock).mockResolvedValue([prompt]);
    (prisma.consolePromptHistory.findFirst as Mock).mockResolvedValue(prompt);
    (prisma.consolePromptHistory.update as Mock).mockResolvedValue(prompt);

    await expect(
      consoleRepository.createPrompt({
        userId,
        sessionId: undefined,
        turnId: undefined,
        prompt: "hello",
        normalizedPrompt: "hello",
        scope: { kind: "general" },
        maxSensitivity: "wallet",
        expiresAt: undefined,
      }),
    ).resolves.toBe(prompt);
    await expect(
      consoleRepository.listPrompts(
        userId,
        {
          search: "hello",
          saved: false,
          includeExpired: false,
          now,
        },
        25,
        2,
      ),
    ).resolves.toEqual([prompt]);
    await expect(
      consoleRepository.listPrompts(
        userId,
        {
          includeExpired: true,
        },
        5,
        0,
      ),
    ).resolves.toEqual([prompt]);
    await expect(
      consoleRepository.findPromptForUser(promptId, userId, now),
    ).resolves.toBe(prompt);
    await expect(
      consoleRepository.updatePrompt({
        id: promptId,
        saved: true,
        title: null,
        expiresAt: null,
      }),
    ).resolves.toBe(prompt);
    await expect(
      consoleRepository.updatePrompt({
        id: promptId,
        saved: undefined,
        title: undefined,
        expiresAt: undefined,
      }),
    ).resolves.toBe(prompt);
    await expect(
      consoleRepository.updatePromptMetadata({
        id: promptId,
        tools: ["get_fee_estimates"],
        providerProfileId: undefined,
        model: undefined,
      }),
    ).resolves.toBe(prompt);
    await expect(consoleRepository.softDeletePrompt(promptId)).resolves.toBe(
      prompt,
    );
    await expect(consoleRepository.markPromptReplayed(promptId)).resolves.toBe(
      prompt,
    );

    expect(prisma.consolePromptHistory.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        userId,
        deletedAt: null,
        saved: false,
        normalizedPrompt: { contains: "hello" },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: "desc" },
      take: 25,
      skip: 2,
    });
    expect(prisma.consolePromptHistory.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        userId,
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      skip: 0,
    });
    expect(prisma.consolePromptHistory.update).toHaveBeenCalledWith({
      where: { id: promptId },
      data: { saved: true, title: null, expiresAt: null },
    });
    expect(prisma.consolePromptHistory.update).toHaveBeenCalledWith({
      where: { id: promptId },
      data: {},
    });
  });

  it("stores tool traces, purges expired prompts, and reports support stats", async () => {
    const trace = { id: "trace-1", turnId };
    (prisma.consoleToolTrace.create as Mock).mockResolvedValue(trace);
    (prisma.consolePromptHistory.updateMany as Mock).mockResolvedValue({
      count: 2,
    });
    (prisma.consoleSession.count as Mock).mockResolvedValue(3);
    (prisma.consoleTurn.count as Mock).mockResolvedValue(4);
    (prisma.consolePromptHistory.count as Mock)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(7);
    (prisma.consoleToolTrace.count as Mock).mockResolvedValue(8);

    await expect(
      consoleRepository.createToolTrace({
        turnId,
        toolName: "get_fee_estimates",
        status: "completed",
        input: {},
        facts: { summary: "fees" },
        sensitivity: "public",
        rowCount: null,
      }),
    ).resolves.toBe(trace);
    await expect(
      consoleRepository.purgeExpiredPromptHistory(now),
    ).resolves.toBe(2);
    await expect(consoleRepository.getSupportStats(now)).resolves.toEqual({
      consoleSessionCount: 3,
      consoleTurnCount: 4,
      consolePromptCount: 5,
      consoleSavedPromptCount: 6,
      consoleExpiredPromptCount: 7,
      consoleToolTraceCount: 8,
    });

    expect(prisma.consoleToolTrace.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        toolName: "get_fee_estimates",
        facts: { summary: "fees" },
      }),
    });
    expect(prisma.consolePromptHistory.updateMany).toHaveBeenCalledWith({
      where: { deletedAt: null, expiresAt: { lte: now }, saved: false },
      data: { deletedAt: now },
    });
  });
});
