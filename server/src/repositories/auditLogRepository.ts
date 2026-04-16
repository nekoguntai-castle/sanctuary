/**
 * Audit Log Repository
 *
 * Abstracts database operations for audit logging.
 */

import prisma from '../models/prisma';
import type { AuditLog, Prisma } from '../generated/prisma/client';

/**
 * Audit log category types
 */
export type AuditCategory =
  | 'auth'
  | 'user'
  | 'wallet'
  | 'device'
  | 'admin'
  | 'backup'
  | 'mcp'
  | 'system';

/**
 * Create audit log input
 */
export interface CreateAuditLogInput {
  userId?: string | null;
  username: string;
  action: string;
  category: AuditCategory;
  details?: Prisma.JsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
  success?: boolean;
  errorMsg?: string | null;
}

/**
 * Audit log filter
 */
export interface AuditLogFilter {
  userId?: string;
  username?: string;
  action?: string;
  category?: AuditCategory;
  success?: boolean;
  startDate?: Date;
  endDate?: Date;
}

/**
 * Pagination options
 */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

type AuditLogDateRangeFilter = Pick<AuditLogFilter, 'startDate' | 'endDate'>;

function buildDateRangeWhere(filter: AuditLogDateRangeFilter = {}): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};

  if (filter.startDate || filter.endDate) {
    where.createdAt = {};
    if (filter.startDate) {
      where.createdAt.gte = filter.startDate;
    }
    if (filter.endDate) {
      where.createdAt.lte = filter.endDate;
    }
  }

  return where;
}

/**
 * Create an audit log entry
 */
export async function create(input: CreateAuditLogInput): Promise<AuditLog> {
  return prisma.auditLog.create({
    data: {
      userId: input.userId,
      username: input.username,
      action: input.action,
      category: input.category,
      details: input.details || {},
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      success: input.success ?? true,
      errorMsg: input.errorMsg,
    },
  });
}

/**
 * Find audit logs with filtering and pagination
 */
export async function findMany(
  filter: AuditLogFilter = {},
  pagination: PaginationOptions = {}
): Promise<{ logs: AuditLog[]; total: number }> {
  const where: Prisma.AuditLogWhereInput = {};

  if (filter.userId) {
    where.userId = filter.userId;
  }
  if (filter.username) {
    where.username = {
      contains: filter.username,
      mode: 'insensitive',
    };
  }
  if (filter.action) {
    where.action = filter.action;
  }
  if (filter.category) {
    where.category = filter.category;
  }
  if (filter.success !== undefined) {
    where.success = filter.success;
  }
  Object.assign(where, buildDateRangeWhere(filter));

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: pagination.limit ?? 50,
      skip: pagination.offset ?? 0,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { logs, total };
}

/**
 * Find audit logs for a user
 */
export async function findByUserId(
  userId: string,
  pagination: PaginationOptions = {}
): Promise<AuditLog[]> {
  return prisma.auditLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: pagination.limit || 50,
    skip: pagination.offset || 0,
  });
}

/**
 * Find audit logs by category
 */
export async function findByCategory(
  category: AuditCategory,
  pagination: PaginationOptions = {}
): Promise<AuditLog[]> {
  return prisma.auditLog.findMany({
    where: { category },
    orderBy: { createdAt: 'desc' },
    take: pagination.limit || 50,
    skip: pagination.offset || 0,
  });
}

/**
 * Find failed actions (for security monitoring)
 */
export async function findFailedActions(
  pagination: PaginationOptions = {}
): Promise<AuditLog[]> {
  return prisma.auditLog.findMany({
    where: { success: false },
    orderBy: { createdAt: 'desc' },
    take: pagination.limit || 50,
    skip: pagination.offset || 0,
  });
}

/**
 * Find recent audit logs
 */
export async function findRecent(limit: number = 100): Promise<AuditLog[]> {
  return prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Count audit logs by action type
 */
export async function countByAction(filter: AuditLogDateRangeFilter = {}): Promise<Record<string, number>> {
  const where = buildDateRangeWhere(filter);
  const results = await prisma.auditLog.groupBy({
    by: ['action'],
    ...(Object.keys(where).length > 0 ? { where } : {}),
    _count: { action: true },
  });

  const counts: Record<string, number> = {};
  for (const result of results) {
    counts[result.action] = result._count.action;
  }
  return counts;
}

/**
 * Count audit logs by category
 */
export async function countByCategory(filter: AuditLogDateRangeFilter = {}): Promise<Record<string, number>> {
  const where = buildDateRangeWhere(filter);
  const results = await prisma.auditLog.groupBy({
    by: ['category'],
    ...(Object.keys(where).length > 0 ? { where } : {}),
    _count: { category: true },
  });

  const counts: Record<string, number> = {};
  for (const result of results) {
    counts[result.category] = result._count.category;
  }
  return counts;
}

/**
 * Delete old audit logs
 */
export async function deleteOlderThan(date: Date): Promise<number> {
  const result = await prisma.auditLog.deleteMany({
    where: {
      createdAt: { lt: date },
    },
  });
  return result.count;
}

/**
 * Log a successful action (convenience method)
 */
export async function logSuccess(
  userId: string | null,
  username: string,
  action: string,
  category: AuditCategory,
  details?: Record<string, unknown>,
  context?: { ipAddress?: string; userAgent?: string }
): Promise<AuditLog> {
  return create({
    userId,
    username,
    action,
    category,
    details: details as Prisma.JsonValue,
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
    success: true,
  });
}

/**
 * Log a failed action (convenience method)
 */
export async function logFailure(
  userId: string | null,
  username: string,
  action: string,
  category: AuditCategory,
  errorMsg: string,
  details?: Record<string, unknown>,
  context?: { ipAddress?: string; userAgent?: string }
): Promise<AuditLog> {
  return create({
    userId,
    username,
    action,
    category,
    details: details as Prisma.JsonValue,
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
    success: false,
    errorMsg,
  });
}

// Export as namespace
export const auditLogRepository = {
  create,
  findMany,
  findByUserId,
  findByCategory,
  findFailedActions,
  findRecent,
  countByAction,
  countByCategory,
  deleteOlderThan,
  logSuccess,
  logFailure,
};

export default auditLogRepository;
