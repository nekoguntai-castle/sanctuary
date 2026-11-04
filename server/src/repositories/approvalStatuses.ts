/**
 * Approval statuses a settled request derives on a draft. A draft holding one
 * is closed to further votes and no longer counts as pending. Listed in
 * priority order: a draft with several settled requests takes the first match.
 * Lives in the
 * repository layer because repositories may not import service runtime code.
 */
import type { ApprovalStatus } from '../services/vaultPolicy/types';

export const RESOLVED_APPROVAL_STATUSES: readonly ApprovalStatus[] = ['rejected', 'vetoed', 'expired'];
