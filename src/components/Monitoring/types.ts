/**
 * Credentials display for services that require authentication
 */
export interface ServiceCredentials {
  username: string;
  password: string | null;
  passwordSource: string | null;
  passwordConfigured: boolean;
  hasAuth: boolean;
}
