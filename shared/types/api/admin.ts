/**
 * Admin API Contract Types
 *
 * Types for admin-only endpoints (user management, system stats).
 */

/**
 * GET /admin/users (array of these)
 */
export interface AdminUserResponse {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  walletCount: number;
  deviceCount: number;
}

/**
 * GET /admin/stats response
 */
export interface AdminStatsResponse {
  totalUsers: number;
  totalWallets: number;
  totalDevices: number;
  totalTransactions: number;
  activeUsers24h: number;
}
