import { findDashboardRows } from '../agentDashboardRepository';

export async function findAdminAgentDashboardRowsForAssistant(limit: number) {
  return findDashboardRows({ limit });
}
