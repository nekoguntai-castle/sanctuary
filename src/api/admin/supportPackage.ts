/**
 * Support Package API
 *
 * Downloads a diagnostic support package from the server.
 */

import apiClient from '../client';

/**
 * Generate and download a support package diagnostic bundle.
 * Triggers a browser file download of the JSON file.
 */
export async function downloadSupportPackage(): Promise<void> {
  await apiClient.download('/admin/support-package', undefined, { method: 'POST' });
}
