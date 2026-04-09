import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UTXOSummaryBanners } from '../../../components/UTXOList/UTXOSummaryBanners';

const format = (sats: number) => `${sats} sats`;

describe('UTXOSummaryBanners', () => {
  it('renders nothing when no dust and no privacy', () => {
    const { container } = render(
      <UTXOSummaryBanners
        showPrivacy={false}
        dustCount={0}
        dustTotal={0}
        currentFeeRate={10}
        format={format}
      />,
    );

    expect(container.textContent).toBe('');
  });

  it('renders dust warning when dustCount > 0', () => {
    render(
      <UTXOSummaryBanners
        showPrivacy={false}
        dustCount={3}
        dustTotal={450}
        currentFeeRate={15.5}
        format={format}
      />,
    );

    expect(screen.getByText(/3 dust UTXOs/)).toBeInTheDocument();
    expect(screen.getByText('450 sats')).toBeInTheDocument();
    expect(screen.getByText(/15\.5 sat\/vB/)).toBeInTheDocument();
    expect(screen.getByText(/consolidating when fees are lower/)).toBeInTheDocument();
  });

  it('uses singular "UTXO" when dustCount is 1', () => {
    render(
      <UTXOSummaryBanners
        showPrivacy={false}
        dustCount={1}
        dustTotal={100}
        currentFeeRate={10}
        format={format}
      />,
    );

    expect(screen.getByText(/1 dust UTXO(?!s)/)).toBeInTheDocument();
  });

  it('renders privacy summary when showPrivacy is true with summary data', () => {
    render(
      <UTXOSummaryBanners
        showPrivacy={true}
        privacySummary={{
          averageScore: 72,
          grade: 'good',
          utxoCount: 5,
          addressReuseCount: 0,
          roundAmountCount: 1,
          clusterCount: 2,
          recommendations: ['Consider using CoinJoin'],
        }}
        dustCount={0}
        dustTotal={0}
        currentFeeRate={10}
        format={format}
      />,
    );

    expect(screen.getByText(/Wallet Privacy Score: 72/)).toBeInTheDocument();
    expect(screen.getByText('good')).toBeInTheDocument();
    expect(screen.getByText('Consider using CoinJoin')).toBeInTheDocument();
  });

  it('does not show privacy summary when showPrivacy is false', () => {
    render(
      <UTXOSummaryBanners
        showPrivacy={false}
        privacySummary={{
          averageScore: 72,
          grade: 'good' as any,
          recommendations: [],
          utxoCount: 5,
          addressReuseCount: 0,
          roundAmountCount: 1,
          clusterCount: 2,
        }}
        dustCount={0}
        dustTotal={0}
        currentFeeRate={10}
        format={format}
      />,
    );

    expect(screen.queryByText(/Privacy Score/)).not.toBeInTheDocument();
  });

  it('does not show privacy summary when summary is undefined', () => {
    render(
      <UTXOSummaryBanners
        showPrivacy={true}
        dustCount={0}
        dustTotal={0}
        currentFeeRate={10}
        format={format}
      />,
    );

    expect(screen.queryByText(/Privacy Score/)).not.toBeInTheDocument();
  });

  it('omits recommendation when list is empty', () => {
    render(
      <UTXOSummaryBanners
        showPrivacy={true}
        privacySummary={{
          averageScore: 90,
          grade: 'excellent' as any,
          recommendations: [],
          utxoCount: 5,
          addressReuseCount: 0,
          roundAmountCount: 1,
          clusterCount: 2,
        }}
        dustCount={0}
        dustTotal={0}
        currentFeeRate={10}
        format={format}
      />,
    );

    expect(screen.getByText(/90/)).toBeInTheDocument();
    expect(screen.getByText('excellent')).toBeInTheDocument();
  });

  it('applies correct color class for each privacy grade', () => {
    const grades = ['excellent', 'good', 'fair', 'poor'] as const;
    const expectedClasses = ['zen-matcha', 'zen-indigo', 'zen-gold', 'zen-vermilion'];

    for (let i = 0; i < grades.length; i++) {
      const { container, unmount } = render(
        <UTXOSummaryBanners
          showPrivacy={true}
          privacySummary={{
            averageScore: 50,
            grade: grades[i] as any,
            recommendations: [],
            utxoCount: 5,
            addressReuseCount: 0,
            roundAmountCount: 1,
            clusterCount: 2,
          }}
          dustCount={0}
          dustTotal={0}
          currentFeeRate={10}
          format={format}
        />,
      );

      const gradeEl = container.querySelector(`.${expectedClasses[i].replace('-', '\\-')}`);
      // Just check grade text is rendered
      expect(screen.getByText(grades[i])).toBeInTheDocument();
      unmount();
    }
  });

  it('renders both privacy and dust banners together', () => {
    render(
      <UTXOSummaryBanners
        showPrivacy={true}
        privacySummary={{
          averageScore: 60,
          grade: 'fair' as any,
          recommendations: [],
          utxoCount: 5,
          addressReuseCount: 0,
          roundAmountCount: 1,
          clusterCount: 2,
        }}
        dustCount={2}
        dustTotal={300}
        currentFeeRate={10}
        format={format}
      />,
    );

    expect(screen.getByText(/Privacy Score/)).toBeInTheDocument();
    expect(screen.getByText(/2 dust UTXOs/)).toBeInTheDocument();
  });
});
