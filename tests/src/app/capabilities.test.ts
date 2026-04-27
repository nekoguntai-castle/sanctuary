import { describe, expect, it } from 'vitest';
import { hasRequiredCapabilities } from '../../../src/app/capabilities';

describe('app capabilities', () => {
  it('allows ungated items without capability status', () => {
    expect(hasRequiredCapabilities(undefined)).toBe(true);
    expect(hasRequiredCapabilities([])).toBe(true);
  });

  it('requires every listed capability to be available', () => {
    expect(hasRequiredCapabilities(['intelligence'], { intelligence: true })).toBe(true);
    expect(hasRequiredCapabilities(['intelligence'], { intelligence: false })).toBe(false);
    expect(hasRequiredCapabilities(['intelligence'], {})).toBe(false);
    expect(hasRequiredCapabilities(['console'], { console: true })).toBe(true);
    expect(hasRequiredCapabilities(['console'], { console: false })).toBe(false);
    expect(hasRequiredCapabilities(['console', 'intelligence'], { console: true, intelligence: false })).toBe(false);
  });
});
