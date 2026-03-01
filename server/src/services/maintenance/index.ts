/**
 * Maintenance Module
 *
 * Barrel file re-exporting the maintenance service and its singleton instance.
 * External code should import from this module.
 */

export { MaintenanceService } from './maintenanceService';
export type { MaintenanceServiceConfig } from './types';

// Export singleton instance - matches the original public API
import { MaintenanceService } from './maintenanceService';
export const maintenanceService = new MaintenanceService();
