import { describe, it, expect } from 'vitest';

import { resolvePageContentWidth } from '../../../src/app/resolvePageContentWidth';

describe('resolvePageContentWidth', () => {
  it('returns the declared width for a matching route (wallet detail opts into "wide")', () => {
    expect(resolvePageContentWidth('/wallets/abc123')).toBe('wide');
  });

  it('returns "default" for a matched route without a contentWidth override', () => {
    expect(resolvePageContentWidth('/')).toBe('default');
  });

  it('resolves by specificity, not array order — /wallets/create is the static route, not /wallets/:id', () => {
    // wallet-detail (/wallets/:id) is declared before wallet-create (/wallets/create);
    // matchRoutes must still prefer the static route, which has no width override.
    expect(resolvePageContentWidth('/wallets/create')).toBe('default');
  });

  it('returns "default" when no route matches the path', () => {
    expect(resolvePageContentWidth('/no/such/route/exists')).toBe('default');
  });
});
