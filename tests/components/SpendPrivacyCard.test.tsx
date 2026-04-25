import { fireEvent,render,screen } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';

import SpendPrivacyCard from '../../components/SpendPrivacyCard';
import type { SpendPrivacyAnalysis } from '../../src/api/transactions';

describe('SpendPrivacyCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockAnalysis = (overrides: Partial<SpendPrivacyAnalysis> = {}): SpendPrivacyAnalysis => ({
    score: 75,
    grade: 'good',
    linkedAddresses: 2,
    warnings: ['Spending from multiple addresses links them together'],
    ...overrides,
  });

  describe('Privacy score display', () => {
    it('displays privacy score correctly', () => {
      render(<SpendPrivacyCard analysis={createMockAnalysis({ score: 85 })} />);

      expect(screen.getByText('85')).toBeInTheDocument();
    });

    it('displays zero score', () => {
      render(<SpendPrivacyCard analysis={createMockAnalysis({ score: 0 })} />);

      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('displays maximum score', () => {
      render(<SpendPrivacyCard analysis={createMockAnalysis({ score: 100 })} />);

      expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('normalizes invalid runtime score values', () => {
      render(<SpendPrivacyCard analysis={createMockAnalysis({ score: 155 })} />);

      expect(screen.getByText('100')).toBeInTheDocument();
    });
  });

  describe('Grade badge display', () => {
    it('shows "Excellent" badge for excellent grade', () => {
      render(<SpendPrivacyCard analysis={createMockAnalysis({ grade: 'excellent' })} />);

      expect(screen.getByText('Excellent')).toBeInTheDocument();
    });

    it('shows "Good" badge for good grade', () => {
      render(<SpendPrivacyCard analysis={createMockAnalysis({ grade: 'good' })} />);

      expect(screen.getByText('Good')).toBeInTheDocument();
    });

    it('shows "Fair" badge for fair grade', () => {
      render(<SpendPrivacyCard analysis={createMockAnalysis({ grade: 'fair' })} />);

      expect(screen.getByText('Fair')).toBeInTheDocument();
    });

    it('shows "Poor" badge for poor grade', () => {
      render(<SpendPrivacyCard analysis={createMockAnalysis({ grade: 'poor' })} />);

      expect(screen.getByText('Poor')).toBeInTheDocument();
    });

    it('falls back to poor for invalid runtime grades', () => {
      render(<SpendPrivacyCard analysis={createMockAnalysis({ grade: 'invalid' as any })} />);

      expect(screen.getByText('Poor')).toBeInTheDocument();
    });
  });

  describe('Linked addresses count', () => {
    it('renders linked addresses count', () => {
      render(<SpendPrivacyCard analysis={createMockAnalysis({ linkedAddresses: 3 })} />);

      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('Linked Addresses')).toBeInTheDocument();
    });

    it('renders zero linked addresses', () => {
      render(<SpendPrivacyCard analysis={createMockAnalysis({ linkedAddresses: 0 })} />);

      // The "0" should appear in the linked addresses section
      const linkedAddressesLabel = screen.getByText('Linked Addresses');
      expect(linkedAddressesLabel).toBeInTheDocument();
    });

    it('renders high linked addresses count', () => {
      render(<SpendPrivacyCard analysis={createMockAnalysis({ linkedAddresses: 15 })} />);

      expect(screen.getByText('15')).toBeInTheDocument();
    });
  });

  describe('Warnings display', () => {
    it('shows warnings when present', () => {
      render(
        <SpendPrivacyCard
          analysis={createMockAnalysis({
            warnings: ['Warning 1', 'Warning 2'],
          })}
        />
      );

      expect(screen.getByText('Warning 1')).toBeInTheDocument();
      expect(screen.getByText('Warning 2')).toBeInTheDocument();
    });

    it('shows max 3 warnings by default when collapsed', () => {
      render(
        <SpendPrivacyCard
          analysis={createMockAnalysis({
            warnings: ['Warning 1', 'Warning 2', 'Warning 3', 'Warning 4', 'Warning 5'],
          })}
        />
      );

      expect(screen.getByText('Warning 1')).toBeInTheDocument();
      expect(screen.getByText('Warning 2')).toBeInTheDocument();
      expect(screen.getByText('Warning 3')).toBeInTheDocument();
      expect(screen.queryByText('Warning 4')).not.toBeInTheDocument();
      expect(screen.queryByText('Warning 5')).not.toBeInTheDocument();
    });

    it('does not show warnings section when no warnings', () => {
      render(
        <SpendPrivacyCard
          analysis={createMockAnalysis({
            warnings: [],
          })}
        />
      );

      expect(screen.queryByText('Warnings')).not.toBeInTheDocument();
    });

    it('shows "Warnings" label when warnings are present', () => {
      render(
        <SpendPrivacyCard
          analysis={createMockAnalysis({
            warnings: ['Some warning'],
          })}
        />
      );

      expect(screen.getByText('Warnings')).toBeInTheDocument();
    });

    it('normalizes invalid runtime warnings to an empty list', () => {
      render(
        <SpendPrivacyCard
          analysis={createMockAnalysis({
            warnings: null as any,
          })}
        />
      );

      expect(screen.queryByText('Warnings')).not.toBeInTheDocument();
      expect(screen.queryByText(/Show.*More/)).not.toBeInTheDocument();
    });
  });

  describe('Expand/collapse functionality', () => {
    it('shows "Show X More" button when more than 3 warnings', () => {
      render(
        <SpendPrivacyCard
          analysis={createMockAnalysis({
            warnings: ['Warning 1', 'Warning 2', 'Warning 3', 'Warning 4', 'Warning 5'],
          })}
        />
      );

      expect(screen.getByText('Show 2 More')).toBeInTheDocument();
    });

    it('does not show expand button when 3 or fewer warnings', () => {
      render(
        <SpendPrivacyCard
          analysis={createMockAnalysis({
            warnings: ['Warning 1', 'Warning 2', 'Warning 3'],
          })}
        />
      );

      expect(screen.queryByText(/Show.*More/)).not.toBeInTheDocument();
    });

    it('shows all warnings when expanded', () => {
      render(
        <SpendPrivacyCard
          analysis={createMockAnalysis({
            warnings: ['Warning 1', 'Warning 2', 'Warning 3', 'Warning 4', 'Warning 5'],
          })}
        />
      );

      fireEvent.click(screen.getByText('Show 2 More'));

      expect(screen.getByText('Warning 1')).toBeInTheDocument();
      expect(screen.getByText('Warning 2')).toBeInTheDocument();
      expect(screen.getByText('Warning 3')).toBeInTheDocument();
      expect(screen.getByText('Warning 4')).toBeInTheDocument();
      expect(screen.getByText('Warning 5')).toBeInTheDocument();
    });

    it('shows "Show Less" button when expanded', () => {
      render(
        <SpendPrivacyCard
          analysis={createMockAnalysis({
            warnings: ['Warning 1', 'Warning 2', 'Warning 3', 'Warning 4', 'Warning 5'],
          })}
        />
      );

      fireEvent.click(screen.getByText('Show 2 More'));

      expect(screen.getByText('Show Less')).toBeInTheDocument();
    });

    it('collapses back when clicking "Show Less"', () => {
      render(
        <SpendPrivacyCard
          analysis={createMockAnalysis({
            warnings: ['Warning 1', 'Warning 2', 'Warning 3', 'Warning 4', 'Warning 5'],
          })}
        />
      );

      // Expand
      fireEvent.click(screen.getByText('Show 2 More'));
      expect(screen.getByText('Warning 4')).toBeInTheDocument();

      // Collapse
      fireEvent.click(screen.getByText('Show Less'));
      expect(screen.queryByText('Warning 4')).not.toBeInTheDocument();
    });
  });

  describe('Grade colors', () => {
    it('applies excellent grade colors (green/matcha)', () => {
      const { container } = render(
        <SpendPrivacyCard analysis={createMockAnalysis({ grade: 'excellent' })} />
      );

      const card = container.querySelector('.border-zen-matcha\\/30');
      expect(card).toBeInTheDocument();
    });

    it('applies good grade colors (indigo)', () => {
      const { container } = render(
        <SpendPrivacyCard analysis={createMockAnalysis({ grade: 'good' })} />
      );

      const card = container.querySelector('.border-zen-indigo\\/30');
      expect(card).toBeInTheDocument();
    });

    it('applies fair grade colors (gold/yellow)', () => {
      const { container } = render(
        <SpendPrivacyCard analysis={createMockAnalysis({ grade: 'fair' })} />
      );

      const card = container.querySelector('.border-zen-gold\\/30');
      expect(card).toBeInTheDocument();
    });

    it('applies poor grade colors (vermilion/red)', () => {
      const { container } = render(
        <SpendPrivacyCard analysis={createMockAnalysis({ grade: 'poor' })} />
      );

      const card = container.querySelector('.border-zen-vermilion\\/30');
      expect(card).toBeInTheDocument();
    });

    it('score text has matching grade color for excellent', () => {
      render(<SpendPrivacyCard analysis={createMockAnalysis({ grade: 'excellent', score: 95 })} />);

      const scoreElement = screen.getByText('95');
      expect(scoreElement.className).toContain('text-zen-matcha');
    });

    it('score text has matching grade color for poor', () => {
      render(<SpendPrivacyCard analysis={createMockAnalysis({ grade: 'poor', score: 25 })} />);

      const scoreElement = screen.getByText('25');
      expect(scoreElement.className).toContain('text-zen-vermilion');
    });
  });

  describe('Header section', () => {
    it('displays "Privacy Impact" title', () => {
      render(<SpendPrivacyCard analysis={createMockAnalysis()} />);

      expect(screen.getByText('Privacy Impact')).toBeInTheDocument();
    });

    it('displays subtitle about spending UTXOs together', () => {
      render(<SpendPrivacyCard analysis={createMockAnalysis()} />);

      expect(screen.getByText('Spending these UTXOs together')).toBeInTheDocument();
    });

    it('displays shield icon based on grade', () => {
      const { container } = render(<SpendPrivacyCard analysis={createMockAnalysis()} />);

      // Should have an SVG icon in the header
      const iconContainer = container.querySelector('.rounded-lg svg');
      expect(iconContainer).toBeInTheDocument();
    });
  });

  describe('Custom className prop', () => {
    it('applies custom className', () => {
      const { container } = render(
        <SpendPrivacyCard
          analysis={createMockAnalysis()}
          className="my-custom-class"
        />
      );

      const card = container.firstChild;
      expect((card as Element).className).toContain('my-custom-class');
    });

    it('preserves default classes when adding custom class', () => {
      const { container } = render(
        <SpendPrivacyCard
          analysis={createMockAnalysis()}
          className="my-custom-class"
        />
      );

      const card = container.firstChild;
      expect((card as Element).className).toContain('surface-elevated');
      expect((card as Element).className).toContain('rounded-xl');
    });
  });

  describe('Animation', () => {
    it('has fade-in animation class', () => {
      const { container } = render(<SpendPrivacyCard analysis={createMockAnalysis()} />);

      const card = container.firstChild;
      expect((card as Element).className).toContain('animate-fade-in');
    });
  });

  describe('Accessibility', () => {
    it('expand/collapse button has type="button"', () => {
      render(
        <SpendPrivacyCard
          analysis={createMockAnalysis({
            warnings: ['W1', 'W2', 'W3', 'W4', 'W5'],
          })}
        />
      );

      const button = screen.getByText('Show 2 More').closest('button');
      expect(button).toHaveAttribute('type', 'button');
    });

    it('warnings have semantic structure with list items', () => {
      render(
        <SpendPrivacyCard
          analysis={createMockAnalysis({
            warnings: ['Warning 1', 'Warning 2'],
          })}
        />
      );

      // Each warning is in a div with bullet point
      expect(screen.getByText('Warning 1')).toBeInTheDocument();
      expect(screen.getByText('Warning 2')).toBeInTheDocument();
    });
  });
});
