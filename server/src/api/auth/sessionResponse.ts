import type { Request, Response } from 'express';

import { setAuthCookies } from '../../middleware/csrf';
import * as refreshTokenService from '../../services/refreshTokenService';
import { generateToken } from '../../utils/jwt';

// Public response hint for the JWT access-token TTL configured in utils/jwt.
// setAuthCookies derives the authoritative cookie/header expiry from the
// signed token's exp claim, so this value must stay aligned with that signing
// configuration but is not itself used for auth decisions.
const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 3600;

type ClientInfo = {
  ipAddress?: string;
  userAgent?: string;
};

export type AuthSessionUserRecord = {
  id: string;
  username: string;
  email?: string | null;
  emailVerified?: boolean | null;
  isAdmin: boolean;
  preferences?: unknown;
  sessionVersion?: number | null;
  twoFactorEnabled?: boolean | null;
};

export type AuthSessionUserResponse = {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  isAdmin: boolean;
  preferences: unknown;
  twoFactorEnabled: boolean;
  usingDefaultPassword: boolean;
};

export type PreparedAuthSession = {
  accessToken: string;
  refreshToken: string;
  responseBody: {
    expiresIn: number;
    user: AuthSessionUserResponse;
  };
};

function sessionVersionFor(user: AuthSessionUserRecord): number {
  return user.sessionVersion ?? 0;
}

export function buildAuthSessionUser(
  user: AuthSessionUserRecord,
  options: { usingDefaultPassword?: boolean } = {},
): AuthSessionUserResponse {
  return {
    id: user.id,
    username: user.username,
    email: user.email ?? null,
    emailVerified: user.emailVerified ?? false,
    isAdmin: user.isAdmin,
    preferences: user.preferences ?? null,
    twoFactorEnabled: user.twoFactorEnabled ?? false,
    usingDefaultPassword: options.usingDefaultPassword ?? false,
  };
}

/**
 * Prepare a successful browser-auth session without mutating the response.
 *
 * SEC-005 session issuance stays centralized here: access tokens carry the
 * current user session version, refresh tokens are persisted with the same
 * version and request-derived device metadata, and JSON response bodies get a
 * single canonical user shape. Callers still perform route-specific audits
 * before cookies are written.
 */
export async function prepareAuthSession(
  user: AuthSessionUserRecord,
  options: {
    clientInfo: ClientInfo;
    usingDefaultPassword?: boolean;
  },
): Promise<PreparedAuthSession> {
  const sessionVersion = sessionVersionFor(user);
  const accessToken = generateToken({
    userId: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
    sessionVersion,
  });
  const refreshToken = await refreshTokenService.createRefreshToken(
    user.id,
    {
      userAgent: options.clientInfo.userAgent,
      ipAddress: options.clientInfo.ipAddress,
    },
    sessionVersion,
  );

  return {
    accessToken,
    refreshToken,
    responseBody: {
      expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
      user: buildAuthSessionUser(user, {
        usingDefaultPassword: options.usingDefaultPassword,
      }),
    },
  };
}

/**
 * Send a prepared cookie-only auth response.
 *
 * Tokens are written only to HttpOnly cookies through setAuthCookies; the JSON
 * body intentionally exposes no access or refresh token fields. Extra body
 * fields are for route-specific metadata such as registration verification
 * status.
 */
export function sendAuthSessionResponse(
  req: Request,
  res: Response,
  session: PreparedAuthSession,
  options: {
    status?: number;
    body?: Record<string, unknown>;
  } = {},
): Response {
  setAuthCookies(req, res, {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });

  return res.status(options.status ?? 200).json({
    ...session.responseBody,
    ...(options.body ?? {}),
  });
}
