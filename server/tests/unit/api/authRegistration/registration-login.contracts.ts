import { describe, expect, it } from 'vitest';
import { app } from './authRegistrationTestHarness';
import request from 'supertest';
import { hashPassword } from '../../../../src/utils/password';
import { mockPrismaClient } from '../../../mocks/prisma';
import {
  mockCreateVerificationToken,
  mockIsSmtpConfigured,
  mockIsVerificationRequired,
} from '../auth.testHelpers';

export function registerAuthRegistrationLoginTests(): void {
  describe('GET /auth/registration-status - Check Registration Status', () => {
    it('should return enabled when registration is enabled', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });

      const response = await request(app)
        .get('/api/v1/auth/registration-status');

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(true);
    });

    it('should return disabled when registration is disabled', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'false',
      });

      const response = await request(app)
        .get('/api/v1/auth/registration-status');

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(false);
    });

    it('should return disabled when setting does not exist', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/auth/registration-status');

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(false);
    });

    it('should return 500 on error', async () => {
      mockPrismaClient.systemSetting.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/auth/registration-status');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /auth/register - Register New User', () => {
    it('should reject when registration is disabled', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'false',
      });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'new@example.com' });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('Public registration is disabled');
    });

    it('should default to disabled registration when setting is missing', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'new@example.com' });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('Public registration is disabled');
    });

    it('should reject when username is missing', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ password: 'StrongPassword123!', email: 'test@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Username, password, and email are required');
    });

    it('should reject invalid registration field types', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 42, password: 'StrongPassword123!', email: 'test@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_INPUT');
      expect(response.body.message).toContain('Username, password, and email are required');
    });

    it('should reject weak password', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'weak', email: 'new@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Password does not meet strength requirements');
    });

    it('should reject when username already exists', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'existing-user-id',
        username: 'existinguser',
      });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'existinguser', password: 'StrongPassword123!', email: 'existing@example.com' });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('Username already exists');
    });

    it('should successfully register a new user', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue(null);
      mockPrismaClient.user.create.mockResolvedValue({
        id: 'new-user-id',
        username: 'newuser',
        email: 'new@example.com',
        isAdmin: false,
        preferences: { darkMode: true },
      });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'new@example.com' });

      expect(response.status).toBe(201);
      // Phase 6: browser auth is cookie-only; JSON body no longer carries tokens.
      expect(response.body.token).toBeUndefined();
      expect(response.body.refreshToken).toBeUndefined();
      expect(response.body.user.username).toBe('newuser');
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue(null);
      mockPrismaClient.user.create.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'new@example.com' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('should reject invalid email format', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'invalid-email' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid email');
    });

    it('should reject duplicate email address', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });
      // First findUnique for username check (not found)
      mockPrismaClient.user.findUnique
        .mockResolvedValueOnce(null)
        // Second findUnique for email check (found - duplicate)
        .mockResolvedValueOnce({ id: 'existing-user', email: 'existing@example.com' });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'existing@example.com' });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('Email address is already in use');
    });

    it('should create user with emailVerified false', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue(null);
      mockPrismaClient.user.create.mockResolvedValue({
        id: 'new-user-id',
        username: 'newuser',
        email: 'new@example.com',
        emailVerified: false,
        isAdmin: false,
        preferences: { darkMode: true },
      });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'new@example.com' });

      expect(response.status).toBe(201);
      expect(response.body.user.emailVerified).toBe(false);
    });

    it('should send verification email when SMTP is configured', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue(null);
      mockPrismaClient.user.create.mockResolvedValue({
        id: 'new-user-id',
        username: 'newuser',
        email: 'new@example.com',
        emailVerified: false,
        isAdmin: false,
        preferences: { darkMode: true },
      });
      mockIsSmtpConfigured.mockResolvedValue(true);
      mockCreateVerificationToken.mockResolvedValue({ success: true });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'new@example.com' });

      expect(response.status).toBe(201);
      expect(response.body.emailVerificationRequired).toBe(true);
      expect(response.body.verificationEmailSent).toBe(true);
      expect(mockCreateVerificationToken).toHaveBeenCalledWith(
        'new-user-id',
        'new@example.com',
        'newuser'
      );
    });

    it('should still register when verification email delivery fails', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue(null);
      mockPrismaClient.user.create.mockResolvedValue({
        id: 'new-user-id',
        username: 'newuser',
        email: 'new@example.com',
        emailVerified: false,
        isAdmin: false,
        preferences: { darkMode: true },
      });
      mockIsSmtpConfigured.mockResolvedValue(true);
      mockCreateVerificationToken.mockResolvedValue({ success: false, error: 'SMTP failure' });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'new@example.com' });

      expect(response.status).toBe(201);
      expect(response.body.emailVerificationRequired).toBe(true);
      expect(response.body.verificationEmailSent).toBe(false);
    });

    it('should return a generic success message when verification is not required', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue(null);
      mockPrismaClient.user.create.mockResolvedValue({
        id: 'new-user-id',
        username: 'newuser',
        email: 'new@example.com',
        emailVerified: false,
        isAdmin: false,
        preferences: { darkMode: true },
      });
      mockIsVerificationRequired.mockResolvedValue(false);
      mockIsSmtpConfigured.mockResolvedValue(false);

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'new@example.com' });

      expect(response.status).toBe(201);
      expect(response.body.emailVerificationRequired).toBe(false);
      expect(response.body.message).toBe('Registration successful.');
    });
  });

  describe('POST /auth/login - User Login', () => {
    it('should reject when username is missing', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ password: 'password123' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Username and password are required');
    });

    it('should reject when password is missing', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Username and password are required');
    });

    it('should reject non-existent user', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'nonexistent', password: 'password123' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid username or password');
    });

    it('should reject wrong password', async () => {
      // Create a user with a known hashed password
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-id',
        username: 'testuser',
        password: hashedPassword,
        twoFactorEnabled: false,
      });

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: 'WrongPassword123!' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid username or password');
    });

    it('should return 2FA required when user has 2FA enabled', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-id',
        username: 'testuser',
        email: 'test@example.com',
        emailVerified: true,
        password: hashedPassword,
        isAdmin: false,
        twoFactorEnabled: true,
        twoFactorSecret: 'SOME2FASECRET',
      });
      // Mock initial password check
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: correctPassword });

      expect(response.status).toBe(200);
      expect(response.body.requires2FA).toBe(true);
      expect(response.body.tempToken).toBeDefined();
    });

    it('should return token on successful login', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-id',
        username: 'testuser',
        email: 'test@example.com',
        emailVerified: true,
        password: hashedPassword,
        isAdmin: false,
        twoFactorEnabled: false,
        preferences: { darkMode: true },
      });
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: correctPassword });

      expect(response.status).toBe(200);
      // Phase 6: browser auth is cookie-only; JSON body no longer carries tokens.
      expect(response.body.token).toBeUndefined();
      expect(response.body.refreshToken).toBeUndefined();
      expect(response.body.user.username).toBe('testuser');
      expect(response.body.usingDefaultPassword).toBeUndefined();
    });

    it('should block unverified user when verification required', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-id',
        username: 'testuser',
        email: 'test@example.com',
        emailVerified: false, // Not verified
        password: hashedPassword,
        isAdmin: false,
        twoFactorEnabled: false,
      });
      // isVerificationRequired returns true (default from beforeEach)

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: correctPassword });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Email Not Verified');
      expect(response.body.emailVerificationRequired).toBe(true);
      expect(response.body.email).toBe('test@example.com');
      expect(response.body.canResend).toBe(true);
    });

    // Skip these tests because they hit the rate limiter threshold from previous tests
    it('should allow unverified user when verification not required', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-id',
        username: 'testuser',
        email: 'test@example.com',
        emailVerified: false, // Not verified but ok
        password: hashedPassword,
        isAdmin: false,
        twoFactorEnabled: false,
        preferences: { darkMode: true },
      });
      // Override default to not require verification
      mockIsVerificationRequired.mockResolvedValue(false);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: correctPassword });

      expect(response.status).toBe(200);
      // Phase 6: tokens are delivered via cookies, not the JSON body.
      expect(response.body.token).toBeUndefined();
    });

    // Skip this test because it hits the rate limiter threshold from previous tests
    it('should include emailVerified in successful login response', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-id',
        username: 'testuser',
        email: 'test@example.com',
        emailVerified: true,
        password: hashedPassword,
        isAdmin: false,
        twoFactorEnabled: false,
        preferences: { darkMode: true },
      });
      // Verification is required, but user is verified so login should succeed

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: correctPassword });

      expect(response.status).toBe(200);
      expect(response.body.user.emailVerified).toBe(true);
    });

    // Skip this test because it hits the rate limiter threshold from previous tests
    it('should handle database errors gracefully', async () => {
      mockPrismaClient.user.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: 'password123' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('should return 500 when login query fails unexpectedly', async () => {
      mockPrismaClient.user.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: 'password123' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================
  // Password Routes
  // ========================================

}
