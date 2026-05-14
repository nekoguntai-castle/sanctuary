import type { Express, Request, Response } from 'express';
import expressRateLimit from 'express-rate-limit';
import { callExternalAI } from './aiClient';
import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from './constants';
import type { Logger } from './logger';
import {
  QueryBodySchema,
  SuggestLabelBodySchema,
  parseRequestBody,
} from './requestSchemas';
import { convertNaturalQuery } from './naturalQuery';
import {
  fetchTransactionContext,
  fetchWalletContext,
  fetchWalletLabels,
} from './backendContextClient';
import type { GetAiConfig } from './llmEgressProxyRuntime';

interface LabelQueryRouteDeps {
  backendUrl: string;
  getAiConfig: GetAiConfig;
  log: Logger;
}

const authTokenFromRequest = (req: Request): string =>
  req.headers.authorization?.replace('Bearer ', '') || '';

const aiRequestRateLimit = expressRateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: false,
  legacyHeaders: false,
  handler: (_req, res) => {
    const retryAfter = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);
    return res.status(429).json({
      error: `Rate limit exceeded. AI requests are limited to ${RATE_LIMIT_MAX_REQUESTS} per minute. Please wait ${retryAfter}s before trying again.`,
      retryAfter,
    });
  },
});

export function registerLabelQueryRoutes(
  app: Express,
  deps: LabelQueryRouteDeps,
) {
  app.post(
    '/suggest-label',
    aiRequestRateLimit,
    async (req: Request, res: Response) => {
      const body = parseRequestBody(
        SuggestLabelBodySchema,
        req,
        res,
        'transactionId required',
      );
      if (!body) return;

      const { transactionId } = body;
      const authToken = authTokenFromRequest(req);
      const aiConfig = deps.getAiConfig();

      if (!aiConfig.enabled) {
        return res.status(503).json({ error: 'AI is not enabled' });
      }

      const txResult = await fetchTransactionContext(
        deps.backendUrl,
        transactionId,
        authToken,
      );

      if (!txResult.success) {
        if (txResult.error === 'auth_failed') {
          deps.log.warn('Auth validation failed for suggest-label', {
            status: txResult.status,
          });
          return res
            .status(txResult.status || 401)
            .json({ error: 'Authentication failed' });
        }
        if (txResult.error === 'not_found') {
          return res.status(404).json({ error: 'Transaction not found' });
        }
        return res
          .status(502)
          .json({ error: 'Failed to fetch transaction data' });
      }

      const txContext = txResult.data;
      const labelsResult = await fetchWalletLabels(
        deps.backendUrl,
        txContext.walletId,
        authToken,
      );

      if (!labelsResult.success && labelsResult.error === 'auth_failed') {
        deps.log.warn('Auth validation failed for wallet labels', {
          status: labelsResult.status,
        });
        return res
          .status(labelsResult.status || 401)
          .json({ error: 'Authentication failed' });
      }

      const existingLabels = labelsResult.success
        ? labelsResult.data?.labels || []
        : [];

      const prompt = `You are a Bitcoin transaction categorizer. Based on the transaction details, suggest a short label (1-4 words).

Transaction:
- Amount: ${txContext.amount} sats (${txContext.direction})
- Date: ${txContext.date}
- Existing labels in wallet: ${existingLabels.length > 0 ? existingLabels.join(', ') : 'None'}

Respond with ONLY the suggested label, nothing else.
Examples: "Exchange Deposit", "Hardware Purchase", "Salary", "Gift"`;

      const suggestion = await callExternalAI(aiConfig, prompt);

      if (!suggestion) {
        return res.status(503).json({ error: 'AI endpoint not available' });
      }

      let label = suggestion.replace(/^["']|["']$/g, '').trim();
      if (label.length > 50) {
        label = label.substring(0, 50);
      }

      res.json({ suggestion: label });
    },
  );

  app.post(
    '/query',
    aiRequestRateLimit,
    async (req: Request, res: Response) => {
      const body = parseRequestBody(
        QueryBodySchema,
        req,
        res,
        'query and walletId required',
      );
      if (!body) return;

      const { query, walletId } = body;
      const authToken = authTokenFromRequest(req);
      const aiConfig = deps.getAiConfig();

      if (!aiConfig.enabled) {
        return res.status(503).json({ error: 'AI is not enabled' });
      }

      const contextResult = await fetchWalletContext(
        deps.backendUrl,
        walletId,
        authToken,
      );

      if (!contextResult.success) {
        if (contextResult.error === 'auth_failed') {
          deps.log.warn('Auth validation failed for query', {
            status: contextResult.status,
          });
          return res
            .status(contextResult.status || 401)
            .json({ error: 'Authentication failed' });
        }
        if (contextResult.error === 'not_found') {
          return res.status(404).json({ error: 'Wallet not found' });
        }
        return res.status(502).json({ error: 'Failed to fetch wallet data' });
      }

      const recentLabels = contextResult.data?.labels?.join(', ') || 'None';

      const conversion = await convertNaturalQuery({
        aiConfig,
        query,
        walletId,
        recentLabels,
      });

      if (!conversion.ok) {
        if (conversion.preview) {
          deps.log.error('Failed to parse AI natural query response', {
            preview: conversion.preview,
          });
        }
        return res.status(conversion.status).json({ error: conversion.error });
      }

      res.json({ query: conversion.query });
    },
  );

  app.post(
    '/test',
    aiRequestRateLimit,
    async (_req: Request, res: Response) => {
      const aiConfig = deps.getAiConfig();
      if (!aiConfig.enabled || !aiConfig.endpoint || !aiConfig.model) {
        return res.json({
          available: false,
          error: 'AI not configured',
        });
      }

      const result = await callExternalAI(aiConfig, 'Say "OK"', 10000);

      res.json({
        available: result !== null,
        model: aiConfig.model,
        error: result === null ? 'AI endpoint not reachable' : undefined,
      });
    },
  );
}
