import { describe, expect, it } from 'vitest';
import {
  getRequiredCapabilityGateState,
  hasRequiredCapabilities,
} from '../../../src/app/capabilities';

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

  it('reports route gate state for loading, unavailable, and available capabilities', () => {
    expect(getRequiredCapabilityGateState(undefined)).toBe('available');
    expect(getRequiredCapabilityGateState(['intelligence'], {
      intelligence: { available: true, loading: false },
    })).toBe('available');
    expect(getRequiredCapabilityGateState(['intelligence'], {
      intelligence: { available: false, loading: true },
    })).toBe('loading');
    expect(getRequiredCapabilityGateState(['intelligence'], {
      intelligence: { available: false, loading: false },
    })).toBe('unavailable');
    expect(getRequiredCapabilityGateState(['console', 'intelligence'], {
      console: { available: true, loading: false },
      intelligence: { available: false, loading: true },
    })).toBe('loading');
    expect(getRequiredCapabilityGateState(['console', 'intelligence'], {
      console: { available: false, loading: false },
      intelligence: { available: false, loading: true },
    })).toBe('unavailable');
  });
});
