/**
 * Resource Access Middleware Factory
 *
 * Generic factory for creating resource-level access middleware.
 * Eliminates structural duplication between walletAccess.ts and deviceAccess.ts.
 *
 * The factory takes one async role lookup (`getRole`) and a set of
 * synchronous predicates that decide whether a given role satisfies each
 * access level. The middleware calls `getRole` exactly once per request,
 * then derives allow/deny via the predicate — avoiding the
 * earlier pattern of one boolean-returning check function plus a second
 * role lookup, which issued redundant DB queries on resource paths that
 * lacked a role cache (notably device routes).
 */

import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';

interface ResourceAccessConfig<TLevel extends string, TRole> {
  /** Display name for error messages (e.g., "Wallet", "Device") */
  resourceName: string;
  /** Logger namespace (e.g., "MW:WALLET_ACCESS") */
  loggerName: string;
  /** Route param names to check for the resource ID, in priority order */
  paramNames: string[];
  /** Fetch the user's role for the resource; `null` means "no access at all". */
  getRole: (id: string, userId: string) => Promise<TRole>;
  /**
   * Synchronous predicates: given the role the user actually has, does it
   * satisfy the access level being requested? Predicates run against the
   * result of `getRole` with no additional DB calls.
   */
  predicates: Record<TLevel, (role: TRole) => boolean>;
  /** Attach the resource ID and role to the request object */
  attachToRequest: (req: Request, id: string, role: TRole) => void;
}

export function createResourceAccessMiddleware<TLevel extends string, TRole>(
  config: ResourceAccessConfig<TLevel, TRole>,
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
        const role = await config.getRole(resourceId, userId);
        const predicate = config.predicates[level];
        const hasAccess = predicate(role);

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
