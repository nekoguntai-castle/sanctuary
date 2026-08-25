import { describe, expect, it } from 'vitest';
import {
  ApiError,
  AuthCsrfSessionStaleError,
  ConflictError,
  DatabaseError,
  DeviceNotFoundError,
  DuplicateEntryError,
  ErrorCodes,
  ExternalServiceError,
  ForbiddenError,
  InsufficientPermissionsError,
  InternalError,
  InvalidAddressError,
  InvalidAmountError,
  InvalidInputError,
  InvalidPsbtError,
  InvalidTokenError,
  MissingRequiredFieldError,
  NotFoundError,
  OwnershipRequiredError,
  RateLimitError,
  ServiceUnavailableError,
  SyncInProgressError,
  TokenExpiredError,
  TransactionNotFoundError,
  TwoFactorRequiredError,
  UnauthorizedError,
  UserNotFoundError,
  ValidationError,
  WalletNotFoundError,
} from '../../../src/errors/ApiError';

describe('ApiError hierarchy', () => {
  it('creates base ApiError and serializes response', () => {
    const error = new ApiError(
      'Teapot',
      418,
      ErrorCodes.INTERNAL_ERROR,
      { reason: 'brew' },
      false
    );

    expect(error.name).toBe('ApiError');
    expect(error.statusCode).toBe(418);
    expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(error.details).toEqual({ reason: 'brew' });
    expect(error.isOperational).toBe(false);
    expect(error.timestamp).toBeInstanceOf(Date);
    expect(ApiError.isApiError(error)).toBe(true);
    expect(ApiError.isApiError(new Error('nope'))).toBe(false);

    expect(error.toResponse('req-123')).toMatchObject({
      error: 'Api',
      code: ErrorCodes.INTERNAL_ERROR,
      message: 'Teapot',
      details: { reason: 'brew' },
      requestId: 'req-123',
    });
  });

  it('maps authentication errors to 401 variants', () => {
    const unauthorized = new UnauthorizedError();
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.code).toBe(ErrorCodes.UNAUTHORIZED);
    expect(unauthorized.message).toBe('Authentication required');

    const invalidToken = new InvalidTokenError();
    expect(invalidToken.code).toBe(ErrorCodes.INVALID_TOKEN);

    const expired = new TokenExpiredError();
    expect(expired.code).toBe(ErrorCodes.TOKEN_EXPIRED);

    const twoFactor = new TwoFactorRequiredError();
    expect(twoFactor.code).toBe(ErrorCodes.TWO_FA_REQUIRED);
  });

  it('maps authorization errors to 403 variants', () => {
    const forbidden = new ForbiddenError();
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.code).toBe(ErrorCodes.FORBIDDEN);

    const insufficient = new InsufficientPermissionsError('Denied', { action: 'delete' });
    expect(insufficient.code).toBe(ErrorCodes.INSUFFICIENT_PERMISSIONS);
    expect(insufficient.details).toEqual({ action: 'delete' });

    const ownerOnly = new OwnershipRequiredError();
    expect(ownerOnly.code).toBe(ErrorCodes.OWNERSHIP_REQUIRED);

    const staleCsrf = new AuthCsrfSessionStaleError();
    expect(staleCsrf.statusCode).toBe(403);
    expect(staleCsrf.code).toBe(ErrorCodes.AUTH_CSRF_SESSION_STALE);
    expect(staleCsrf.toResponse()).toMatchObject({
      error: 'AuthCsrfSessionStale',
      code: 'AUTH_CSRF_SESSION_STALE',
    });
  });

  it('maps not-found errors and optional identifier details', () => {
    const notFound = new NotFoundError();
    expect(notFound.statusCode).toBe(404);
    expect(notFound.code).toBe(ErrorCodes.NOT_FOUND);

    expect(new WalletNotFoundError('wallet-1').details).toEqual({ walletId: 'wallet-1' });
    expect(new WalletNotFoundError().details).toBeUndefined();

    expect(new DeviceNotFoundError('device-1').details).toEqual({ deviceId: 'device-1' });
    expect(new DeviceNotFoundError().details).toBeUndefined();

    expect(new TransactionNotFoundError('tx-1').details).toEqual({ txid: 'tx-1' });
    expect(new TransactionNotFoundError().details).toBeUndefined();

    expect(new UserNotFoundError('user-1').details).toEqual({ userId: 'user-1' });
    expect(new UserNotFoundError().details).toBeUndefined();
  });

  it('maps validation error variants and details', () => {
    const validation = new ValidationError();
    expect(validation.statusCode).toBe(400);
    expect(validation.code).toBe(ErrorCodes.VALIDATION_ERROR);

    const invalidInputWithField = new InvalidInputError('Invalid value', 'amount');
    expect(invalidInputWithField.code).toBe(ErrorCodes.INVALID_INPUT);
    expect(invalidInputWithField.details).toEqual({ field: 'amount' });

    const invalidInputWithoutField = new InvalidInputError('Missing');
    expect(invalidInputWithoutField.details).toBeUndefined();

    const missingField = new MissingRequiredFieldError('walletId');
    expect(missingField.code).toBe(ErrorCodes.MISSING_REQUIRED_FIELD);
    expect(missingField.message).toContain('walletId');

    const invalidAddress = new InvalidAddressError('addr', 'mainnet');
    expect(invalidAddress.code).toBe(ErrorCodes.INVALID_ADDRESS);
    expect(invalidAddress.details).toEqual({ address: 'addr', network: 'mainnet' });

    expect(new InvalidPsbtError().code).toBe(ErrorCodes.INVALID_PSBT);
    expect(new InvalidPsbtError('PSBT malformed').message).toBe('PSBT malformed');

    expect(new InvalidAmountError().code).toBe(ErrorCodes.INVALID_AMOUNT);
    expect(new InvalidAmountError('Too low', { min: 1 }).details).toEqual({ min: 1 });
  });

  it('maps conflict and rate-limit errors', () => {
    const conflict = new ConflictError();
    expect(conflict.statusCode).toBe(409);
    expect(conflict.code).toBe(ErrorCodes.CONFLICT);

    const duplicate = new DuplicateEntryError('Wallet', 'name');
    expect(duplicate.code).toBe(ErrorCodes.DUPLICATE_ENTRY);
    expect(duplicate.message).toContain('Wallet already exists');
    expect(duplicate.details).toEqual({ resource: 'Wallet', field: 'name' });

    const rateLimitedNoRetry = new RateLimitError();
    expect(rateLimitedNoRetry.statusCode).toBe(429);
    expect(rateLimitedNoRetry.code).toBe(ErrorCodes.RATE_LIMITED);
    expect(rateLimitedNoRetry.retryAfter).toBeUndefined();
    expect(rateLimitedNoRetry.details).toBeUndefined();

    const rateLimitedWithRetry = new RateLimitError('Too many', 60);
    expect(rateLimitedWithRetry.retryAfter).toBe(60);
    expect(rateLimitedWithRetry.details).toEqual({ retryAfter: 60 });
  });

  it('maps internal and service-unavailable errors', () => {
    const internal = new InternalError();
    expect(internal.statusCode).toBe(500);
    expect(internal.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(internal.isOperational).toBe(false);

    const database = new DatabaseError();
    expect(database.code).toBe(ErrorCodes.DATABASE_ERROR);

    const externalDefault = new ExternalServiceError('mempool');
    expect(externalDefault.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
    expect(externalDefault.message).toContain('mempool');
    expect(externalDefault.details).toEqual({ service: 'mempool' });
    expect(externalDefault.isOperational).toBe(true);

    const externalCustom = new ExternalServiceError('kraken', 'Kraken unavailable');
    expect(externalCustom.message).toBe('Kraken unavailable');

    const unavailable = new ServiceUnavailableError();
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.code).toBe(ErrorCodes.SERVICE_UNAVAILABLE);
    expect(unavailable.isOperational).toBe(true);

    const syncInProgress = new SyncInProgressError('wallet-1');
    expect(syncInProgress.code).toBe(ErrorCodes.SYNC_IN_PROGRESS);
    expect(syncInProgress.details).toEqual({ walletId: 'wallet-1' });

    const syncInProgressNoWallet = new SyncInProgressError();
    expect(syncInProgressNoWallet.details).toBeUndefined();
  });
});
