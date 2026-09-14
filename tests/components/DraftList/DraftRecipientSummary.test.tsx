import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DraftRecipientSummary } from '../../../src/components/DraftList/DraftRecipientSummary';
import type { DraftTransaction } from '../../../src/api/drafts';

vi.mock('../../../src/components/FiatDisplay', () => ({
  FiatDisplaySubtle: ({ sats }: { sats: number }) => <span>{`fiat:${sats}`}</span>,
}));

vi.mock('../../../src/utils/formatters', () => ({
  truncateAddress: (address: string) => `tr(${address})`,
}));

const format = (sats: number) => `${sats} sats`;

const makeDraft = (overrides: Partial<DraftTransaction> = {}): DraftTransaction => ({
  id: 'draft-1',
  walletId: 'wallet-1',
  userId: 'user-1',
  recipient: 'bc1q-recipient',
  amount: 40000,
  feeRate: 2,
  selectedUtxoIds: ['u1'],
  enableRBF: true,
  subtractFees: false,
  sendMax: false,
  isRBF: true,
  outputs: [{ address: 'bc1q-recipient', amount: 40000 }],
  psbtBase64: 'cHNidP8=',
  fee: 400,
  totalInput: 94000,
  totalOutput: 93600,
  changeAmount: 53000,
  changeAddress: 'bc1q-change',
  effectiveAmount: 40000,
  inputPaths: [],
  status: 'unsigned',
  signedDeviceIds: [],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

describe('DraftRecipientSummary', () => {
  it('shows a distinct change row when the draft carries change', () => {
    // Regression for rbf-draft-recipient-picks-arbitrary-output-not-change-aware:
    // the change output used to render as just another recipient row.
    render(<DraftRecipientSummary draft={makeDraft()} format={format} />);

    expect(screen.getByText('tr(bc1q-recipient)')).toBeInTheDocument();
    expect(screen.getByText('Change:')).toBeInTheDocument();
    expect(screen.getByText('tr(bc1q-change)')).toBeInTheDocument();
    expect(screen.getByText('53000 sats')).toBeInTheDocument();
    expect(screen.getByText('fiat:53000')).toBeInTheDocument();
  });

  it('renders no change row when the draft has no change', () => {
    render(
      <DraftRecipientSummary
        draft={makeDraft({ changeAmount: 0, changeAddress: undefined })}
        format={format}
      />
    );

    expect(screen.queryByText('Change:')).not.toBeInTheDocument();
  });

  it('renders no change row when changeAmount is set but changeAddress is missing', () => {
    render(
      <DraftRecipientSummary
        draft={makeDraft({ changeAddress: undefined })}
        format={format}
      />
    );

    expect(screen.queryByText('Change:')).not.toBeInTheDocument();
  });

  it('falls back to the single truncated recipient when there are no outputs', () => {
    render(
      <DraftRecipientSummary
        draft={makeDraft({ outputs: undefined, changeAmount: 0, changeAddress: undefined })}
        format={format}
      />
    );

    expect(screen.getByText('tr(bc1q-recipient)')).toBeInTheDocument();
  });

  it('renders the agent-funding recipient label unaffected by change', () => {
    render(
      <DraftRecipientSummary
        draft={makeDraft({
          agentId: 'agent-1',
          agentOperationalWalletId: 'wallet-op-1',
          recipient: 'bc1q-agent-wallet',
        })}
        format={format}
      />
    );

    expect(screen.getByText('Linked operational wallet')).toBeInTheDocument();
    expect(screen.getByText('tr(bc1q-agent-wallet)')).toBeInTheDocument();
    expect(screen.getByText('Change:')).toBeInTheDocument();
  });
});
