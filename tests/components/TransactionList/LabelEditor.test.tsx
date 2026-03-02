import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LabelEditor } from '../../../components/TransactionList/LabelEditor';
import type { Label, Transaction } from '../../../types';

vi.mock('../../../components/AILabelSuggestion', () => ({
  AILabelSuggestion: ({
    existingLabels,
    onSuggestionAccepted,
  }: {
    existingLabels: string[];
    onSuggestionAccepted: (suggestion: string) => void;
  }) => (
    <button onClick={() => onSuggestionAccepted(existingLabels.join(','))}>
      AI Suggestion
    </button>
  ),
}));

const selectedTx: Transaction = {
  id: 'tx-1',
  txid: 'abc123',
  walletId: 'wallet-1',
  amount: 1000,
  confirmations: 0,
  labels: [],
};

const labels: Label[] = [
  { id: 'l1', name: 'Groceries', color: '#22c55e' },
  { id: 'l2', name: 'Savings', color: '#3b82f6' },
];

describe('TransactionList LabelEditor', () => {
  it('opens edit mode from read-only view when editing is allowed', async () => {
    const user = userEvent.setup();
    const onEditLabels = vi.fn();

    render(
      <LabelEditor
        selectedTx={selectedTx}
        editingLabels={false}
        availableLabels={labels}
        selectedLabelIds={[]}
        savingLabels={false}
        canEdit={true}
        aiEnabled={false}
        onEditLabels={onEditLabels}
        onSaveLabels={vi.fn()}
        onCancelEdit={vi.fn()}
        onToggleLabel={vi.fn()}
        onAISuggestion={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /edit/i }));
    expect(onEditLabels).toHaveBeenCalledWith(selectedTx);
  });

  it('passes available label names to AI suggestion and accepts suggestion callback', async () => {
    const user = userEvent.setup();
    const onAISuggestion = vi.fn();

    render(
      <LabelEditor
        selectedTx={selectedTx}
        editingLabels={true}
        availableLabels={labels}
        selectedLabelIds={['l1']}
        savingLabels={false}
        canEdit={true}
        aiEnabled={true}
        onEditLabels={vi.fn()}
        onSaveLabels={vi.fn()}
        onCancelEdit={vi.fn()}
        onToggleLabel={vi.fn()}
        onAISuggestion={onAISuggestion}
      />
    );

    await user.click(screen.getByRole('button', { name: 'AI Suggestion' }));
    expect(onAISuggestion).toHaveBeenCalledWith('Groceries,Savings');
  });

  it('renders legacy single label fallback when labels array is empty', () => {
    render(
      <LabelEditor
        selectedTx={{ ...selectedTx, labels: [], label: 'Legacy Label' }}
        editingLabels={false}
        availableLabels={labels}
        selectedLabelIds={[]}
        savingLabels={false}
        canEdit={false}
        aiEnabled={false}
        onEditLabels={vi.fn()}
        onSaveLabels={vi.fn()}
        onCancelEdit={vi.fn()}
        onToggleLabel={vi.fn()}
        onAISuggestion={vi.fn()}
      />
    );

    expect(screen.getByText('Legacy Label')).toBeInTheDocument();
  });
});
