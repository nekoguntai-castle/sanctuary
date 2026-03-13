/**
 * Animated Background Tests
 *
 * Tests for the animated background pattern detection and registration.
 */

import { render,waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const { useSakuraPetalsMock } = vi.hoisted(() => ({
  useSakuraPetalsMock: vi.fn(),
}));

vi.mock('../../components/animations/sakuraPetals.ts', () => ({
  useSakuraPetals: useSakuraPetalsMock,
}));

import {
ANIMATED_PATTERNS,
AnimatedBackground,
AnimatedPatternId,
isAnimatedPattern,
} from '../../components/AnimatedBackground';
import { globalPatterns } from '../../themes/patterns';

describe('AnimatedBackground', () => {
  describe('ANIMATED_PATTERNS array', () => {
    it('should contain paper-airplanes pattern', () => {
      expect(ANIMATED_PATTERNS).toContain('paper-airplanes');
    });

    it('should contain paper-boats pattern', () => {
      expect(ANIMATED_PATTERNS).toContain('paper-boats');
    });

    it('should contain thunderstorm pattern', () => {
      expect(ANIMATED_PATTERNS).toContain('thunderstorm');
    });

    it('should contain sakura-petals pattern', () => {
      expect(ANIMATED_PATTERNS).toContain('sakura-petals');
    });

    it('should contain snowfall pattern', () => {
      expect(ANIMATED_PATTERNS).toContain('snowfall');
    });

    it('should contain fireflies pattern', () => {
      expect(ANIMATED_PATTERNS).toContain('fireflies');
    });

    it('should contain falling-leaves pattern', () => {
      expect(ANIMATED_PATTERNS).toContain('falling-leaves');
    });

    it('should have no duplicate patterns', () => {
      const uniquePatterns = new Set(ANIMATED_PATTERNS);
      expect(uniquePatterns.size).toBe(ANIMATED_PATTERNS.length);
    });

    it('should have at least 50 animated patterns', () => {
      expect(ANIMATED_PATTERNS.length).toBeGreaterThanOrEqual(50);
    });
  });

  describe('isAnimatedPattern', () => {
    it('should return true for paper-airplanes', () => {
      expect(isAnimatedPattern('paper-airplanes')).toBe(true);
    });

    it('should return true for paper-boats', () => {
      expect(isAnimatedPattern('paper-boats')).toBe(true);
    });

    it('should return true for thunderstorm', () => {
      expect(isAnimatedPattern('thunderstorm')).toBe(true);
    });

    it('should return true for sakura-petals', () => {
      expect(isAnimatedPattern('sakura-petals')).toBe(true);
    });

    it('should return true for all patterns in ANIMATED_PATTERNS', () => {
      ANIMATED_PATTERNS.forEach((pattern) => {
        expect(isAnimatedPattern(pattern)).toBe(true);
      });
    });

    it('should return false for minimal (static pattern)', () => {
      expect(isAnimatedPattern('minimal')).toBe(false);
    });

    it('should return false for zen (static pattern)', () => {
      expect(isAnimatedPattern('zen')).toBe(false);
    });

    it('should return false for circuit (static pattern)', () => {
      expect(isAnimatedPattern('circuit')).toBe(false);
    });

    it('should return false for non-existent pattern', () => {
      expect(isAnimatedPattern('not-a-real-pattern')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isAnimatedPattern('')).toBe(false);
    });
  });

  describe('Pattern Registry Consistency', () => {
    it('should have all animated patterns marked as animated in globalPatterns', () => {
      const animatedInRegistry = globalPatterns
        .filter((p) => p.animated === true)
        .map((p) => p.id);

      // Every pattern in ANIMATED_PATTERNS should be marked animated in globalPatterns
      ANIMATED_PATTERNS.forEach((patternId) => {
        expect(animatedInRegistry).toContain(patternId);
      });
    });

    it('should have all animated patterns from globalPatterns in ANIMATED_PATTERNS', () => {
      const animatedInRegistry = globalPatterns
        .filter((p) => p.animated === true)
        .map((p) => p.id);

      // Every animated pattern in globalPatterns should be in ANIMATED_PATTERNS
      animatedInRegistry.forEach((patternId) => {
        expect(ANIMATED_PATTERNS).toContain(patternId as AnimatedPatternId);
      });
    });

    it('should have matching counts between globalPatterns and ANIMATED_PATTERNS', () => {
      const animatedCount = globalPatterns.filter((p) => p.animated === true).length;
      expect(animatedCount).toBe(ANIMATED_PATTERNS.length);
    });
  });

  describe('Pattern Metadata', () => {
    it('paper-airplanes should have correct metadata in globalPatterns', () => {
      const pattern = globalPatterns.find((p) => p.id === 'paper-airplanes');
      expect(pattern).toBeDefined();
      expect(pattern?.name).toBe('Paper Airplanes');
      expect(pattern?.animated).toBe(true);
    });

    it('paper-boats should have correct metadata in globalPatterns', () => {
      const pattern = globalPatterns.find((p) => p.id === 'paper-boats');
      expect(pattern).toBeDefined();
      expect(pattern?.name).toBe('Paper Boats');
      expect(pattern?.animated).toBe(true);
    });

    it('thunderstorm should have correct metadata in globalPatterns', () => {
      const pattern = globalPatterns.find((p) => p.id === 'thunderstorm');
      expect(pattern).toBeDefined();
      expect(pattern?.name).toBe('Thunderstorm');
      expect(pattern?.animated).toBe(true);
    });

    it('all animated patterns should have name and description', () => {
      ANIMATED_PATTERNS.forEach((patternId) => {
        const pattern = globalPatterns.find((p) => p.id === patternId);
        expect(pattern).toBeDefined();
        expect((pattern?.name ?? '').length).toBeGreaterThan(0);
        expect((pattern?.description ?? '').length).toBeGreaterThan(0);
      });
    });
  });

  describe('Static Patterns', () => {
    const staticPatterns = ['minimal', 'zen', 'circuit', 'topography', 'waves', 'lines', 'hexagons', 'stars'];

    staticPatterns.forEach((patternId) => {
      it(`${patternId} should not be marked as animated`, () => {
        const pattern = globalPatterns.find((p) => p.id === patternId);
        expect(pattern).toBeDefined();
        expect(pattern?.animated).not.toBe(true);
      });

      it(`${patternId} should not be in ANIMATED_PATTERNS`, () => {
        expect(ANIMATED_PATTERNS).not.toContain(patternId as AnimatedPatternId);
      });
    });
  });

  describe('Component Rendering', () => {
    it('renders canvas for animated pattern', async () => {
      const { container } = render(<AnimatedBackground pattern="sakura-petals" darkMode={true} opacity={70} />);
      const canvas = container.querySelector('canvas');
      expect(canvas).not.toBeNull();
      expect(canvas).toHaveStyle({ opacity: '0.7' });

      await waitFor(() => {
        expect(useSakuraPetalsMock).toHaveBeenCalled();
      });
    });

    it('returns null for non-animated pattern', () => {
      const { container } = render(<AnimatedBackground pattern="minimal" darkMode={false} />);
      expect(container.firstChild).toBeNull();
    });
  });
});
