import { Request, Response, NextFunction } from 'express';
import { authenticateAgentRequest, type AgentRequestContext } from '../agent/auth';
import { UnauthorizedError } from '../errors/ApiError';

declare global {
  namespace Express {
    interface Request {
      agentContext?: AgentRequestContext;
    }
  }
}

export async function authenticateAgent(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    req.agentContext = await authenticateAgentRequest(req);
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAgentContext(req: Request): AgentRequestContext {
  if (!req.agentContext) {
    throw new UnauthorizedError('Agent authentication required');
  }
  return req.agentContext;
}
