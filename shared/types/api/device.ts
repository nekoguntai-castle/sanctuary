/**
 * Device API Contract Types
 *
 * Types for hardware wallet device CRUD operations.
 */

/**
 * Device role enum value
 */
export type ApiDeviceRole = 'owner' | 'viewer';

/**
 * GET /devices/:id response
 * GET /devices (array of these)
 */
export interface DeviceResponse {
  id: string;
  label: string;
  fingerprint: string;
  xpub: string | null;
  derivationPath: string | null;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  role: ApiDeviceRole;
  walletCount: number;
  model: string | null;
  type: string | null;
}

/**
 * POST /devices request
 */
export interface CreateDeviceRequest {
  label: string;
  fingerprint: string;
  xpub?: string;
  derivationPath?: string;
  model?: string;
  type?: string;
}

/**
 * PATCH /devices/:id request
 */
export interface UpdateDeviceRequest {
  label?: string;
  xpub?: string;
  derivationPath?: string;
}
