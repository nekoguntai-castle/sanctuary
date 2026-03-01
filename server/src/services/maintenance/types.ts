/**
 * Maintenance Service Types
 *
 * Shared interfaces and types for the maintenance service modules.
 */

/**
 * Maintenance configuration loaded from centralized config
 */
export interface MaintenanceServiceConfig {
  // Retention periods in days
  auditLogRetentionDays: number;
  priceDataRetentionDays: number;
  feeEstimateRetentionDays: number;

  // Cleanup intervals in milliseconds
  dailyCleanupInterval: number;
  hourlyCleanupInterval: number;

  // Initial delay before first cleanup (to let server fully start)
  initialDelayMs: number;

  // Database maintenance intervals
  weeklyMaintenanceInterval: number; // 7 days in milliseconds
  monthlyMaintenanceInterval: number; // 30 days in milliseconds

  // Disk usage monitoring
  diskWarningThresholdPercent: number;
}
