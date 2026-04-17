/**
 * Audit Service
 *
 * Logs security-relevant events for compliance and troubleshooting.
 * All admin actions, authentication events, and sensitive operations
 * are recorded with user context, IP address, and details.
 *
 * Categories:
 *   - auth: Login, logout, failed login attempts
 *   - user: User creation, modification, deletion
 *   - wallet: Wallet creation, sharing, deletion
 *   - device: Device registration, removal
 *   - admin: Admin settings changes, node config
 *   - backup: Backup creation, restore operations
 *   - mcp: Model Context Protocol access and key operations
 *   - wallet: Also includes agent funding draft submissions
 *   - system: System settings changes
 */

import { auditLogRepository } from '../repositories';
import type { AuditCategory as RepoAuditCategory } from '../repositories/auditLogRepository';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { Request } from 'express';
import {
  AUDIT_DEFAULT_PAGE_SIZE,
  AUDIT_USER_LOG_LIMIT,
  AUDIT_FAILED_LOGIN_LIMIT,
  AUDIT_STATS_DAYS,
} from '../constants';

const log = createLogger('AUDIT:SVC');

/**
 * Audit event categories
 */
export enum AuditCategory {
  AUTH = 'auth',
  USER = 'user',
  WALLET = 'wallet',
  DEVICE = 'device',
  ADMIN = 'admin',
  BACKUP = 'backup',
  MCP = 'mcp',
  SYSTEM = 'system',
}

/**
 * Common audit actions
 */
export enum AuditAction {
  // Auth
  LOGIN = 'auth.login',
  LOGIN_FAILED = 'auth.login_failed',
  LOGOUT = 'auth.logout',
  PASSWORD_CHANGE = 'auth.password_change',

  // User management
  USER_CREATE = 'user.create',
  USER_UPDATE = 'user.update',
  USER_DELETE = 'user.delete',
  USER_ADMIN_GRANT = 'user.admin_grant',
  USER_ADMIN_REVOKE = 'user.admin_revoke',

  // Wallet management
  WALLET_CREATE = 'wallet.create',
  WALLET_DELETE = 'wallet.delete',
  WALLET_SHARE = 'wallet.share',
  WALLET_UNSHARE = 'wallet.unshare',
  WALLET_EXPORT = 'wallet.export',

  // Device management
  DEVICE_REGISTER = 'device.register',
  DEVICE_DELETE = 'device.delete',
  DEVICE_UPDATE = 'device.update',

  // Admin operations
  NODE_CONFIG_UPDATE = 'admin.node_config_update',
  NODE_CONFIG_CREATE = 'admin.node_config_create',
  NODE_CONFIG_DELETE = 'admin.node_config_delete',
  SYSTEM_SETTING_UPDATE = 'admin.system_setting_update',
  ENCRYPTION_KEYS_VIEW = 'admin.encryption_keys_view',

  // Group management
  GROUP_CREATE = 'admin.group_create',
  GROUP_DELETE = 'admin.group_delete',
  GROUP_MEMBER_ADD = 'admin.group_member_add',
  GROUP_MEMBER_REMOVE = 'admin.group_member_remove',

  // Backup operations
  BACKUP_CREATE = 'backup.create',
  BACKUP_VALIDATE = 'backup.validate',
  BACKUP_RESTORE = 'backup.restore',

  // Two-Factor Authentication
  TWO_FACTOR_SETUP = 'auth.2fa_setup',
  TWO_FACTOR_ENABLED = 'auth.2fa_enabled',
  TWO_FACTOR_DISABLED = 'auth.2fa_disabled',
  TWO_FACTOR_VERIFIED = 'auth.2fa_verified',
  TWO_FACTOR_FAILED = 'auth.2fa_failed',
  TWO_FACTOR_BACKUP_CODE_USED = 'auth.2fa_backup_code_used',
  TWO_FACTOR_BACKUP_CODES_REGENERATED = 'auth.2fa_backup_codes_regenerated',

  // Email verification
  AUTH_EMAIL_VERIFICATION_SENT = 'auth.email_verification_sent',
  AUTH_EMAIL_VERIFIED = 'auth.email_verified',
  AUTH_EMAIL_VERIFICATION_FAILED = 'auth.email_verification_failed',
  USER_EMAIL_UPDATED = 'user.email_updated',

  // Transaction operations
  TRANSACTION_CREATE = 'wallet.transaction_create',
  TRANSACTION_SIGN = 'wallet.transaction_sign',
  TRANSACTION_BROADCAST = 'wallet.transaction_broadcast',
  TRANSACTION_BROADCAST_FAILED = 'wallet.transaction_broadcast_failed',
  AGENT_FUNDING_DRAFT_SUBMIT = 'wallet.agent_funding_draft_submit',
  AGENT_CREATE = 'wallet.agent_create',
  AGENT_UPDATE = 'wallet.agent_update',
  AGENT_REVOKE = 'wallet.agent_revoke',
  AGENT_KEY_CREATE = 'wallet.agent_key_create',
  AGENT_KEY_REVOKE = 'wallet.agent_key_revoke',
  AGENT_OVERRIDE_CREATE = 'wallet.agent_override_create',
  AGENT_OVERRIDE_REVOKE = 'wallet.agent_override_revoke',
  AGENT_OVERRIDE_USE = 'wallet.agent_override_use',

  // Address operations
  ADDRESS_GENERATE = 'wallet.address_generate',

  // Vault policy operations
  POLICY_CREATE = 'wallet.policy_create',
  POLICY_UPDATE = 'wallet.policy_update',
  POLICY_DELETE = 'wallet.policy_delete',
  POLICY_APPROVAL_VOTE = 'wallet.policy_approval_vote',
  POLICY_OVERRIDE = 'wallet.policy_override',

  // Support package
  SUPPORT_PACKAGE_GENERATE = 'admin.support_package_generate',

  // MCP
  MCP_KEY_CREATE = 'mcp.key_create',
  MCP_KEY_REVOKE = 'mcp.key_revoke',
  MCP_OPERATION = 'mcp.operation',
  MCP_OPERATION_FAILED = 'mcp.operation_failed',
}

/**
 * Audit log entry input
 */
export interface AuditLogInput {
  userId?: string;
  username: string;
  action: string;
  category: AuditCategory;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  errorMsg?: string;
}

/**
 * Query options for audit logs
 */
export interface AuditLogQuery {
  userId?: string;
  username?: string;
  action?: string;
  category?: AuditCategory;
  success?: boolean;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Extract client info from Express request
 */
export function getClientInfo(req: Request): { ipAddress: string; userAgent: string } {
  // Get IP from x-forwarded-for header (for proxies) or direct connection
  const forwardedFor = req.headers['x-forwarded-for'];
  const ipAddress = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : typeof forwardedFor === 'string'
    ? forwardedFor.split(',')[0].trim()
    : req.socket.remoteAddress || 'unknown';

  const userAgent = req.headers['user-agent'] || 'unknown';

  return { ipAddress, userAgent };
}

/**
 * Audit Service class
 */
class AuditService {
  /**
   * Log an audit event
   */
  async log(input: AuditLogInput): Promise<void> {
    try {
      await auditLogRepository.create({
        userId: input.userId,
        username: input.username,
        action: input.action,
        category: input.category as RepoAuditCategory,
        details: input.details,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        success: input.success ?? true,
        errorMsg: input.errorMsg,
      });

      // Also log to application logger for immediate visibility
      const logMsg = `[${input.category}] ${input.action} by ${input.username}`;
      if (input.success === false) {
        log.warn(logMsg, { error: input.errorMsg, ...input.details });
      } else {
        log.info(logMsg, input.details);
      }
    } catch (error) {
      // Don't let audit logging failures break the application
      log.error('Failed to write audit log', { error: getErrorMessage(error), input });
    }
  }

  /**
   * Convenience method to log from an Express request
   */
  async logFromRequest(
    req: Request,
    action: string,
    category: AuditCategory,
    options: {
      details?: Record<string, any>;
      success?: boolean;
      errorMsg?: string;
    } = {}
  ): Promise<void> {
    const { ipAddress, userAgent } = getClientInfo(req);
    const user = req.user;

    await this.log({
      userId: user?.userId,
      username: user?.username || 'anonymous',
      action,
      category,
      ipAddress,
      userAgent,
      ...options,
    });
  }

  /**
   * Query audit logs with filters
   */
  async query(options: AuditLogQuery = {}): Promise<{
    logs: any[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const {
      userId,
      username,
      action,
      category,
      success,
      startDate,
      endDate,
      limit = AUDIT_DEFAULT_PAGE_SIZE,
      offset = 0,
    } = options;

    const result = await auditLogRepository.findMany(
      {
        userId,
        username,
        action,
        category: category as RepoAuditCategory | undefined,
        success,
        startDate,
        endDate,
      },
      { limit, offset }
    );

    return { logs: result.logs, total: result.total, limit, offset };
  }

  /**
   * Get recent audit logs for a specific user
   */
  async getForUser(userId: string, limit = AUDIT_USER_LOG_LIMIT): Promise<any[]> {
    return auditLogRepository.findByUserId(userId, { limit });
  }

  /**
   * Get failed login attempts (for security monitoring)
   */
  async getFailedLogins(since: Date, limit = AUDIT_FAILED_LOGIN_LIMIT): Promise<any[]> {
    const result = await auditLogRepository.findMany(
      {
        action: AuditAction.LOGIN_FAILED,
        startDate: since,
        success: false,
      },
      { limit }
    );
    return result.logs;
  }

  /**
   * Get all admin actions
   */
  async getAdminActions(limit = AUDIT_DEFAULT_PAGE_SIZE, offset = 0): Promise<any[]> {
    // Use findMany with admin category filter
    const result = await auditLogRepository.findMany(
      { category: 'admin' },
      { limit, offset }
    );
    return result.logs;
  }

  /**
   * Clean up old audit logs (retention policy)
   */
  async cleanup(olderThan: Date): Promise<number> {
    const count = await auditLogRepository.deleteOlderThan(olderThan);

    log.info('Audit log cleanup completed', {
      deleted: count,
      olderThan: olderThan.toISOString(),
    });

    return count;
  }

  /**
   * Get audit statistics
   */
  async getStats(days = AUDIT_STATS_DAYS): Promise<{
    totalEvents: number;
    byCategory: Record<string, number>;
    byAction: Record<string, number>;
    failedEvents: number;
  }> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Get aggregated stats from repository
    const [allResult, failedResult, byCategory, byAction] = await Promise.all([
      auditLogRepository.findMany({ startDate: since }, { limit: 0 }),
      auditLogRepository.findMany({ startDate: since, success: false }, { limit: 0 }),
      auditLogRepository.countByCategory({ startDate: since }),
      auditLogRepository.countByAction({ startDate: since }),
    ]);

    return {
      totalEvents: allResult.total,
      byCategory,
      byAction,
      failedEvents: failedResult.total,
    };
  }
}

// Export singleton instance
export const auditService = new AuditService();
