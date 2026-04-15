import { describe, expect, it, vi } from 'vitest';

import { reloadCurrentDocument } from '../../src/app/browserNavigation';

describe('browserNavigation', () => {
  it('reloads the supplied document location', () => {
    const location = {
      reload: vi.fn(),
    };

    reloadCurrentDocument(location);

    expect(location.reload).toHaveBeenCalledTimes(1);
  });
});
