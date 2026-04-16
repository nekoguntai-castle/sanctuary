/**
 * OpenAPI Security Requirement Objects
 *
 * ADR 0001 / ADR 0002 — browser auth uses HttpOnly cookies with a double-submit
 * CSRF token. Mobile and gateway callers continue to use bearer tokens. Every
 * protected browser-mounted route advertises both alternatives so the Swagger
 * UI and generated clients see the real surface:
 *
 *   security:
 *     - bearerAuth: []                           # mobile / gateway
 *     - cookieAuth: [] + csrfToken: []           # browser (cookie auth path)
 *
 * OpenAPI treats the array as OR and the keys inside each object as AND, so
 * the above reads as "bearer token OR (cookie AND CSRF token)."
 *
 * `internalBearerAuth` is exported separately for the root-mounted internal AI
 * container routes (`/internal/ai/...`) — those are proxied by the AI container
 * with a bearer token and are NOT reachable from browsers, so they do not
 * advertise the cookie alternative.
 */

export const browserOrBearerAuth = [
  { bearerAuth: [] },
  { cookieAuth: [], csrfToken: [] },
] as const;

export const internalBearerAuth = [{ bearerAuth: [] }] as const;

export const agentBearerAuth = [{ agentBearerAuth: [] }] as const;
