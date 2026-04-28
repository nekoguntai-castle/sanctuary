import type {
  ConsolePromptHistory,
  ConsoleSession,
  ConsoleToolTrace,
  ConsoleTurn,
  Prisma,
} from "../generated/prisma/client";
import prisma from "../models/prisma";

export type ConsoleTurnWithTraces = ConsoleTurn & {
  toolTraces: ConsoleToolTrace[];
};

export interface CreateConsoleSessionInput {
  userId: string;
  title?: string | null;
  scope?: Prisma.InputJsonValue;
  maxSensitivity: string;
  expiresAt?: Date | null;
}

export interface CreateConsoleTurnInput {
  sessionId: string;
  prompt: string;
  scope?: Prisma.InputJsonValue;
  maxSensitivity: string;
  state: string;
}

export interface CreateConsolePromptInput {
  userId: string;
  sessionId?: string | null;
  turnId?: string | null;
  prompt: string;
  normalizedPrompt: string;
  scope?: Prisma.InputJsonValue;
  maxSensitivity: string;
  expiresAt?: Date | null;
}

export interface CreateConsoleToolTraceInput {
  turnId: string;
  toolName: string;
  status: string;
  input?: Prisma.InputJsonValue;
  facts?: Prisma.InputJsonValue;
  provenance?: Prisma.InputJsonValue;
  redactions?: Prisma.InputJsonValue;
  truncation?: Prisma.InputJsonValue;
  warnings?: Prisma.InputJsonValue;
  sensitivity?: string | null;
  rowCount?: number | null;
  walletCount?: number | null;
  durationMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface PromptHistoryFilters {
  search?: string;
  saved?: boolean;
  includeExpired?: boolean;
  now?: Date;
}

function activePromptWhere(
  userId: string,
  filters: PromptHistoryFilters = {},
): Prisma.ConsolePromptHistoryWhereInput {
  const now = filters.now ?? new Date();
  return {
    userId,
    deletedAt: null,
    ...(filters.saved === undefined ? {} : { saved: filters.saved }),
    ...(filters.search
      ? { normalizedPrompt: { contains: filters.search } }
      : {}),
    ...(filters.includeExpired
      ? {}
      : { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }),
  };
}

async function createSession(
  input: CreateConsoleSessionInput,
): Promise<ConsoleSession> {
  return prisma.consoleSession.create({
    data: {
      userId: input.userId,
      title: input.title ?? null,
      scope: input.scope,
      maxSensitivity: input.maxSensitivity,
      expiresAt: input.expiresAt ?? null,
    },
  });
}

async function findSessionForUser(
  id: string,
  userId: string,
): Promise<ConsoleSession | null> {
  return prisma.consoleSession.findFirst({
    where: { id, userId, deletedAt: null },
  });
}

async function listSessions(
  userId: string,
  limit: number,
  offset: number,
): Promise<ConsoleSession[]> {
  return prisma.consoleSession.findMany({
    where: { userId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: limit,
    skip: offset,
  });
}

async function softDeleteSession(id: string): Promise<ConsoleSession> {
  return prisma.consoleSession.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

async function softDeletePromptsForUser(userId: string): Promise<number> {
  const result = await prisma.consolePromptHistory.updateMany({
    where: { userId, deletedAt: null },
    data: { deletedAt: new Date(), saved: false },
  });
  return result.count;
}

async function updateSessionScope(
  id: string,
  scope: Prisma.InputJsonValue,
  maxSensitivity: string,
): Promise<ConsoleSession> {
  return prisma.consoleSession.update({
    where: { id },
    data: { scope, maxSensitivity },
  });
}

async function createTurn(input: CreateConsoleTurnInput): Promise<ConsoleTurn> {
  return prisma.consoleTurn.create({
    data: {
      sessionId: input.sessionId,
      prompt: input.prompt,
      scope: input.scope,
      maxSensitivity: input.maxSensitivity,
      state: input.state,
    },
  });
}

async function updateTurnState(
  id: string,
  state: string,
): Promise<ConsoleTurn> {
  return prisma.consoleTurn.update({ where: { id }, data: { state } });
}

async function completeTurn(input: {
  id: string;
  response: string;
  providerProfileId?: string | null;
  model?: string | null;
  plannedTools?: Prisma.InputJsonValue;
}): Promise<ConsoleTurn> {
  return prisma.consoleTurn.update({
    where: { id: input.id },
    data: {
      state: "completed",
      response: input.response,
      providerProfileId: input.providerProfileId ?? null,
      model: input.model ?? null,
      plannedTools: input.plannedTools,
      completedAt: new Date(),
    },
  });
}

async function failTurn(
  id: string,
  error: Prisma.InputJsonValue,
): Promise<ConsoleTurn> {
  return prisma.consoleTurn.update({
    where: { id },
    data: { state: "failed", error, completedAt: new Date() },
  });
}

async function listTurns(
  sessionId: string,
  limit: number,
): Promise<ConsoleTurnWithTraces[]> {
  return prisma.consoleTurn.findMany({
    where: { sessionId },
    include: { toolTraces: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

async function createPrompt(
  input: CreateConsolePromptInput,
): Promise<ConsolePromptHistory> {
  return prisma.consolePromptHistory.create({
    data: {
      userId: input.userId,
      sessionId: input.sessionId ?? null,
      turnId: input.turnId ?? null,
      prompt: input.prompt,
      normalizedPrompt: input.normalizedPrompt,
      scope: input.scope,
      maxSensitivity: input.maxSensitivity,
      expiresAt: input.expiresAt ?? null,
    },
  });
}

async function attachPromptToTurn(
  turnId: string,
  promptHistoryId: string,
): Promise<ConsoleTurn> {
  return prisma.consoleTurn.update({
    where: { id: turnId },
    data: { promptHistoryId },
  });
}

async function updatePromptMetadata(input: {
  id: string;
  tools?: Prisma.InputJsonValue;
  providerProfileId?: string | null;
  model?: string | null;
}): Promise<ConsolePromptHistory> {
  return prisma.consolePromptHistory.update({
    where: { id: input.id },
    data: {
      tools: input.tools,
      providerProfileId: input.providerProfileId ?? null,
      model: input.model ?? null,
    },
  });
}

async function listPrompts(
  userId: string,
  filters: PromptHistoryFilters,
  limit: number,
  offset: number,
): Promise<ConsolePromptHistory[]> {
  return prisma.consolePromptHistory.findMany({
    where: activePromptWhere(userId, filters),
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });
}

async function findPromptForUser(
  id: string,
  userId: string,
  now = new Date(),
): Promise<ConsolePromptHistory | null> {
  return prisma.consolePromptHistory.findFirst({
    where: {
      id,
      userId,
      deletedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });
}

async function updatePrompt(input: {
  id: string;
  saved?: boolean;
  title?: string | null;
  expiresAt?: Date | null;
}): Promise<ConsolePromptHistory> {
  return prisma.consolePromptHistory.update({
    where: { id: input.id },
    data: {
      ...(input.saved === undefined ? {} : { saved: input.saved }),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    },
  });
}

async function softDeletePrompt(id: string): Promise<ConsolePromptHistory> {
  return prisma.consolePromptHistory.update({
    where: { id },
    data: { deletedAt: new Date(), saved: false },
  });
}

async function markPromptReplayed(id: string): Promise<ConsolePromptHistory> {
  return prisma.consolePromptHistory.update({
    where: { id },
    data: { replayCount: { increment: 1 }, lastReplayedAt: new Date() },
  });
}

async function createToolTrace(
  input: CreateConsoleToolTraceInput,
): Promise<ConsoleToolTrace> {
  return prisma.consoleToolTrace.create({ data: input });
}

async function purgeExpiredPromptHistory(now = new Date()): Promise<number> {
  const result = await prisma.consolePromptHistory.updateMany({
    where: { deletedAt: null, expiresAt: { lte: now }, saved: false },
    data: { deletedAt: now },
  });
  return result.count;
}

async function getSupportStats(now = new Date()) {
  const [
    sessionCount,
    turnCount,
    promptCount,
    savedPromptCount,
    expiredPromptCount,
    traceCount,
  ] = await Promise.all([
    prisma.consoleSession.count(),
    prisma.consoleTurn.count(),
    prisma.consolePromptHistory.count({ where: { deletedAt: null } }),
    prisma.consolePromptHistory.count({
      where: { deletedAt: null, saved: true },
    }),
    prisma.consolePromptHistory.count({
      where: { deletedAt: null, expiresAt: { lte: now } },
    }),
    prisma.consoleToolTrace.count(),
  ]);

  return {
    consoleSessionCount: sessionCount,
    consoleTurnCount: turnCount,
    consolePromptCount: promptCount,
    consoleSavedPromptCount: savedPromptCount,
    consoleExpiredPromptCount: expiredPromptCount,
    consoleToolTraceCount: traceCount,
  };
}

export const consoleRepository = {
  createSession,
  findSessionForUser,
  listSessions,
  softDeleteSession,
  softDeletePromptsForUser,
  updateSessionScope,
  createTurn,
  updateTurnState,
  completeTurn,
  failTurn,
  listTurns,
  createPrompt,
  attachPromptToTurn,
  updatePromptMetadata,
  listPrompts,
  findPromptForUser,
  updatePrompt,
  softDeletePrompt,
  markPromptReplayed,
  createToolTrace,
  purgeExpiredPromptHistory,
  getSupportStats,
};

export default consoleRepository;
