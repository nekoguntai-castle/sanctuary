import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoinControlPanel } from '../../../components/send/steps/OutputsStep/CoinControlPanel';

vi.mock('../../../components/send/steps/OutputsStep/UtxoRow', () => ({
  UtxoRow: ({ utxo }: { utxo: { txid: string; vout: number } }) => (
    <div data-testid={`utxo-row-${utxo.txid}:${utxo.vout}`} />
  ),
}));

describe('OutputsStep CoinControlPanel', () => {
  it('shows "+N more" rows for frozen and draft-locked UTXOs beyond two entries', () => {
    render(
      <CoinControlPanel
        expanded={true}
        showCoinControl={true}
        selectedUTXOs={new Set<string>()}
        available={[]}
        manuallyFrozen={[
          { txid: 'mf-1', vout: 0 },
          { txid: 'mf-2', vout: 1 },
          { txid: 'mf-3', vout: 2 },
          { txid: 'mf-4', vout: 3 },
        ] as any}
        draftLocked={[
          { txid: 'dl-1', vout: 0 },
          { txid: 'dl-2', vout: 1 },
          { txid: 'dl-3', vout: 2 },
          { txid: 'dl-4', vout: 3 },
          { txid: 'dl-5', vout: 4 },
        ] as any}
        remainingNeeded={0}
        privacyAnalysis={null}
        utxoPrivacyMap={new Map()}
        onTogglePanel={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
        onToggleCoinControl={vi.fn()}
        onToggleUtxo={vi.fn()}
        format={(amount) => `${amount} sats`}
        formatFiat={() => null}
      />
    );

    expect(screen.getByText('+2 more')).toBeInTheDocument();
    expect(screen.getByText('+3 more')).toBeInTheDocument();
  });
});
