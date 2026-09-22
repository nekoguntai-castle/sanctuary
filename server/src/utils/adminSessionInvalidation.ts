export interface AdminUpdateTransitions {
  adminRoleChanged: boolean;
  passwordChanged: boolean;
}

export type AdminSessionInvalidationReason =
  | 'admin_security_update'
  | 'admin_password_reset'
  | 'admin_role_change';

/** Map committed admin update transitions to their session invalidation reason. */
export function getAdminSessionInvalidationReason(
  transitions: AdminUpdateTransitions,
): AdminSessionInvalidationReason | null {
  if (transitions.passwordChanged && transitions.adminRoleChanged) {
    return 'admin_security_update';
  }
  if (transitions.passwordChanged) return 'admin_password_reset';
  if (transitions.adminRoleChanged) return 'admin_role_change';
  return null;
}
