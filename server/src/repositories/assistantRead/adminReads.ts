import { findDashboardRows } from '../agentDashboardRepository';

export async function findAdminAgentDashboardRowsForAssistant(limit: number, walletIds?: string[]) {
  return findDashboardRows({ limit, walletIds });
}
