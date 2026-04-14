/**
 * Admin API Path Definitions
 *
 * OpenAPI path definitions for bounded administrative metadata and
 * configuration endpoints.
 */

import { adminCorePaths } from './admin/core';
import { adminFeaturesAuditPaths } from './admin/features-audit';
import { adminIdentityPolicyPaths } from './admin/identity-policy';
import { adminOperationsPaths } from './admin/operations';

export const adminPaths = {
  ...adminCorePaths,
  ...adminOperationsPaths,
  ...adminIdentityPolicyPaths,
  ...adminFeaturesAuditPaths,
} as const;
