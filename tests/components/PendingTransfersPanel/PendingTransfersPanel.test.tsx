import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PendingTransfersPanel } from '../../../components/PendingTransfersPanel/PendingTransfersPanel';
import { useTransferActions } from '../../../components/PendingTransfersPanel/useTransferActions';
import type { Transfer } from '../../../types';

vi.mock('../../../components/PendingTransfersPanel/useTransferActions');
vi.mock('../../../components/PendingTransfersPanel/TransferConfirmationModal', () => ({
  TransferConfirmationModal: ({
    onClose,
    onAccept,
  }: {
    onClose: () => void;
    onAccept: (id: string) => void;
  }) => (
    <div data-testid="confirmation-modal">
      <button onClick={onClose}>Close Modal</button>
      <button onClick={() => onAccept('t-1')}>Confirm Accept</button>
    </div>
  ),
}));

vi.mock('../../../components/PendingTransfersPanel/TransferCard', () => ({
  TransferCard: ({
    transfer,
    variant,
    onAction,
  }: {
    transfer: Transfer;
    variant: string;
    actionLoading: string | null;
    onAction: (id: string, action: string) => void;
  }) => (
    <div data-testid={`transfer-card-${variant}`}>
      <span>{transfer.id}</span>
      <button onClick={() => onAction(transfer.id, 'accept')}>Action</button>
    </div>
  ),
}));

vi.mock('lucide-react', () => ({
  AlertTriangle: () => <span data-testid="alert-icon" />,
}));

const makeTransfer = (overrides: Partial<Transfer> = {}): Transfer => ({
  id: 't-1',
  resourceType: 'wallet',
  resourceId: 'wallet-1',
  fromUserId: 'user-1',
  toUserId: 'user-2',
  status: 'pending',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  acceptedAt: null,
  confirmedAt: null,
  cancelledAt: null,
  expiresAt: '2026-02-01',
  message: null,
  declineReason: null,
  keepExistingUsers: false,
  fromUser: { id: 'user-1', username: 'alice' },
  toUser: { id: 'user-2', username: 'bob' },
  ...overrides,
});

const defaultReturn = {
  loading: false,
  error: null,
  actionLoading: null,
  confirmModal: null,
  declineReason: '',
  incomingPending: [] as Transfer[],
  outgoingPending: [] as Transfer[],
  awaitingConfirmation: [] as Transfer[],
  hasTransfers: false,
  setConfirmModal: vi.fn(),
  setDeclineReason: vi.fn(),
  handleAccept: vi.fn(),
  handleDecline: vi.fn(),
  handleCancel: vi.fn(),
  handleConfirm: vi.fn(),
};

describe('PendingTransfersPanel', () => {
  beforeEach(() => {
    vi.mocked(useTransferActions).mockReturnValue({ ...defaultReturn });
  });

  it('renders loading skeleton when loading', () => {
    vi.mocked(useTransferActions).mockReturnValue({ ...defaultReturn, loading: true });

    const { container } = render(
      <PendingTransfersPanel resourceType="wallet" resourceId="wallet-1" />,
    );

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders null when there are no transfers', () => {
    const { container } = render(
      <PendingTransfersPanel resourceType="wallet" resourceId="wallet-1" />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders error message when error exists', () => {
    vi.mocked(useTransferActions).mockReturnValue({
      ...defaultReturn,
      hasTransfers: true,
      incomingPending: [makeTransfer()],
      error: 'Something went wrong',
    });

    render(<PendingTransfersPanel resourceType="wallet" resourceId="wallet-1" />);

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders incoming transfer cards', () => {
    const incoming = makeTransfer({ id: 'incoming-1' });
    vi.mocked(useTransferActions).mockReturnValue({
      ...defaultReturn,
      hasTransfers: true,
      incomingPending: [incoming],
    });

    render(<PendingTransfersPanel resourceType="wallet" resourceId="wallet-1" />);

    expect(screen.getByTestId('transfer-card-incoming')).toBeInTheDocument();
    expect(screen.getByText('incoming-1')).toBeInTheDocument();
  });

  it('renders awaiting confirmation transfer cards', () => {
    const awaiting = makeTransfer({ id: 'awaiting-1', status: 'accepted' });
    vi.mocked(useTransferActions).mockReturnValue({
      ...defaultReturn,
      hasTransfers: true,
      awaitingConfirmation: [awaiting],
    });

    render(<PendingTransfersPanel resourceType="wallet" resourceId="wallet-1" />);

    expect(screen.getByTestId('transfer-card-awaiting_confirmation')).toBeInTheDocument();
  });

  it('renders outgoing transfer cards', () => {
    const outgoing = makeTransfer({ id: 'outgoing-1' });
    vi.mocked(useTransferActions).mockReturnValue({
      ...defaultReturn,
      hasTransfers: true,
      outgoingPending: [outgoing],
    });

    render(<PendingTransfersPanel resourceType="wallet" resourceId="wallet-1" />);

    expect(screen.getByTestId('transfer-card-outgoing')).toBeInTheDocument();
  });

  it('opens confirmation modal via onAction callback', () => {
    const setConfirmModal = vi.fn();
    vi.mocked(useTransferActions).mockReturnValue({
      ...defaultReturn,
      hasTransfers: true,
      incomingPending: [makeTransfer()],
      setConfirmModal,
    });

    render(<PendingTransfersPanel resourceType="wallet" resourceId="wallet-1" />);

    fireEvent.click(screen.getByText('Action'));
    expect(setConfirmModal).toHaveBeenCalledWith({ transferId: 't-1', action: 'accept' });
  });

  it('renders confirmation modal when confirmModal state is set', () => {
    vi.mocked(useTransferActions).mockReturnValue({
      ...defaultReturn,
      hasTransfers: true,
      incomingPending: [makeTransfer()],
      confirmModal: { transferId: 't-1', action: 'accept' },
    });

    render(<PendingTransfersPanel resourceType="wallet" resourceId="wallet-1" />);

    expect(screen.getByTestId('confirmation-modal')).toBeInTheDocument();
  });

  it('closes confirmation modal', () => {
    const setConfirmModal = vi.fn();
    vi.mocked(useTransferActions).mockReturnValue({
      ...defaultReturn,
      hasTransfers: true,
      incomingPending: [makeTransfer()],
      confirmModal: { transferId: 't-1', action: 'accept' },
      setConfirmModal,
    });

    render(<PendingTransfersPanel resourceType="wallet" resourceId="wallet-1" />);

    fireEvent.click(screen.getByText('Close Modal'));
    expect(setConfirmModal).toHaveBeenCalledWith(null);
  });
});
