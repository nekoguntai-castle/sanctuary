import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../errors/errorHandler";
import { authenticate, requireAuthenticatedUser } from "../middleware/auth";
import { requireFeature } from "../middleware/featureGate";
import { rateLimitByUser } from "../middleware/rateLimit";
import { getClientInfo } from "../services/auditService";
import {
  ConsoleCreateSessionBodySchema,
  ConsolePromptListQuerySchema,
  ConsolePromptReplayBodySchema,
  ConsolePromptUpdateBodySchema,
  ConsoleRunTurnBodySchema,
} from "../assistant/console/protocol";
import {
  clearPromptHistory,
  createConsoleSession,
  deleteConsoleSession,
  deletePromptHistory,
  listConsoleSessions,
  listConsoleTools,
  listConsoleTurns,
  listPromptHistory,
  replayPromptHistory,
  runConsoleTurn,
  updatePromptHistory,
} from "../assistant/console/service";
import type { AssistantToolActor } from "../assistant/tools";

const router = Router();
const consoleRouteLimiter = rateLimitByUser("api:default");
const consoleTurnLimiter = rateLimitByUser("ai:analyze");
const ConsoleSessionListQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .catch(20)
    .transform((value) => Math.max(1, Math.min(value, 100))),
  offset: z.coerce
    .number()
    .int()
    .catch(0)
    .transform((value) => Math.max(0, value)),
});

router.use(authenticate);
router.use(consoleRouteLimiter);
router.use(requireFeature("sanctuaryConsole"));

function actorFromRequest(
  req: Parameters<typeof requireAuthenticatedUser>[0],
): AssistantToolActor {
  const user = requireAuthenticatedUser(req);
  return {
    userId: user.userId,
    username: user.username,
    isAdmin: Boolean(user.isAdmin),
  };
}

function auditContextFromRequest(req: Parameters<typeof getClientInfo>[0]) {
  return getClientInfo(req);
}

router.get(
  "/tools",
  asyncHandler(async (req, res) => {
    res.json({ tools: listConsoleTools(actorFromRequest(req)) });
  }),
);

router.get(
  "/sessions",
  asyncHandler(async (req, res) => {
    const { limit, offset } = ConsoleSessionListQuerySchema.parse(req.query);
    const sessions = await listConsoleSessions(
      actorFromRequest(req),
      limit,
      offset,
    );
    res.json({ sessions });
  }),
);

router.post(
  "/sessions",
  consoleTurnLimiter,
  asyncHandler(async (req, res) => {
    const body = ConsoleCreateSessionBodySchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: "Invalid console session request" });
    }

    const session = await createConsoleSession({
      actor: actorFromRequest(req),
      ...body.data,
    });
    res.status(201).json({ session });
  }),
);

router.get(
  "/sessions/:id/turns",
  asyncHandler(async (req, res) => {
    const turns = await listConsoleTurns(actorFromRequest(req), req.params.id);
    res.json({ turns });
  }),
);

router.delete(
  "/sessions/:id",
  asyncHandler(async (req, res) => {
    await deleteConsoleSession(actorFromRequest(req), req.params.id);
    res.json({ success: true });
  }),
);

router.post(
  "/turns",
  consoleTurnLimiter,
  asyncHandler(async (req, res) => {
    const body = ConsoleRunTurnBodySchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: "Invalid console turn request" });
    }

    const result = await runConsoleTurn(
      actorFromRequest(req),
      body.data,
      auditContextFromRequest(req),
    );
    res.status(201).json(result);
  }),
);

router.get(
  "/prompts",
  asyncHandler(async (req, res) => {
    const query = ConsolePromptListQuerySchema.safeParse(req.query);
    if (!query.success) {
      return res.status(400).json({ error: "Invalid console prompt query" });
    }

    const prompts = await listPromptHistory(actorFromRequest(req), query.data);
    res.json({ prompts });
  }),
);

router.patch(
  "/prompts/:id",
  asyncHandler(async (req, res) => {
    const body = ConsolePromptUpdateBodySchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: "Invalid console prompt update" });
    }

    const prompt = await updatePromptHistory(
      actorFromRequest(req),
      req.params.id,
      body.data,
    );
    res.json({ prompt });
  }),
);

router.delete(
  "/prompts/:id",
  asyncHandler(async (req, res) => {
    await deletePromptHistory(actorFromRequest(req), req.params.id);
    res.json({ success: true });
  }),
);

router.delete(
  "/prompts",
  asyncHandler(async (req, res) => {
    const deleted = await clearPromptHistory(actorFromRequest(req));
    res.json({ success: true, deleted });
  }),
);

router.post(
  "/prompts/:id/replay",
  consoleTurnLimiter,
  asyncHandler(async (req, res) => {
    const body = ConsolePromptReplayBodySchema.safeParse(req.body);
    if (!body.success) {
      return res
        .status(400)
        .json({ error: "Invalid console prompt replay request" });
    }

    const result = await replayPromptHistory(
      actorFromRequest(req),
      req.params.id,
      body.data,
      auditContextFromRequest(req),
    );
    res.status(201).json(result);
  }),
);

export default router;
