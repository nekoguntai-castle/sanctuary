/**
 * Admin Users API
 *
 * User management API calls (admin only)
 */

import apiClient from '../client';
import type { AdminUser, CreateUserRequest, UpdateUserRequest } from './types';

/**
 * Get all users (admin only)
 */
export async function getUsers(): Promise<AdminUser[]> {
  return apiClient.get<AdminUser[]>('/admin/users');
}

/**
 * Create a new user (admin only)
 */
export async function createUser(data: CreateUserRequest): Promise<AdminUser> {
  return apiClient.post<AdminUser>('/admin/users', data);
}

/**
 * Update a user (admin only)
 */
export async function updateUser(userId: string, data: UpdateUserRequest): Promise<AdminUser> {
  return apiClient.put<AdminUser>(`/admin/users/${userId}`, data);
}

/**
 * Delete a user (admin only)
 */
export async function deleteUser(userId: string): Promise<{ message: string }> {
  return apiClient.delete<{ message: string }>(`/admin/users/${userId}`);
}
