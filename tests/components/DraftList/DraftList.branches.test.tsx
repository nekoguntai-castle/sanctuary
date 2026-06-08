import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { DraftList } from '../../../components/DraftList/DraftList';
import * as draftsApi from '../../../src/api/drafts';
import { WalletType } from '../../../types';
import * as downloadUtils from '../../../utils/download';

const mockNavigate = vi.fn();
let uploadFileFactory: () => File = () =>
  ({
    name: 'default.psbt',
    arrayBuffer: () => Promise.resolve(new Uint8Array([0x70, 0x73, 0x62, 0x74, 0xff]).buffer),
    text: () => Promise.resolve(''),
  }) as unknown as File;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../../contexts/CurrencyContext', () => {
  const value = {
    format: (value: number) => `${value} sats`,
    unit: 'sats',
  };
  return {
    useCurrency: () => value,
    usePriceFreeFormatter: () => value,
  };
});

vi.mock('../../../src/api/drafts', () => ({
  getDrafts: vi.fn(),
  deleteDraft: vi.fn(),
  updateDraft: vi.fn(),
}));

vi.mock('../../../utils/download', () => ({
  downloadBlob: vi.fn(),
}));

vi.mock('../../../components/DraftList/DraftRow', () => ({
  DraftRow: ({
    draft,
    isExpanded,
    getAddressLabel,
    onResume,
    onDelete,
    onDownloadPsbt,
    onUploadPsbt,
    onToggleExpand,
  }: any) => (
    <div data-testid="draft-row" data-draft-id={draft.id}>
      <span>{draft.id}</span>
      <span data-testid={`expanded-${draft.id}`}>{String(isExpanded)}</span>
      <span data-testid={`label-${draft.id}`}>
        {getAddressLabel(draft.outputs?.[0]?.address || '') || 'none'}
      </span>
      <button onClick={() => onResume(draft)}>{`resume-${draft.id}`}</button>
      <button onClick={() => onDelete(draft.id)}>{`delete-${draft.id}`}</button>
      <button onClick={() => onDownloadPsbt(draft)}>{`download-${draft.id}`}</button>
      <button onClick={() => onUploadPsbt(draft.id, uploadFileFactory())}>{`upload-${draft.id}`}</button>
      <button onClick={() => onUploadPsbt('missing-id', uploadFileFactory())}>{`upload-missing-${draft.id}`}</button>
      <button onClick={() => onToggleExpand(draft.id)}>{`toggle-${draft.id}`}</button>
    </div>
  ),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('DraftList branch coverage', () => {
  const now = Date.now();
  const defaultProps = {
    walletId: 'wallet-1',
    walletType: WalletType.SINGLE_SIG,
  };

  const baseDraft = {
    walletId: 'wallet-1',
    status: 'unsigned',
    recipient: 'bc1q-recipient',
    effectiveAmount: 10000,
    fee: 100,
    feeRate: 1,
    totalInput: 11000,
    totalOutput: 10900,
    changeAmount: 900,
    changeAddress: 'bc1q-change',
    psbtBase64: 'cHNidP8=',
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    outputs: [{ address: 'bc1q-out', amount: 10000 }],
  };

  const renderDraftList = (props: Record<string, unknown> = {}) =>
    render(
      <MemoryRouter>
        <DraftList {...defaultProps} {...props} />
      </MemoryRouter>
    );

  beforeEach(() => {
    vi.clearAllMocks();
    uploadFileFactory = () =>
      ({
        name: 'default.psbt',
        arrayBuffer: () => Promise.resolve(new Uint8Array([0x70, 0x73, 0x62, 0x74, 0xff, 0x01]).buffer),
        text: () => Promise.resolve(''),
      }) as unknown as File;

    vi.mocked(draftsApi.deleteDraft).mockResolvedValue(undefined);
    vi.mocked(draftsApi.updateDraft).mockResolvedValue({} as any);
    vi.mocked(draftsApi.getDrafts).mockResolvedValue([
      { ...baseDraft, id: 'd1', createdAt: new Date(now - 1_000).toISOString() },
    ] as any);
  });

  it('sorts drafts across expiration/no-expiration urgency branches', async () => {
    vi.mocked(draftsApi.getDrafts).mockResolvedValue([
      { ...baseDraft, id: 'no-old', expiresAt: undefined, createdAt: new Date(now - 50_000).toISOString() },
      { ...baseDraft, id: 'exp-warning', expiresAt: new Date(now + 30 * 60 * 60 * 1000).toISOString() }, // warning
      { ...baseDraft, id: 'exp-critical-late', expiresAt: new Date(now + 50 * 60 * 1000).toISOString() }, // critical
      { ...baseDraft, id: 'exp-critical-soon', expiresAt: new Date(now + 30 * 60 * 1000).toISOString() }, // critical
      { ...baseDraft, id: 'exp-expired', expiresAt: new Date(now - 60 * 1000).toISOString() }, // expired
      { ...baseDraft, id: 'exp-normal', expiresAt: new Date(now + 4 * 24 * 60 * 60 * 1000).toISOString() }, // normal
      { ...baseDraft, id: 'no-new', expiresAt: undefined, createdAt: new Date(now - 10_000).toISOString() },
    ] as any);

    renderDraftList();

    const rows = await screen.findAllByTestId('draft-row');
    const ids = rows.map((row) => row.getAttribute('data-draft-id'));
    expect(ids).toEqual([
      'exp-expired',
      'exp-critical-soon',
      'exp-critical-late',
      'exp-warning',
      'exp-normal',
      'no-new',
      'no-old',
    ]);
  });

  it('uses walletName and Own wallet fallback in address labeling', async () => {
    vi.mocked(draftsApi.getDrafts).mockResolvedValue([
      { ...baseDraft, id: 'd1', outputs: [{ address: 'bc1q-own', amount: 1000 }] },
    ] as any);

    const { rerender } = render(
      <MemoryRouter>
        <DraftList
          {...defaultProps}
          walletAddresses={[{ address: 'bc1q-own', path: 'm/0/0' } as any]}
          walletName="Vault"
        />
      </MemoryRouter>
    );

    expect(await screen.findByTestId('label-d1')).toHaveTextContent('Vault');

    rerender(
      <MemoryRouter>
        <DraftList
          {...defaultProps}
          walletAddresses={[{ address: 'bc1q-own', path: 'm/0/0' } as any]}
        />
      </MemoryRouter>
    );

    expect(await screen.findByTestId('label-d1')).toHaveTextContent('Own wallet');
  });

  it('uses onResume callback when provided', async () => {
    const user = userEvent.setup();
    const onResume = vi.fn();

    renderDraftList({ onResume });
    await user.click(await screen.findByRole('button', { name: 'resume-d1' }));
    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates to send page when onResume callback is not provided', async () => {
    const user = userEvent.setup();
    renderDraftList();

    await user.click(await screen.findByRole('button', { name: 'resume-d1' }));
    expect(mockNavigate).toHaveBeenCalledWith('/wallets/wallet-1/send', {
      state: { draft: expect.objectContaining({ id: 'd1' }) },
    });
  });

  it('handles delete success and delete operation failure branches', async () => {
    const user = userEvent.setup();
    vi.mocked(draftsApi.getDrafts).mockResolvedValue([
      { ...baseDraft, id: 'd1' },
      { ...baseDraft, id: 'd2' },
    ] as any);

    const onDraftsChange = vi.fn();
    renderDraftList({ onDraftsChange });

    await user.click(await screen.findByRole('button', { name: 'delete-d1' }));
    await waitFor(() => {
      expect(draftsApi.deleteDraft).toHaveBeenCalledWith('wallet-1', 'd1');
    });
    expect(onDraftsChange).toHaveBeenCalledWith(1);

    vi.mocked(draftsApi.deleteDraft).mockRejectedValueOnce(new Error('delete failed'));
    await user.click(screen.getByRole('button', { name: 'delete-d2' }));
    await waitFor(() => {
      expect(screen.getByText('delete failed')).toBeInTheDocument();
    });
  });

  it('downloads signed and unsigned PSBT branches', async () => {
    const user = userEvent.setup();
    vi.mocked(draftsApi.getDrafts).mockResolvedValue([
      { ...baseDraft, id: 'signed', signedPsbtBase64: 'cHNidP8=' },
      { ...baseDraft, id: 'unsigned', signedPsbtBase64: undefined },
    ] as any);

    renderDraftList();

    await user.click(await screen.findByRole('button', { name: 'download-signed' }));
    await user.click(screen.getByRole('button', { name: 'download-unsigned' }));
    expect(downloadUtils.downloadBlob).toHaveBeenCalledTimes(2);
  });

  it('uploads binary PSBT and sets multisig status to partial', async () => {
    const user = userEvent.setup();
    uploadFileFactory = () =>
      ({
        name: 'signed.psbt',
        arrayBuffer: () => Promise.resolve(new Uint8Array([0x70, 0x73, 0x62, 0x74, 0xff, 0x01]).buffer),
        text: () => Promise.resolve(''),
      }) as unknown as File;

    renderDraftList({ walletType: WalletType.MULTI_SIG });

    await user.click(await screen.findByRole('button', { name: 'upload-d1' }));
    await waitFor(() => {
      expect(draftsApi.updateDraft).toHaveBeenCalledWith(
        'wallet-1',
        'd1',
        expect.objectContaining({ status: 'partial', signedPsbtBase64: expect.any(String) })
      );
    });
  });

  it('handles missing draft branch and invalid base64 upload error branch', async () => {
    const user = userEvent.setup();
    renderDraftList();

    // Cover branch where the target draft is missing
    uploadFileFactory = () =>
      ({
        name: 'valid.psbt',
        arrayBuffer: () => Promise.resolve(new Uint8Array([0x70, 0x73, 0x62, 0x74, 0xff, 0x01]).buffer),
        text: () => Promise.resolve(''),
      }) as unknown as File;

    await user.click(await screen.findByRole('button', { name: 'upload-missing-d1' }));
    await waitFor(() => {
      expect(draftsApi.updateDraft).not.toHaveBeenCalled();
      expect(draftsApi.getDrafts).toHaveBeenCalledTimes(2);
    });

    uploadFileFactory = () =>
      ({
        name: 'invalid-base64.txt',
        arrayBuffer: () => Promise.resolve(new Uint8Array([0x00]).buffer),
        text: () => Promise.resolve('YWJjZA=='), // decodes to "abcd", not "psbt"
      }) as unknown as File;

    await user.click(await screen.findByRole('button', { name: 'upload-d1' }));
    await waitFor(() => {
      expect(screen.getByText(/Invalid base64 PSBT file/i)).toBeInTheDocument();
    });
    expect(draftsApi.updateDraft).not.toHaveBeenCalled();
  });

  it('toggles expanded draft branch in both directions', async () => {
    const user = userEvent.setup();
    renderDraftList();

    await user.click(await screen.findByRole('button', { name: 'toggle-d1' }));
    expect(screen.getByTestId('expanded-d1')).toHaveTextContent('true');

    await user.click(screen.getByRole('button', { name: 'toggle-d1' }));
    expect(screen.getByTestId('expanded-d1')).toHaveTextContent('false');
  });
});
