/**
 * Admin Groups API
 *
 * Group management API calls (admin only)
 */

import apiClient from '../client';
import type { AdminGroup, CreateGroupRequest, GroupMember } from './types';

/**
 * Get all groups (admin only)
 */
export async function getGroups(): Promise<AdminGroup[]> {
  return apiClient.get<AdminGroup[]>('/admin/groups');
}

/**
 * Create a new group (admin only)
 */
export async function createGroup(data: CreateGroupRequest): Promise<AdminGroup> {
  return apiClient.post<AdminGroup>('/admin/groups', data);
}

/**
 * Update a group (admin only)
 */
export async function updateGroup(groupId: string, data: Partial<CreateGroupRequest>): Promise<AdminGroup> {
  return apiClient.put<AdminGroup>(`/admin/groups/${groupId}`, data);
}

/**
 * Delete a group (admin only)
 */
export async function deleteGroup(groupId: string): Promise<{ message: string }> {
  return apiClient.delete<{ message: string }>(`/admin/groups/${groupId}`);
}

/**
 * Add a member to a group (admin only)
 */
export async function addGroupMember(groupId: string, userId: string, role?: string): Promise<GroupMember> {
  return apiClient.post<GroupMember>(`/admin/groups/${groupId}/members`, { userId, role });
}

/**
 * Remove a member from a group (admin only)
 */
export async function removeGroupMember(groupId: string, userId: string): Promise<{ message: string }> {
  return apiClient.delete<{ message: string }>(`/admin/groups/${groupId}/members/${userId}`);
}
