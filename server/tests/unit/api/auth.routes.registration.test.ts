/**
 * Auth API Route Tests — Registration, Login, Password, Tokens
 *
 * Tests for profile, sessions, registration, login, password change,
 * token management (refresh/logout/logout-all) routes.
 */

import { describe } from 'vitest';
import { registerAuthCookieExpiryTests } from './authRegistration/cookie-expiry.contracts';
import { registerAuthPasswordTokenTests } from './authRegistration/password-tokens.contracts';
import { registerAuthProfileSessionsTests } from './authRegistration/profile-sessions.contracts';
import { registerAuthRegistrationLoginTests } from './authRegistration/registration-login.contracts';
import { setupAuthRegistrationTestHooks } from './authRegistration/authRegistrationTestHarness';

describe('Auth API Routes — Registration, Login, Password, Tokens', () => {
  setupAuthRegistrationTestHooks();
  registerAuthProfileSessionsTests();
  registerAuthRegistrationLoginTests();
  registerAuthPasswordTokenTests();
  registerAuthCookieExpiryTests();
});
