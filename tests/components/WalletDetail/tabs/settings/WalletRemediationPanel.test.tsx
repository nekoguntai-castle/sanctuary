import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../../src/api/client';
import * as walletsApi from '../../../../../src/api/wallets';
import { WalletRemediationPanel } from '../../../../../src/components/WalletDetail/tabs/settings/WalletRemediationPanel';

vi.mock('../../../../../src/api/wallets', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../../src/api/wallets')>()),
  createWalletRemediationProposal: vi.fn(),
  approveWalletRemediationProposal: vi.fn(),
  cancelWalletRemediationProposal: vi.fn(),
  exportWalletRemediationProposal: vi.fn(),
}));

const DIGEST = 'a'.repeat(64);
const proposal: walletsApi.WalletRemediationProposal = {
  proposalId: `wallet-remediation-v1:${DIGEST}`,
  attemptId: '5cce61d7-0643-4fb3-a70c-312c1d476255',
  proofDigest: 'd'.repeat(64),
  walletId: 'wallet-1',
  schemaVersion: 'sanctuary.wallet-remediation.v1',
  proposalDigest: DIGEST,
  originalStateDigest: 'c'.repeat(64),
  originalState: {
    wallet: {
      id: 'wallet-1', type: 'single_sig', scriptType: 'native_segwit', network: 'mainnet',
      quorum: null, totalSigners: null, descriptor: 'wpkh(xpub/0/*)', changeDescriptor: 'wpkh(xpub/1/*)',
      descriptorPolicyVersion: 1, descriptorSourceKind: 'generated', sourceDescriptor: null,
      sourceChangeDescriptor: null, sourceDescriptorChecksum: null, sourceChangeDescriptorChecksum: null,
      fingerprint: 'aabbccdd', canonicalPolicyId: 'policy-1', canonicalPolicyVersion: 1,
    },
    signers: [],
    addresses: [],
    ownerUserIds: ['user-1'],
  },
  createdAt: '2026-08-11T20:00:00.000Z',
  state: 'pending',
  eligible: true,
  changes: [{
    kind: 'address_coordinate',
    recordId: 'address-1',
    proposed: { branch: 0 },
    evidenceIds: ['evidence-1'],
  }],
  proof: {
    preservedPolicyDigest: 'b'.repeat(64),
    addressCount: 1,
    unchangedAddressCount: 1,
    scriptPubKeyCount: 1,
    unchangedScriptPubKeyCount: 1,
    recoveryStatus: 'recovery-proven', signingStatus: 'not-tested',
    recoveryEvidenceDigest: 'e'.repeat(64),
    evidenceIds: ['evidence-1'],
  },
  blockers: [],
  backout: { state: 'not-applied', message: 'No active metadata has changed.' },
};

describe('WalletRemediationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(walletsApi.createWalletRemediationProposal).mockResolvedValue(proposal);
    vi.mocked(walletsApi.approveWalletRemediationProposal).mockResolvedValue({
      ...proposal,
      state: 'applied',
      appliedAt: '2026-08-11T20:01:00.000Z',
      backout: { state: 'forward-fix-only', message: 'Use a forward fix.' },
    });
    vi.mocked(walletsApi.exportWalletRemediationProposal).mockResolvedValue();
    vi.mocked(walletsApi.cancelWalletRemediationProposal).mockResolvedValue({
      ...proposal,
      state: 'cancelled',
    });
  });

  it('is lazy and approves only the exact acknowledged proposal ID and digest', async () => {
    const onApplied = vi.fn();
    render(<WalletRemediationPanel walletId="wallet-1" walletName="Main Wallet" onApplied={onApplied} />);

    expect(walletsApi.createWalletRemediationProposal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Create safety preview' }));
    expect(await screen.findByText(proposal.proposalId)).toBeInTheDocument();
    expect(screen.getByText(/Stored recovery metadata consistency: recovery-proven/)).toHaveTextContent(
      'No live device recovery or signing exercise was performed (not-tested).',
    );

    const approve = screen.getByRole('button', { name: 'Approve and apply' });
    expect(approve).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /verified this exact proposal ID and digest/i }));
    fireEvent.click(approve);

    await waitFor(() => expect(walletsApi.approveWalletRemediationProposal).toHaveBeenCalledWith(
      'wallet-1', proposal.proposalId, DIGEST, expect.any(AbortSignal),
    ));
    expect(await screen.findByText(/Backout is forward-fix only/)).toBeInTheDocument();
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it('shows blockers and never offers approval for an ineligible preview', async () => {
    vi.mocked(walletsApi.createWalletRemediationProposal).mockResolvedValue({
      ...proposal,
      state: 'blocked',
      eligible: false,
      changes: [],
      proof: { ...proposal.proof, recoveryStatus: 'blocked' },
      blockers: [{ code: 'ambiguous_account', message: 'Signer account evidence is ambiguous.' }],
    });
    render(<WalletRemediationPanel walletId="wallet-1" walletName="Main Wallet" />);

    fireEvent.click(screen.getByRole('button', { name: 'Create safety preview' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Signer account evidence is ambiguous.');
    expect(screen.queryByRole('button', { name: 'Approve and apply' })).not.toBeInTheDocument();
    expect(walletsApi.approveWalletRemediationProposal).not.toHaveBeenCalled();
  });

  it('labels every exact remediation change kind', async () => {
    vi.mocked(walletsApi.createWalletRemediationProposal).mockResolvedValue({
      ...proposal,
      changes: [
        ...proposal.changes,
        { kind: 'wallet_policy', recordId: 'wallet-1', proposed: { descriptorPolicyVersion: 1 }, evidenceIds: ['evidence-2'] },
        { kind: 'signer_binding', recordId: 'link-1', proposed: { signerIndex: 0 }, evidenceIds: ['evidence-3'] },
        {
          kind: 'wallet_policy_recovery',
          recordId: 'wallet-1',
          proposed: {
            descriptorPolicyVersion: 1,
            descriptorSourceKind: 'recovered_legacy',
            changeDescriptor: 'wpkh([aabbccdd/84h/0h/0h]xpub/1/*)',
            sourceDescriptor: 'wpkh([aabbccdd/84h/0h/0h]xpub/0/*)',
            canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
            canonicalPolicyVersion: 1,
          },
          evidenceIds: ['evidence-4'],
        },
      ],
    });
    render(<WalletRemediationPanel walletId="wallet-1" walletName="Main Wallet" />);

    fireEvent.click(screen.getByRole('button', { name: 'Create safety preview' }));

    expect(await screen.findByText(/Canonical policy metadata/)).toBeInTheDocument();
    expect(screen.getByText(/Signer account binding/)).toBeInTheDocument();
    expect(screen.getByText(/Address coordinate/)).toBeInTheDocument();
    // A recovery writes the descriptor policy itself, so it must not be presented under
    // the same label as a metadata-only backfill.
    expect(screen.getByText(/Recovered descriptor policy/)).toBeInTheDocument();
  });

  it.each([
    ['a mismatched content-addressed ID', { proposalId: `wallet-remediation-v1:${'f'.repeat(64)}` }],
    ['blockers', { blockers: [{ code: 'unexpected', message: 'Unexpected blocker.' }] }],
    ['an incomplete address proof', { proof: { ...proposal.proof, unchangedAddressCount: 0 } }],
    ['an incomplete script proof', { proof: { ...proposal.proof, unchangedScriptPubKeyCount: 0 } }],
    ['a missing evidence list', { proof: { ...proposal.proof, evidenceIds: [] } }],
    ['a blocked recovery proof', { proof: { ...proposal.proof, recoveryStatus: 'blocked' as const } }],
    ['a missing recovery digest', { proof: { ...proposal.proof, recoveryEvidenceDigest: null } }],
    ['a different wallet identity', { walletId: 'wallet-2' }],
  ])('defensively withholds approval for %s even if transport validation is bypassed', async (_name, override) => {
    vi.mocked(walletsApi.createWalletRemediationProposal).mockResolvedValue({
      ...proposal,
      ...override,
    });
    render(<WalletRemediationPanel walletId="wallet-1" walletName="Main Wallet" />);

    fireEvent.click(screen.getByRole('button', { name: 'Create safety preview' }));
    await screen.findByText('proposalId' in override ? override.proposalId : proposal.proposalId);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve and apply' })).not.toBeInTheDocument();
    expect(walletsApi.approveWalletRemediationProposal).not.toHaveBeenCalled();
  });

  it('disables duplicate preview requests while the first request is pending', async () => {
    let resolvePreview!: (value: walletsApi.WalletRemediationProposal) => void;
    vi.mocked(walletsApi.createWalletRemediationProposal).mockReturnValue(
      new Promise(resolve => { resolvePreview = resolve; }),
    );
    render(<WalletRemediationPanel walletId="wallet-1" walletName="Main Wallet" />);

    const previewButton = screen.getByRole('button', { name: 'Create safety preview' });
    fireEvent.click(previewButton);
    fireEvent.click(previewButton);

    expect(walletsApi.createWalletRemediationProposal).toHaveBeenCalledTimes(1);
    expect(previewButton).toBeDisabled();
    resolvePreview(proposal);
    expect(await screen.findByText(proposal.proposalId)).toBeInTheDocument();
  });

  it('surfaces preview failures without exposing approval controls', async () => {
    vi.mocked(walletsApi.createWalletRemediationProposal).mockRejectedValue(new Error('Preview unavailable'));
    render(<WalletRemediationPanel walletId="wallet-1" walletName="Main Wallet" />);

    fireEvent.click(screen.getByRole('button', { name: 'Create safety preview' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Preview unavailable');
    expect(screen.queryByRole('button', { name: 'Approve and apply' })).not.toBeInTheDocument();
  });

  it('uses a safe generic message for a non-Error rejection', async () => {
    vi.mocked(walletsApi.createWalletRemediationProposal).mockRejectedValue({ reason: 'redacted' });
    render(<WalletRemediationPanel walletId="wallet-1" walletName="Main Wallet" />);

    fireEvent.click(screen.getByRole('button', { name: 'Create safety preview' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The remediation request failed.');
  });

  it('ignores a stale duplicate preview event while the request is active', async () => {
    let resolvePreview!: (value: walletsApi.WalletRemediationProposal) => void;
    vi.mocked(walletsApi.createWalletRemediationProposal).mockReturnValue(
      new Promise(resolve => { resolvePreview = resolve; }),
    );
    render(<WalletRemediationPanel walletId="wallet-1" walletName="Main Wallet" />);
    const preview = screen.getByRole('button', { name: 'Create safety preview' });
    fireEvent.click(preview);
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(walletsApi.createWalletRemediationProposal).toHaveBeenCalledTimes(1);
    resolvePreview(proposal);
    await screen.findByText(proposal.proposalId);
  });

  it.each(['Export evidence', 'Cancel proposal'])(
    'ignores a stale duplicate %s event while the request is active',
    async (actionName) => {
      if (actionName === 'Export evidence') {
        vi.mocked(walletsApi.exportWalletRemediationProposal).mockReturnValue(new Promise(() => undefined));
      } else {
        vi.mocked(walletsApi.cancelWalletRemediationProposal).mockReturnValue(new Promise(() => undefined));
      }
      render(<WalletRemediationPanel walletId="wallet-1" walletName="Main Wallet" />);
      fireEvent.click(screen.getByRole('button', { name: 'Create safety preview' }));
      await screen.findByText(proposal.proposalId);

      const action = screen.getByRole('button', { name: actionName });
      fireEvent.click(action);
      action.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      if (actionName === 'Export evidence') {
        expect(walletsApi.exportWalletRemediationProposal).toHaveBeenCalledTimes(1);
      } else {
        expect(walletsApi.cancelWalletRemediationProposal).toHaveBeenCalledTimes(1);
      }
    },
  );

  it('ignores a stale duplicate approval event while approval is active', async () => {
    vi.mocked(walletsApi.approveWalletRemediationProposal).mockReturnValue(new Promise(() => undefined));
    render(<WalletRemediationPanel walletId="wallet-1" walletName="Main Wallet" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create safety preview' }));
    await screen.findByText(proposal.proposalId);
    fireEvent.click(screen.getByRole('checkbox'));
    const approve = screen.getByRole('button', { name: 'Approve and apply' });

    fireEvent.click(approve);
    approve.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(walletsApi.approveWalletRemediationProposal).toHaveBeenCalledTimes(1);
  });

  it('fails closed on a stale approval and requires a new preview', async () => {
    vi.mocked(walletsApi.approveWalletRemediationProposal).mockRejectedValue(
      new ApiError('proposal stale', 409),
    );
    render(<WalletRemediationPanel walletId="wallet-1" walletName="Main Wallet" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create safety preview' }));
    await screen.findByText(proposal.proposalId);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve and apply' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Create a new safety preview');
    expect(screen.queryByText(proposal.proposalId)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create safety preview' })).toBeEnabled();
  });

  it('exports only the displayed proposal ID and digest', async () => {
    render(<WalletRemediationPanel walletId="wallet-1" walletName="Main Wallet" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create safety preview' }));
    await screen.findByText(proposal.proposalId);
    fireEvent.click(screen.getByRole('button', { name: 'Export evidence' }));

    await waitFor(() => expect(walletsApi.exportWalletRemediationProposal).toHaveBeenCalledWith(
      'wallet-1', proposal.proposalId, DIGEST, 'Main Wallet',
    ));
  });

  it('surfaces an evidence export failure without discarding the exact preview', async () => {
    vi.mocked(walletsApi.exportWalletRemediationProposal).mockRejectedValue(
      new Error('Evidence export unavailable'),
    );
    render(<WalletRemediationPanel walletId="wallet-1" walletName="Main Wallet" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create safety preview' }));
    await screen.findByText(proposal.proposalId);
    fireEvent.click(screen.getByRole('button', { name: 'Export evidence' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Evidence export unavailable');
    expect(screen.getByText(proposal.proposalId)).toBeInTheDocument();
  });

  it('cancels the exact pending proposal without applying changes', async () => {
    render(<WalletRemediationPanel walletId="wallet-1" walletName="Main Wallet" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create safety preview' }));
    await screen.findByText(proposal.proposalId);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel proposal' }));

    await waitFor(() => expect(walletsApi.cancelWalletRemediationProposal).toHaveBeenCalledWith(
      'wallet-1', proposal.proposalId, DIGEST, expect.any(AbortSignal),
    ));
    expect(await screen.findByText(/Cancelled without changing active wallet metadata/)).toBeInTheDocument();
    expect(walletsApi.approveWalletRemediationProposal).not.toHaveBeenCalled();
  });

  it('keeps the exact proposal pending when cancellation fails', async () => {
    vi.mocked(walletsApi.cancelWalletRemediationProposal).mockRejectedValue(
      new Error('Cancellation unavailable'),
    );
    render(<WalletRemediationPanel walletId="wallet-1" walletName="Main Wallet" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create safety preview' }));
    await screen.findByText(proposal.proposalId);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel proposal' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Cancellation unavailable');
    expect(screen.getByText(proposal.proposalId)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve and apply' })).toBeDisabled();
  });

  it('keeps the proposal pending when approval fails without a stale conflict', async () => {
    vi.mocked(walletsApi.approveWalletRemediationProposal).mockRejectedValue(new Error('Approval unavailable'));
    render(<WalletRemediationPanel walletId="wallet-1" walletName="Main Wallet" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create safety preview' }));
    await screen.findByText(proposal.proposalId);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve and apply' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Approval unavailable');
    expect(screen.getByText(proposal.proposalId)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve and apply' })).toBeEnabled();
  });

  it('drops a deferred preview after the wallet changes', async () => {
    let resolvePreview!: (value: walletsApi.WalletRemediationProposal) => void;
    vi.mocked(walletsApi.createWalletRemediationProposal).mockReturnValue(
      new Promise(resolve => { resolvePreview = resolve; }),
    );
    const view = render(<WalletRemediationPanel walletId="wallet-1" walletName="Wallet One" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create safety preview' }));
    view.rerender(<WalletRemediationPanel walletId="wallet-2" walletName="Wallet Two" />);
    resolvePreview(proposal);

    await waitFor(() => expect(screen.queryByText(proposal.proposalId)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Create safety preview' })).toBeEnabled();
  });

  it('suppresses a deferred preview rejection after the wallet changes', async () => {
    let rejectPreview!: (reason: unknown) => void;
    vi.mocked(walletsApi.createWalletRemediationProposal).mockReturnValue(
      new Promise((_resolve, reject) => { rejectPreview = reject; }),
    );
    const view = render(<WalletRemediationPanel walletId="wallet-1" walletName="Wallet One" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create safety preview' }));
    view.rerender(<WalletRemediationPanel walletId="wallet-2" walletName="Wallet Two" />);
    rejectPreview(new Error('obsolete preview failure'));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it.each([
    ['approval', 'Approve and apply'],
    ['cancellation', 'Cancel proposal'],
  ])('drops a deferred %s result after the wallet changes', async (action, buttonName) => {
    let resolveAction!: (value: walletsApi.WalletRemediationProposal) => void;
    const pending = new Promise<walletsApi.WalletRemediationProposal>(resolve => { resolveAction = resolve; });
    if (action === 'approval') {
      vi.mocked(walletsApi.approveWalletRemediationProposal).mockReturnValue(pending);
    } else {
      vi.mocked(walletsApi.cancelWalletRemediationProposal).mockReturnValue(pending);
    }
    const onApplied = vi.fn();
    const view = render(
      <WalletRemediationPanel walletId="wallet-1" walletName="Wallet One" onApplied={onApplied} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create safety preview' }));
    await screen.findByText(proposal.proposalId);
    if (action === 'approval') fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: buttonName }));
    view.rerender(
      <WalletRemediationPanel walletId="wallet-2" walletName="Wallet Two" onApplied={onApplied} />,
    );
    resolveAction(action === 'approval'
      ? { ...proposal, state: 'applied', appliedAt: '2026-08-11T20:01:00.000Z', backout: { state: 'forward-fix-only', message: 'Applied.' } }
      : { ...proposal, state: 'cancelled' });

    await waitFor(() => expect(screen.queryByText(proposal.proposalId)).not.toBeInTheDocument());
    expect(onApplied).not.toHaveBeenCalled();
  });

  it.each([
    ['approval', 'Approve and apply'],
    ['evidence export', 'Export evidence'],
    ['cancellation', 'Cancel proposal'],
  ])('suppresses a deferred %s rejection after the wallet changes', async (action, buttonName) => {
    let rejectAction!: (reason: unknown) => void;
    const rejection = new Promise<never>((_resolve, reject) => { rejectAction = reject; });
    if (action === 'approval') {
      vi.mocked(walletsApi.approveWalletRemediationProposal).mockReturnValue(rejection);
    } else if (action === 'evidence export') {
      vi.mocked(walletsApi.exportWalletRemediationProposal).mockReturnValue(rejection);
    } else {
      vi.mocked(walletsApi.cancelWalletRemediationProposal).mockReturnValue(rejection);
    }
    const view = render(<WalletRemediationPanel walletId="wallet-1" walletName="Wallet One" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create safety preview' }));
    await screen.findByText(proposal.proposalId);
    if (action === 'approval') fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: buttonName }));
    view.rerender(<WalletRemediationPanel walletId="wallet-2" walletName="Wallet Two" />);
    rejectAction(new Error('obsolete action failure'));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
