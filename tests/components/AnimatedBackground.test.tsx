/**
 * Animated Background Tests
 *
 * Tests for the animated background pattern detection and registration.
 */

import { render,waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const { useSakuraPetalsMock, useFirefliesMock } = vi.hoisted(() => ({
  useSakuraPetalsMock: vi.fn(),
  useFirefliesMock: vi.fn(),
}));

vi.mock('../../src/components/animations/sakuraPetals.ts', () => ({
  useSakuraPetals: useSakuraPetalsMock,
}));

vi.mock('../../src/components/animations/fireflies.ts', () => ({
  useFireflies: useFirefliesMock,
}));

import {
ANIMATED_PATTERNS,
AnimatedBackground,
AnimatedPatternId,
isAnimatedPattern,
} from '../../src/components/AnimatedBackground';
import { globalPatterns } from '../../src/themes/patterns';

const animationModules = import.meta.glob('../../src/components/animations/*.ts');

const toCamelCase = (pattern: string): string => {
  const [firstPart, ...remainingParts] = pattern.split('-');
  return [
    firstPart,
    ...remainingParts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)),
  ].join('');
};

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
    it('derives animated patterns from registered pattern metadata', () => {
      const animatedInRegistry = globalPatterns
        .filter((p) => p.animated === true)
        .map((p) => p.id);

      expect(ANIMATED_PATTERNS).toEqual(animatedInRegistry);
    });

    it('keeps every registered animated pattern matched to a lazy-loadable module', () => {
      const animationModuleNames = Object.keys(animationModules)
        .map((modulePath) => modulePath.split('/').pop()?.replace(/\.ts$/, ''))
        .filter((moduleName): moduleName is string => Boolean(moduleName) && moduleName !== 'index');
      const animationModuleNameSet = new Set(animationModuleNames);
      const animatedPatternModuleNames = ANIMATED_PATTERNS.map(toCamelCase);

      expect(ANIMATED_PATTERNS.filter((pattern) => !animationModuleNameSet.has(toCamelCase(pattern)))).toEqual([]);
      expect(animationModuleNames.filter((moduleName) => !animatedPatternModuleNames.includes(moduleName))).toEqual([]);
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
    const staticPatterns = [
      'minimal',
      'zen',
      'dots',
      'cross',
      'noise',
      'circuit',
      'topography',
      'waves',
      'lines',
      'sanctuary',
      'sanctuary-hero',
      'hexagons',
      'triangles',
      'stars',
      'aurora',
      'mountains',
    ];

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

    it('clears active hook when switching between animated patterns to prevent hook count mismatch', async () => {
      const { container, rerender } = render(
        <AnimatedBackground pattern="sakura-petals" darkMode={true} opacity={70} />
      );

      await waitFor(() => {
        expect(useSakuraPetalsMock).toHaveBeenCalled();
      });

      // Switch to a different animated pattern — should not throw
      // "Cannot read properties of undefined (reading 'length')"
      rerender(<AnimatedBackground pattern="fireflies" darkMode={true} opacity={70} />);

      // Canvas should still be present during transition
      expect(container.querySelector('canvas')).not.toBeNull();

      await waitFor(() => {
        expect(useFirefliesMock).toHaveBeenCalled();
      });
    });
  });
});
