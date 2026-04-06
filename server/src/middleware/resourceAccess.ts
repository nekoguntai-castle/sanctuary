/**
 * Resource Access Middleware Factory
 *
 * Generic factory for creating resource-level access middleware.
 * Eliminates structural duplication between walletAccess.ts and deviceAccess.ts.
 */

import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';

interface ResourceAccessConfig<TLevel extends string> {
  /** Display name for error messages (e.g., "Wallet", "Device") */
  resourceName: string;
  /** Logger namespace (e.g., "MW:WALLET_ACCESS") */
  loggerName: string;
  /** Route param names to check for the resource ID, in priority order */
  paramNames: string[];
  /** Map of access levels to their check functions (each returns boolean) */
  checks: Record<TLevel, (id: string, userId: string) => Promise<boolean>>;
  /** Get the user's role for the resource (called after access is confirmed) */
  getRole: (id: string, userId: string) => Promise<unknown>;
  /** Attach the resource ID and role to the request object */
  attachToRequest: (req: Request, id: string, role: unknown) => void;
}

export function createResourceAccessMiddleware<TLevel extends string>(
  config: ResourceAccessConfig<TLevel>,
) {
  const log = createLogger(config.loggerName);
  const resourceLower = config.resourceName.toLowerCase();

  return function requireAccess(level: TLevel) {
    return async (req: Request, res: Response, next: NextFunction) => {
      const resourceId = config.paramNames
        .map((name) => req.params[name] as string)
        .find(Boolean);
      const userId = req.user?.userId;

      if (!resourceId) {
        log.warn(`${config.resourceName} access check failed: no ${resourceLower} ID`, {
          path: req.path,
        });
        return res.status(400).json({
          error: 'Bad Request',
          message: `${config.resourceName} ID is required`,
        });
      }

      if (!userId) {
        log.warn(`${config.resourceName} access check failed: no user ID`, {
          [`${resourceLower}Id`]: resourceId,
        });
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
      }

      try {
        const checkFn = config.checks[level];
        const hasAccess = await checkFn(resourceId, userId);

        if (!hasAccess) {
          log.warn(`${config.resourceName} access denied`, {
            [`${resourceLower}Id`]: resourceId,
            userId,
            requiredLevel: level,
          });
          return res.status(403).json({
            error: 'Forbidden',
            message: `You do not have permission to access this ${resourceLower}`,
          });
        }

        const role = await config.getRole(resourceId, userId);
        config.attachToRequest(req, resourceId, role);

        next();
      } catch (error) {
        log.error(`${config.resourceName} access check error`, {
          [`${resourceLower}Id`]: resourceId,
          userId,
          error,
        });
        return res.status(500).json({
          error: 'Internal Server Error',
          message: `Failed to verify ${resourceLower} access`,
        });
      }
    };
  };
}
