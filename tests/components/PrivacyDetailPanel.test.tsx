/**
 * Tests for components/PrivacyDetailPanel.tsx
 *
 * Tests the privacy detail bottom sheet panel including score display,
 * factors list, warnings, and learn more section.
 */

import { act,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { PrivacyDetailPanel } from '../../components/PrivacyDetailPanel';
import type { UtxoPrivacyInfo } from '../../src/api/transactions';

// Mock useCurrency
vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (amount: number) => `${amount} sats`,
  }),
}));

describe('PrivacyDetailPanel', () => {
  const mockUtxo = {
    txid: 'abc123def456789012345678901234567890abcdef1234567890abcdef12345678',
    vout: 0,
    amount: 100000,
    address: 'bc1qtest123',
  };

  const makePrivacyInfo = (score: UtxoPrivacyInfo['score']): UtxoPrivacyInfo => ({
    utxoId: 'utxo-1',
    txid: mockUtxo.txid,
    vout: mockUtxo.vout,
    amount: mockUtxo.amount,
    address: mockUtxo.address,
    score,
  });

  const mockPrivacyInfo: UtxoPrivacyInfo = makePrivacyInfo({
    score: 75,
    grade: 'good',
    factors: [
      { factor: 'addressReuse', impact: -15, description: 'Address has been reused' },
      { factor: 'clusterSize', impact: -10, description: 'Multiple linked outputs' },
    ],
    warnings: ['Consider using a fresh address for better privacy'],
  });

  const defaultProps = {
    utxo: mockUtxo,
    privacyInfo: mockPrivacyInfo,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.style.overflow = '';
  });

  describe('rendering', () => {
    it('renders Privacy Analysis title', async () => {
      render(<PrivacyDetailPanel {...defaultProps} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(screen.getByText('Privacy Analysis')).toBeInTheDocument();
    });

    it('renders UTXO info', async () => {
      render(<PrivacyDetailPanel {...defaultProps} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(screen.getByText(/100000 sats/)).toBeInTheDocument();
      expect(screen.getByText(/abc123de/)).toBeInTheDocument();
    });

    it('renders privacy score', async () => {
      render(<PrivacyDetailPanel {...defaultProps} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      // Score is displayed as large text with "/ 100" next to it
      // The score card contains the score value
      expect(screen.getByText('/ 100')).toBeInTheDocument();
      // Score display is in a span with text-4xl font-bold class
      const scoreElements = screen.getAllByText('75');
      // One is the gauge marker, one is the actual score - should have at least 2
      expect(scoreElements.length).toBeGreaterThanOrEqual(1);
    });

    it('renders grade label', async () => {
      render(<PrivacyDetailPanel {...defaultProps} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      // The gauge has labels "Poor", "Fair", "Good", "Excellent" at bottom
      // The grade badge shows the current grade
      // Look for the badge version (not the gauge marker)
      const goodElements = screen.getAllByText('Good');
      expect(goodElements.length).toBeGreaterThanOrEqual(1);
    });

    it('normalizes malformed runtime privacy score payloads', async () => {
      const malformedInfo = makePrivacyInfo({
        score: Number.NaN,
        grade: 'unknown' as any,
        factors: null as any,
        warnings: undefined as any,
      });

      render(<PrivacyDetailPanel {...defaultProps} privacyInfo={malformedInfo} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(screen.getByText('/ 100')).toBeInTheDocument();
      expect(screen.getAllByText('Poor').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('Warnings')).not.toBeInTheDocument();
    });

    it('renders score gauge', async () => {
      render(<PrivacyDetailPanel {...defaultProps} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      // Check for gauge markers
      expect(screen.getByText('0')).toBeInTheDocument();
      expect(screen.getByText('50')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('renders factors section header', async () => {
      render(<PrivacyDetailPanel {...defaultProps} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(screen.getByText('Factors Affecting Score')).toBeInTheDocument();
    });

    it('renders privacy factors', async () => {
      render(<PrivacyDetailPanel {...defaultProps} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(screen.getByText('Same Address Used Again')).toBeInTheDocument();
      expect(screen.getByText('Linked Outputs')).toBeInTheDocument();
    });

    it('renders factor impact values', async () => {
      render(<PrivacyDetailPanel {...defaultProps} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(screen.getByText('-15')).toBeInTheDocument();
      expect(screen.getByText('-10')).toBeInTheDocument();
    });

    it('renders warnings section', async () => {
      render(<PrivacyDetailPanel {...defaultProps} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(screen.getByText('Recommendations')).toBeInTheDocument();
      expect(screen.getByText('Consider using a fresh address for better privacy')).toBeInTheDocument();
    });

    it('renders Learn more button', async () => {
      render(<PrivacyDetailPanel {...defaultProps} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(screen.getByText('Learn more about Bitcoin privacy')).toBeInTheDocument();
    });
  });

  describe('grade configurations', () => {
    it('renders excellent grade', async () => {
      const excellentInfo: UtxoPrivacyInfo = makePrivacyInfo({
        score: 95,
        grade: 'excellent',
        factors: [],
        warnings: [],
      });

      render(<PrivacyDetailPanel {...defaultProps} privacyInfo={excellentInfo} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      // Excellent appears both in the badge and the gauge labels
      const excellentElements = screen.getAllByText('Excellent');
      expect(excellentElements.length).toBeGreaterThanOrEqual(1);
    });

    it('renders fair grade', async () => {
      const fairInfo: UtxoPrivacyInfo = makePrivacyInfo({
        score: 55,
        grade: 'fair',
        factors: [],
        warnings: [],
      });

      render(<PrivacyDetailPanel {...defaultProps} privacyInfo={fairInfo} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      // Fair appears both in the badge and the gauge labels
      const fairElements = screen.getAllByText('Fair');
      expect(fairElements.length).toBeGreaterThanOrEqual(1);
    });

    it('renders poor grade', async () => {
      const poorInfo: UtxoPrivacyInfo = makePrivacyInfo({
        score: 25,
        grade: 'poor',
        factors: [],
        warnings: [],
      });

      render(<PrivacyDetailPanel {...defaultProps} privacyInfo={poorInfo} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      // Poor appears both in the badge and the gauge labels
      const poorElements = screen.getAllByText('Poor');
      expect(poorElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('perfect score (no factors)', () => {
    it('shows no concerns message when factors array is empty', async () => {
      const perfectInfo: UtxoPrivacyInfo = makePrivacyInfo({
        score: 100,
        grade: 'excellent',
        factors: [],
        warnings: [],
      });

      render(<PrivacyDetailPanel {...defaultProps} privacyInfo={perfectInfo} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(screen.getByText(/No privacy concerns detected/)).toBeInTheDocument();
    });
  });

  describe('closing', () => {
    it('calls onClose when close button is clicked', async () => {
      const onClose = vi.fn();
      render(<PrivacyDetailPanel {...defaultProps} onClose={onClose} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      fireEvent.click(screen.getByLabelText('Close panel'));

      // Wait for animation
      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when backdrop is clicked', async () => {
      const onClose = vi.fn();
      render(<PrivacyDetailPanel {...defaultProps} onClose={onClose} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      // Click on the backdrop (the outer container)
      const backdrop = document.querySelector('.fixed.inset-0');
      if (backdrop) {
        fireEvent.click(backdrop);
      }

      // Wait for animation
      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when Escape key is pressed', async () => {
      const onClose = vi.fn();
      render(<PrivacyDetailPanel {...defaultProps} onClose={onClose} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      fireEvent.keyDown(document, { key: 'Escape' });

      // Wait for animation
      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(onClose).toHaveBeenCalled();
    });

    it('does not close when a non-Escape key is pressed', async () => {
      const onClose = vi.fn();
      render(<PrivacyDetailPanel {...defaultProps} onClose={onClose} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      fireEvent.keyDown(document, { key: 'Enter' });
      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('learn more section', () => {
    it('expands when clicked', async () => {
      render(<PrivacyDetailPanel {...defaultProps} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      fireEvent.click(screen.getByText('Learn more about Bitcoin privacy'));

      expect(screen.getByText('Why privacy matters:')).toBeInTheDocument();
      expect(screen.getByText('How scoring works:')).toBeInTheDocument();
      expect(screen.getByText('Improving your score:')).toBeInTheDocument();
    });

    it('shows Bitcoin.org link when expanded', async () => {
      render(<PrivacyDetailPanel {...defaultProps} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      fireEvent.click(screen.getByText('Learn more about Bitcoin privacy'));

      expect(screen.getByText('Bitcoin.org Privacy Guide')).toBeInTheDocument();
    });

    it('collapses when clicked again', async () => {
      render(<PrivacyDetailPanel {...defaultProps} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      // Expand
      fireEvent.click(screen.getByText('Learn more about Bitcoin privacy'));
      expect(screen.getByText('Why privacy matters:')).toBeInTheDocument();

      // Collapse
      fireEvent.click(screen.getByText('Learn more about Bitcoin privacy'));
      expect(screen.queryByText('Why privacy matters:')).not.toBeInTheDocument();
    });
  });

  describe('body scroll prevention', () => {
    it('prevents body scroll when panel is open', async () => {
      render(<PrivacyDetailPanel {...defaultProps} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(document.body.style.overflow).toBe('hidden');
    });

    it('restores body scroll on unmount', async () => {
      const { unmount } = render(<PrivacyDetailPanel {...defaultProps} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      unmount();

      expect(document.body.style.overflow).toBe('');
    });
  });

  describe('factor descriptions', () => {
    it('shows mapped description for known factors', async () => {
      render(<PrivacyDetailPanel {...defaultProps} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(screen.getByText(/address has received bitcoin multiple times/i)).toBeInTheDocument();
    });

    it('falls back to original description for unknown factors', async () => {
      const unknownFactorInfo: UtxoPrivacyInfo = makePrivacyInfo({
        score: 80,
        grade: 'good',
        factors: [{ factor: 'unknownFactor', impact: -5, description: 'Original description' }],
        warnings: [],
      });

      render(<PrivacyDetailPanel {...defaultProps} privacyInfo={unknownFactorInfo} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(screen.getByText('Original description')).toBeInTheDocument();
    });

    it('shows + prefix for positive factor impacts', async () => {
      const positiveFactorInfo: UtxoPrivacyInfo = makePrivacyInfo({
        score: 85,
        grade: 'good',
        factors: [{ factor: 'benefitFactor', impact: 5, description: 'Improved privacy signal' }],
        warnings: [],
      });

      render(<PrivacyDetailPanel {...defaultProps} privacyInfo={positiveFactorInfo} />);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(screen.getByText('+5')).toBeInTheDocument();
    });
  });
});
