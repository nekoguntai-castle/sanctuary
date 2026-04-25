/**
 * Tests for PrivacyBadge components
 */

import { fireEvent,render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe,expect,it,vi } from 'vitest';
import {
PrivacyBadge,
PrivacyScoreCard,
WalletPrivacySummary,
} from '../../components/PrivacyBadge';

describe('PrivacyBadge', () => {
  describe('rendering', () => {
    it('renders with excellent grade', () => {
      render(<PrivacyBadge score={95} grade="excellent" />);

      expect(screen.getByTitle(/Excellent Privacy/)).toBeInTheDocument();
    });

    it('renders with good grade', () => {
      render(<PrivacyBadge score={75} grade="good" />);

      expect(screen.getByTitle(/Good Privacy/)).toBeInTheDocument();
    });

    it('renders with fair grade', () => {
      render(<PrivacyBadge score={55} grade="fair" />);

      expect(screen.getByTitle(/Fair Privacy/)).toBeInTheDocument();
    });

    it('renders with poor grade', () => {
      render(<PrivacyBadge score={25} grade="poor" />);

      expect(screen.getByTitle(/Poor Privacy/)).toBeInTheDocument();
    });

    it('includes score in title', () => {
      render(<PrivacyBadge score={85} grade="excellent" />);

      expect(screen.getByTitle(/Score: 85/)).toBeInTheDocument();
    });

    it('normalizes invalid runtime grade and score values', () => {
      render(<PrivacyBadge score={Number.NaN} grade={'unknown' as any} showScore />);

      expect(screen.getByTitle(/Poor Privacy/)).toBeInTheDocument();
      expect(screen.getByTitle(/Score: 0/)).toBeInTheDocument();
      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });

  describe('showScore prop', () => {
    it('hides score by default', () => {
      render(<PrivacyBadge score={85} grade="excellent" />);

      expect(screen.queryByText('85')).not.toBeInTheDocument();
    });

    it('shows score when showScore is true', () => {
      render(<PrivacyBadge score={85} grade="excellent" showScore />);

      expect(screen.getByText('85')).toBeInTheDocument();
    });
  });

  describe('size prop', () => {
    it('renders small size by default', () => {
      const { container } = render(<PrivacyBadge score={85} grade="excellent" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('w-3.5', 'h-3.5');
    });

    it('renders medium size', () => {
      const { container } = render(<PrivacyBadge score={85} grade="excellent" size="md" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('w-4', 'h-4');
    });

    it('renders large size', () => {
      const { container } = render(<PrivacyBadge score={85} grade="excellent" size="lg" />);

      const svg = container.querySelector('svg');
      expect(svg).toHaveClass('w-5', 'h-5');
    });
  });

  describe('click handling', () => {
    it('is not clickable by default', () => {
      const { container } = render(<PrivacyBadge score={85} grade="excellent" />);

      const badge = container.firstChild;
      expect(badge).not.toHaveAttribute('role', 'button');
      expect(badge).not.toHaveAttribute('tabindex');
    });

    it('becomes clickable with onClick prop', () => {
      const handleClick = vi.fn();
      const { container } = render(
        <PrivacyBadge score={85} grade="excellent" onClick={handleClick} />
      );

      const badge = container.firstChild;
      expect(badge).toHaveAttribute('role', 'button');
      expect(badge).toHaveAttribute('tabindex', '0');
    });

    it('calls onClick when clicked', async () => {
      const handleClick = vi.fn();
      const user = userEvent.setup();
      const { container } = render(
        <PrivacyBadge score={85} grade="excellent" onClick={handleClick} />
      );

      await user.click(container.firstChild as Element);

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('calls onClick on Enter key', () => {
      const handleClick = vi.fn();
      const { container } = render(
        <PrivacyBadge score={85} grade="excellent" onClick={handleClick} />
      );

      fireEvent.keyDown(container.firstChild as Element, { key: 'Enter' });

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('calls onClick on Space key', () => {
      const handleClick = vi.fn();
      const { container } = render(
        <PrivacyBadge score={85} grade="excellent" onClick={handleClick} />
      );

      fireEvent.keyDown(container.firstChild as Element, { key: ' ' });

      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('does not call onClick on non-activation key', () => {
      const handleClick = vi.fn();
      const { container } = render(
        <PrivacyBadge score={85} grade="excellent" onClick={handleClick} />
      );

      fireEvent.keyDown(container.firstChild as Element, { key: 'Escape' });

      expect(handleClick).not.toHaveBeenCalled();
    });

    it('shows click hint in title when clickable', () => {
      const handleClick = vi.fn();
      render(<PrivacyBadge score={85} grade="excellent" onClick={handleClick} />);

      expect(screen.getByTitle(/Click for details/)).toBeInTheDocument();
    });
  });

  describe('className prop', () => {
    it('applies custom className', () => {
      const { container } = render(
        <PrivacyBadge score={85} grade="excellent" className="custom-class" />
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });
  });
});

describe('PrivacyScoreCard', () => {
  const defaultProps = {
    score: 75,
    grade: 'good' as const,
    factors: [],
    warnings: [],
  };

  describe('rendering', () => {
    it('renders grade label', () => {
      render(<PrivacyScoreCard {...defaultProps} />);

      expect(screen.getByText('good Privacy')).toBeInTheDocument();
    });

    it('renders score', () => {
      render(<PrivacyScoreCard {...defaultProps} score={85} />);

      expect(screen.getByText('85')).toBeInTheDocument();
    });

    it('renders with excellent grade styling', () => {
      const { container } = render(
        <PrivacyScoreCard {...defaultProps} grade="excellent" />
      );

      expect(container.firstChild).toHaveClass('text-zen-matcha');
    });

    it('renders with poor grade styling', () => {
      const { container } = render(
        <PrivacyScoreCard {...defaultProps} grade="poor" />
      );

      expect(container.firstChild).toHaveClass('text-zen-vermilion');
    });

    it('normalizes invalid runtime grade, score, factors, and warnings', () => {
      const { container } = render(
        <PrivacyScoreCard
          {...defaultProps}
          score={Number.POSITIVE_INFINITY}
          grade={'missing' as any}
          factors={null as any}
          warnings={undefined as any}
        />
      );

      expect(container.firstChild).toHaveClass('text-zen-vermilion');
      expect(screen.getByText('poor Privacy')).toBeInTheDocument();
      expect(screen.getByText('0')).toBeInTheDocument();
      expect(container.querySelectorAll('.space-y-1').length).toBe(0);
      expect(document.querySelector('.border-t')).not.toBeInTheDocument();
    });
  });

  describe('factors display', () => {
    it('renders factors when provided', () => {
      const factors = [
        { factor: 'Address Reuse', impact: -10, description: 'Address was reused' },
        { factor: 'UTXO Age', impact: 5, description: 'Well-aged UTXO' },
      ];

      render(<PrivacyScoreCard {...defaultProps} factors={factors} />);

      expect(screen.getByText('Address Reuse')).toBeInTheDocument();
      expect(screen.getByText('UTXO Age')).toBeInTheDocument();
    });

    it('shows negative impact with red styling', () => {
      const factors = [
        { factor: 'Bad Factor', impact: -15, description: 'Negative impact' },
      ];

      render(<PrivacyScoreCard {...defaultProps} factors={factors} />);

      const impactElement = screen.getByText('-15');
      expect(impactElement).toHaveClass('text-zen-vermilion');
    });

    it('shows positive impact with green styling', () => {
      const factors = [
        { factor: 'Good Factor', impact: 10, description: 'Positive impact' },
      ];

      render(<PrivacyScoreCard {...defaultProps} factors={factors} />);

      const impactElement = screen.getByText('+10');
      expect(impactElement).toHaveClass('text-zen-matcha');
    });

    it('formats positive impact with + prefix', () => {
      const factors = [
        { factor: 'Positive', impact: 5, description: 'Good' },
      ];

      render(<PrivacyScoreCard {...defaultProps} factors={factors} />);

      expect(screen.getByText('+5')).toBeInTheDocument();
    });

    it('does not show factors section when empty', () => {
      const { container } = render(
        <PrivacyScoreCard {...defaultProps} factors={[]} />
      );

      // Should only have the header section, not factors
      expect(container.querySelectorAll('.space-y-1').length).toBe(0);
    });
  });

  describe('warnings display', () => {
    it('renders warnings when provided', () => {
      const warnings = [
        'This UTXO is linked to other transactions',
        'Consider consolidating',
      ];

      render(<PrivacyScoreCard {...defaultProps} warnings={warnings} />);

      expect(screen.getByText('This UTXO is linked to other transactions')).toBeInTheDocument();
      expect(screen.getByText('Consider consolidating')).toBeInTheDocument();
    });

    it('does not show warnings section when empty', () => {
      render(<PrivacyScoreCard {...defaultProps} warnings={[]} />);

      // No border-t separator should be present
      expect(document.querySelector('.border-t')).not.toBeInTheDocument();
    });
  });
});

describe('WalletPrivacySummary', () => {
  const defaultProps = {
    averageScore: 70,
    grade: 'good' as const,
    addressReuseCount: 3,
    roundAmountCount: 5,
    clusterCount: 2,
    recommendations: [],
  };

  describe('rendering', () => {
    it('renders privacy analysis header', () => {
      render(<WalletPrivacySummary {...defaultProps} />);

      expect(screen.getByText('Privacy Analysis')).toBeInTheDocument();
    });

    it('renders privacy badge with score', () => {
      render(<WalletPrivacySummary {...defaultProps} averageScore={85} />);

      expect(screen.getByText('85')).toBeInTheDocument();
    });

    it('normalizes invalid runtime recommendation lists', () => {
      render(<WalletPrivacySummary {...defaultProps} recommendations={null as any} />);

      expect(screen.queryByText('Recommendations')).not.toBeInTheDocument();
    });
  });

  describe('metrics display', () => {
    it('displays address reuse count', () => {
      render(<WalletPrivacySummary {...defaultProps} addressReuseCount={7} />);

      expect(screen.getByText('7')).toBeInTheDocument();
      expect(screen.getByText('Reused Addresses')).toBeInTheDocument();
    });

    it('displays round amount count', () => {
      render(<WalletPrivacySummary {...defaultProps} roundAmountCount={12} />);

      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('Round Amounts')).toBeInTheDocument();
    });

    it('displays cluster count', () => {
      render(<WalletPrivacySummary {...defaultProps} clusterCount={4} />);

      expect(screen.getByText('4')).toBeInTheDocument();
      expect(screen.getByText('Linked Clusters')).toBeInTheDocument();
    });
  });

  describe('recommendations display', () => {
    it('renders recommendations when provided', () => {
      const recommendations = [
        'Avoid address reuse for better privacy',
        'Consider using Payjoin for transactions',
      ];

      render(<WalletPrivacySummary {...defaultProps} recommendations={recommendations} />);

      expect(screen.getByText('Recommendations')).toBeInTheDocument();
      expect(screen.getByText('Avoid address reuse for better privacy')).toBeInTheDocument();
      expect(screen.getByText('Consider using Payjoin for transactions')).toBeInTheDocument();
    });

    it('does not show recommendations section when empty', () => {
      render(<WalletPrivacySummary {...defaultProps} recommendations={[]} />);

      expect(screen.queryByText('Recommendations')).not.toBeInTheDocument();
    });
  });

  describe('grade variants', () => {
    it('renders excellent grade', () => {
      render(<WalletPrivacySummary {...defaultProps} grade="excellent" />);

      expect(screen.getByTitle(/Excellent Privacy/)).toBeInTheDocument();
    });

    it('renders fair grade', () => {
      render(<WalletPrivacySummary {...defaultProps} grade="fair" />);

      expect(screen.getByTitle(/Fair Privacy/)).toBeInTheDocument();
    });

    it('renders poor grade', () => {
      render(<WalletPrivacySummary {...defaultProps} grade="poor" />);

      expect(screen.getByTitle(/Poor Privacy/)).toBeInTheDocument();
    });
  });
});
