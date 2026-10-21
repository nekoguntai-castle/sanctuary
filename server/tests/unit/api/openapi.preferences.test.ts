/**
 * PATCH /auth/me/preferences OpenAPI contract: the description documents the
 * merge semantics the route implements (top-level keys replace; `telegram` is
 * merged one level deep, so a patch without `wallets` keeps per-wallet
 * Telegram settings, and an explicit `wallets` still replaces them).
 */
import { describe, expect, it } from 'vitest';

import { openApiSpec } from '../../../src/api/openapi/spec';

describe('OpenAPI PATCH /auth/me/preferences contract', () => {
  it('documents the one-level telegram merge', () => {
    const { description } = openApiSpec.paths['/auth/me/preferences'].patch;

    expect(description).toMatch(/top-level/i);
    expect(description).toMatch(/`telegram` is merged one level deep/);
    expect(description).toMatch(/`wallets`/);
  });
});
