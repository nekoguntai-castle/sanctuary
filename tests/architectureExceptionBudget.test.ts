import { describe, expect, it } from 'vitest';
import { assertArchitectureExceptionBudget } from '../scripts/quality/architecture-exception-budget.mjs';

describe('architecture exception budget', () => {
  it('accepts the current ceiling', () => {
    expect(() => assertArchitectureExceptionBudget(45, 45)).not.toThrow();
  });

  it('rejects growth beyond the ceiling', () => {
    expect(() => assertArchitectureExceptionBudget(46, 45)).toThrow(
      'architecture-boundaries: exception budget exceeded (46 > 45)'
    );
  });
});
