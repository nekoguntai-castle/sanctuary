/**
 * Credentials display for services that require authentication
 */
export interface ServiceCredentials {
  username: string;
  password: string;
  passwordSource: string;
  hasAuth: boolean;
}
