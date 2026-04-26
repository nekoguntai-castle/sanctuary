import { describe, expect, it } from 'vitest';
import {
  FEATURE_FLAG_KEYS,
  getFeatureFlagDefinition,
  isKnownFeatureFlagKey,
  UNKNOWN_FEATURE_FLAG_KEY_MESSAGE,
} from '../../../../src/services/featureFlags/definitions';

describe('feature flag definitions', () => {
  it('exposes known keys including treasuryAutopilot and treasuryIntelligence', () => {
    expect(FEATURE_FLAG_KEYS).toContain('treasuryAutopilot');
    expect(FEATURE_FLAG_KEYS).toContain('treasuryIntelligence');
    expect(FEATURE_FLAG_KEYS).toContain('aiAssistant');
    expect(FEATURE_FLAG_KEYS).toContain('sanctuaryConsole');
  });

  it('detects known and unknown feature flag keys', () => {
    expect(isKnownFeatureFlagKey('aiAssistant')).toBe(true);
    expect(isKnownFeatureFlagKey('sanctuaryConsole')).toBe(true);
    expect(isKnownFeatureFlagKey('experimental.taprootAddresses')).toBe(true);
    expect(isKnownFeatureFlagKey('notAFlag')).toBe(false);
  });

  it('returns runtime side-effect metadata for treasuryAutopilot', () => {
    const definition = getFeatureFlagDefinition('treasuryAutopilot');

    expect(definition).toEqual(
      expect.objectContaining({
        category: 'general',
        hasSideEffects: true,
        sideEffectDescription: expect.stringContaining('starts or stops background consolidation jobs'),
      })
    );
  });

  it('returns runtime side-effect metadata for treasuryIntelligence', () => {
    const definition = getFeatureFlagDefinition('treasuryIntelligence');

    expect(definition).toEqual(
      expect.objectContaining({
        category: 'general',
        hasSideEffects: true,
        sideEffectDescription: expect.stringContaining('Ollama-compatible LLM endpoint'),
      })
    );
  });

  it('returns undefined for unknown keys', () => {
    expect(getFeatureFlagDefinition('notAFlag')).toBeUndefined();
  });

  it('exports a stable unknown-key validation message', () => {
    expect(UNKNOWN_FEATURE_FLAG_KEY_MESSAGE).toBe('Unknown feature flag key');
  });
});
