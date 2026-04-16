import { fireEvent,render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { DraftRow } from '../../../components/DraftList/DraftRow';
import type { DraftRowProps } from '../../../components/DraftList/types';
import type { DraftTransaction } from '../../../src/api/drafts';
import { WalletType } from '../../../types';

const getExpirationInfoMock = vi.hoisted(() => vi.fn());
const getFeeWarningMock = vi.hoisted(() => vi.fn());
const getFlowPreviewDataMock = vi.hoisted(() => vi.fn());
const isExpiredMock = vi.hoisted(() => vi.fn());
const formatDateMock = vi.hoisted(() => vi.fn());

vi.mock('../../../components/DraftList/utils', () => ({
  getExpirationInfo: (...args: unknown[]) => getExpirationInfoMock(...args),
  getFeeWarning: (...args: unknown[]) => getFeeWarningMock(...args),
  getFlowPreviewData: (...args: unknown[]) => getFlowPreviewDataMock(...args),
  isExpired: (...args: unknown[]) => isExpiredMock(...args),
  formatDate: (...args: unknown[]) => formatDateMock(...args),
}));

vi.mock('../../../components/Amount', () => ({
  Amount: ({ sats }: { sats: number }) => <span>{`amount:${sats}`}</span>,
}));

vi.mock('../../../components/FiatDisplay', () => ({
  FiatDisplaySubtle: ({ sats }: { sats: number }) => <span>{`fiat:${sats}`}</span>,
}));

vi.mock('../../../components/TransactionFlowPreview', () => ({
  TransactionFlowPreview: ({ inputs, outputs }: { inputs: unknown[]; outputs: unknown[] }) => (
    <div data-testid="flow-preview">{`flow:${inputs.length}->${outputs.length}`}</div>
  ),
}));

vi.mock('../../../utils/formatters', () => ({
  truncateAddress: (address: string) => `tr(${address})`,
}));

const makeDraft = (overrides: Partial<DraftTransaction> = {}): DraftTransaction => ({
  id: 'draft-1',
  walletId: 'wallet-1',
  userId: 'user-1',
  recipient: 'bc1q-recipient',
  amount: 10000,
  feeRate: 2,
  selectedUtxoIds: ['u1'],
  enableRBF: true,
  subtractFees: false,
  sendMax: false,
  isRBF: false,
  outputs: [{ address: 'bc1q-out-1', amount: 10000 }],
  inputs: [{ txid: 'tx1', vout: 0, address: 'bc1q-in-1', amount: 12000 }],
  decoyOutputs: [],
  psbtBase64: 'cHNidP8=',
  fee: 400,
  totalInput: 12000,
  totalOutput: 11600,
  changeAmount: 1600,
  changeAddress: 'bc1q-change',
  effectiveAmount: 10000,
  inputPaths: [],
  status: 'unsigned',
  signedDeviceIds: [],
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  ...overrides,
});

const handlers = {
  onResume: vi.fn(),
  onDelete: vi.fn(),
  onDownloadPsbt: vi.fn(),
  onUploadPsbt: vi.fn(),
  onToggleExpand: vi.fn(),
  onSetDeleteConfirm: vi.fn(),
};

const defaultProps: Omit<DraftRowProps, 'draft'> = {
  walletType: WalletType.SINGLE_SIG,
  quorum: { m: 2, n: 3 },
  canEdit: true,
  isExpanded: false,
  deleteConfirm: null,
  format: (sats: number) => `fmt(${sats})`,
  getAddressLabel: () => undefined,
  ...handlers,
};

const renderRow = (
  draftOverrides: Partial<DraftTransaction> = {},
  propOverrides: Partial<Omit<DraftRowProps, 'draft'>> = {},
) => {
  const props: DraftRowProps = {
    ...defaultProps,
    ...propOverrides,
    draft: makeDraft(draftOverrides),
  };
  return render(<DraftRow {...props} />);
};

describe('DraftRow branch coverage', () => {
  let expirationInfo: { urgency: string; text: string; diffMs: number } | null;
  let feeWarning: { level: string; percent: number; message: string } | null;
  let expired: boolean;

  beforeEach(() => {
    vi.clearAllMocks();

    expirationInfo = null;
    feeWarning = null;
    expired = false;

    getExpirationInfoMock.mockImplementation(() => expirationInfo);
    getFeeWarningMock.mockImplementation(() => feeWarning);
    isExpiredMock.mockImplementation(() => expired);
    formatDateMock.mockReturnValue('Mar 1, 12:00 AM');
    getFlowPreviewDataMock.mockReturnValue({
      inputs: [{ txid: 'in', vout: 0, address: 'bc1q-in', amount: 12000 }],
      outputs: [{ address: 'bc1q-out', amount: 10000, isChange: false }],
      fee: 400,
      feeRate: 2,
      totalInput: 12000,
      totalOutput: 11600,
    });
  });

  it('renders every status branch and expiration badge variant', () => {
    expirationInfo = { urgency: 'expired', text: 'Expired now', diffMs: -1 };
    const { rerender } = renderRow({
      status: 'partial',
      signedDeviceIds: [],
    });
    expect(screen.getByText('0 of 2 signed')).toBeInTheDocument();
    expect(screen.getByText('Expired now')).toBeInTheDocument();

    expirationInfo = { urgency: 'critical', text: 'Expiring soon', diffMs: 1 };
    rerender(
      <DraftRow
        {...defaultProps}
        draft={makeDraft({
          status: 'partial',
          signedDeviceIds: ['dev-1', 'dev-2'],
        })}
      />
    );
    expect(screen.getByText('2 of 2 signed')).toBeInTheDocument();
    expect(screen.getByText('Expiring soon')).toBeInTheDocument();

    rerender(
      <DraftRow
        {...defaultProps}
        quorum={undefined}
        draft={makeDraft({
          status: 'partial',
          signedDeviceIds: [],
        })}
      />
    );
    expect(screen.getByText('0 of 1 signed')).toBeInTheDocument();

    expirationInfo = { urgency: 'warning', text: 'Expires tomorrow', diffMs: 2 };
    rerender(<DraftRow {...defaultProps} draft={makeDraft({ status: 'signed' })} />);
    expect(screen.getByText('Ready to broadcast')).toBeInTheDocument();
    expect(screen.getByText('Expires tomorrow')).toBeInTheDocument();

    expirationInfo = { urgency: 'normal', text: 'Expires in 4 days', diffMs: 3 };
    rerender(<DraftRow {...defaultProps} draft={makeDraft({ status: 'unsigned' })} />);
    expect(screen.getByText('Unsigned')).toBeInTheDocument();
    expect(screen.getByText('Expires in 4 days')).toBeInTheDocument();

    expirationInfo = { urgency: 'mystery', text: 'Fallback urgency', diffMs: 4 };
    rerender(
      <DraftRow
        {...defaultProps}
        draft={makeDraft({ status: 'mystery' as DraftTransaction['status'] })}
      />
    );
    expect(screen.queryByText('Unsigned')).not.toBeInTheDocument();
    expect(screen.queryByText('Ready to broadcast')).not.toBeInTheDocument();
    expect(screen.getByText('Fallback urgency')).toBeInTheDocument();

    expirationInfo = null;
    rerender(<DraftRow {...defaultProps} draft={makeDraft({ status: 'unsigned' })} />);
    expect(screen.getByText('Unsigned')).toBeInTheDocument();
    expect(screen.queryByText('Fallback urgency')).not.toBeInTheDocument();
  });

  it('covers recipient rendering branches including single, multiple, sendMax, and fallback', () => {
    const { rerender } = renderRow({ outputs: undefined, recipient: 'bc1q-fallback-recipient' });
    expect(screen.getByText('tr(bc1q-fallback-recipient)')).toBeInTheDocument();

    rerender(
      <DraftRow
        {...defaultProps}
        draft={makeDraft({
          outputs: [],
          recipient: 'bc1q-empty-array-recipient',
        })}
      />
    );
    expect(screen.getByText('tr(bc1q-empty-array-recipient)')).toBeInTheDocument();

    rerender(
      <DraftRow
        {...defaultProps}
        draft={makeDraft({
          outputs: [{ address: 'bc1q-single-output', amount: 1200 }],
        })}
      />
    );
    expect(screen.getByText('tr(bc1q-single-output)')).toBeInTheDocument();

    rerender(
      <DraftRow
        {...defaultProps}
        draft={makeDraft({
          outputs: [
            { address: 'bc1q-max-output', amount: 900, sendMax: true },
            { address: 'bc1q-fixed-output', amount: 700 },
          ],
        })}
      />
    );
    expect(screen.getByText('MAX')).toBeInTheDocument();
    expect(screen.getByText('fmt(700)')).toBeInTheDocument();
    expect(screen.getByText('fiat:700')).toBeInTheDocument();
    expect(screen.queryByText('fiat:900')).not.toBeInTheDocument();
  });

  it('covers fee warning styles and optional label rendering', () => {
    feeWarning = { level: 'critical', percent: 40.5, message: 'Critical fee' };
    const { rerender } = renderRow({ label: 'Urgent draft' });

    const criticalMessage = screen.getByText('Critical fee (40.5%)');
    const criticalBanner = criticalMessage.closest('div');
    expect(criticalBanner).toHaveClass('border-rose-200');
    expect(criticalBanner?.querySelector('svg')).toHaveClass('text-rose-500');
    expect(criticalMessage).toHaveClass('text-rose-700');
    expect(screen.getByText('Label: Urgent draft')).toBeInTheDocument();

    feeWarning = { level: 'warning', percent: 12.3, message: 'Warning fee' };
    rerender(<DraftRow {...defaultProps} draft={makeDraft({ label: undefined })} />);

    const warningMessage = screen.getByText('Warning fee (12.3%)');
    const warningBanner = warningMessage.closest('div');
    expect(warningBanner).toHaveClass('border-amber-200');
    expect(warningBanner?.querySelector('svg')).toHaveClass('text-amber-500');
    expect(warningMessage).toHaveClass('text-amber-700');
    expect(screen.queryByText('Label: Urgent draft')).not.toBeInTheDocument();
  });

  it('renders agent funding context and signature state', () => {
    const { rerender } = renderRow({
      agentId: 'agent-1',
      agentOperationalWalletId: 'operational-wallet-1',
      recipient: 'bc1q-agent-recipient',
      outputs: [{ address: 'bc1q-agent-recipient', amount: 10000 }],
      signedDeviceIds: ['agent-device-1'],
    });

    expect(screen.getByText('Agent funding request').closest('span')).toHaveClass('bg-shared-100');
    expect(screen.getByText(/Linked operational wallet/)).toBeInTheDocument();
    expect(screen.getByText('tr(bc1q-agent-recipient)')).toBeInTheDocument();
    expect(screen.getByText('Agent signature: present')).toBeInTheDocument();
    expect(screen.getByText(/the agent can spend from the operational wallet/).closest('div')).toHaveClass('border-amber-200');

    rerender(
      <DraftRow
        {...defaultProps}
        draft={makeDraft({
          agentId: 'agent-1',
          recipient: 'bc1q-agent-recipient',
          signedDeviceIds: [],
        })}
      />
    );
    expect(screen.getByText('Agent signature: missing')).toBeInTheDocument();
  });

  it('covers expired state, resume action, PSBT controls, and delete confirmation controls', async () => {
    const user = userEvent.setup();
    const { rerender, container } = renderRow();

    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(handlers.onResume).toHaveBeenCalledWith(expect.objectContaining({ id: 'draft-1' }));

    const downloadButton = screen.getByTitle('Download PSBT');
    await user.click(downloadButton);
    expect(handlers.onDownloadPsbt).toHaveBeenCalledWith(expect.objectContaining({ id: 'draft-1' }));

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['signed-psbt'], 'signed.psbt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.change(fileInput, { target: { files: [] } });
    expect(handlers.onUploadPsbt).toHaveBeenCalledTimes(1);
    expect(handlers.onUploadPsbt).toHaveBeenCalledWith('draft-1', file);

    await user.click(screen.getByTitle('Delete draft'));
    expect(handlers.onSetDeleteConfirm).toHaveBeenCalledWith('draft-1');

    rerender(
      <DraftRow
        {...defaultProps}
        deleteConfirm="draft-1"
        draft={makeDraft()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(handlers.onDelete).toHaveBeenCalledWith('draft-1');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handlers.onSetDeleteConfirm).toHaveBeenCalledWith(null);

    expired = true;
    rerender(<DraftRow {...defaultProps} draft={makeDraft()} />);
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();

    rerender(
      <DraftRow
        {...defaultProps}
        canEdit={false}
        draft={makeDraft()}
      />
    );
    expect(screen.queryByTitle('Delete draft')).not.toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();

    rerender(
      <DraftRow
        {...defaultProps}
        canEdit={true}
        walletType={WalletType.MULTI_SIG}
        draft={makeDraft()}
      />
    );
    expect(screen.queryByTitle('Download PSBT')).not.toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it('covers expand toggle and flow preview branches', async () => {
    const user = userEvent.setup();
    const { rerender } = renderRow({}, { isExpanded: false });

    const expandButton = screen.getByRole('button', { name: /Show Transaction Flow/i });
    expect(screen.queryByTestId('flow-preview')).not.toBeInTheDocument();
    await user.click(expandButton);
    expect(handlers.onToggleExpand).toHaveBeenCalledWith('draft-1');

    rerender(<DraftRow {...defaultProps} isExpanded={true} draft={makeDraft()} />);
    expect(screen.getByRole('button', { name: /Hide Transaction Flow/i })).toBeInTheDocument();
    expect(screen.getByTestId('flow-preview')).toHaveTextContent('flow:1->1');
  });
});
