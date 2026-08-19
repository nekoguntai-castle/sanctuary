import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, ShieldCheck } from 'lucide-react';
import { ApiError } from '../../../../api/client';
import {
  approveWalletRemediationProposal,
  cancelWalletRemediationProposal,
  createWalletRemediationProposal,
  exportWalletRemediationProposal,
  type WalletRemediationProposal,
} from '../../../../api/wallets';
import { Button } from '../../../ui/Button';

interface WalletRemediationPanelProps {
  walletId: string;
  walletName: string;
  onApplied?: () => Promise<void> | void;
}

type PendingAction = 'preview' | 'approve' | 'cancel' | 'export' | null;

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : 'The remediation request failed.'
);

const isStaleConflict = (error: unknown): boolean => (
  error instanceof ApiError && error.status === 409
);

const changeLabel = (kind: WalletRemediationProposal['changes'][number]['kind']): string => {
  if (kind === 'wallet_policy') return 'Canonical policy metadata';
  // A recovery writes the descriptor policy itself, not just metadata. Say so plainly:
  // approving it is a materially larger decision than approving a metadata backfill.
  if (kind === 'wallet_policy_recovery') return 'Recovered descriptor policy';
  if (kind === 'signer_binding') return 'Signer account binding';
  return 'Address coordinate';
};

const isApprovalSafeProposal = (
  proposal: WalletRemediationProposal | null,
  walletId: string,
): boolean => Boolean(
  proposal
  && proposal.walletId === walletId
  && proposal.proposalId === `wallet-remediation-v1:${proposal.proposalDigest}`
  && proposal.eligible
  && proposal.state === 'pending'
  && proposal.blockers.length === 0
  && proposal.proof.evidenceIds.length > 0
  && proposal.proof.recoveryStatus === 'recovery-proven'
  && proposal.proof.recoveryEvidenceDigest
  && proposal.proof.unchangedAddressCount === proposal.proof.addressCount
  && proposal.proof.unchangedScriptPubKeyCount === proposal.proof.scriptPubKeyCount
);

export function WalletRemediationPanel({
  walletId,
  walletName,
  onApplied,
}: WalletRemediationPanelProps) {
  const [proposal, setProposal] = useState<WalletRemediationProposal | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setProposal(null);
    setAcknowledged(false);
    setPendingAction(null);
    setError(null);
    return () => requestRef.current?.abort();
  }, [walletId]);

  const beginRequest = (action: Exclude<PendingAction, null>): AbortController | null => {
    /* v8 ignore next -- Every action control is disabled while a request is active. */
    if (requestRef.current) return null;
    const controller = new AbortController();
    requestRef.current = controller;
    setPendingAction(action);
    setError(null);
    return controller;
  };

  const endRequest = (controller: AbortController): void => {
    if (requestRef.current !== controller) return;
    requestRef.current = null;
    setPendingAction(null);
  };

  const createPreview = async (): Promise<void> => {
    const controller = beginRequest('preview');
    /* v8 ignore next -- The preview control is disabled while a request is active. */
    if (!controller) return;
    try {
      const nextProposal = await createWalletRemediationProposal(walletId, controller.signal);
      if (controller.signal.aborted) return;
      setProposal(nextProposal);
      setAcknowledged(false);
    } catch (caught) {
      if (!controller.signal.aborted) setError(errorMessage(caught));
    } finally {
      endRequest(controller);
    }
  };

  const approvePreview = async (): Promise<void> => {
    /* v8 ignore next -- The approval handler is only rendered for an approval-safe proposal. */
    if (!proposal || !isApprovalSafeProposal(proposal, walletId) || !acknowledged) return;
    const controller = beginRequest('approve');
    /* v8 ignore next -- The approval control is disabled while a request is active. */
    if (!controller) return;
    try {
      const applied = await approveWalletRemediationProposal(
        walletId,
        proposal.proposalId,
        proposal.proposalDigest,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setProposal(applied);
      setAcknowledged(false);
      await onApplied?.();
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (isStaleConflict(caught)) {
        setProposal(null);
        setAcknowledged(false);
        setError('This preview is stale or no longer approvable. Create a new safety preview.');
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      endRequest(controller);
    }
  };

  const exportPreview = async (): Promise<void> => {
    /* v8 ignore next -- The export handler is only rendered while a proposal exists. */
    if (!proposal) return;
    const controller = beginRequest('export');
    /* v8 ignore next -- The export control is disabled while a request is active. */
    if (!controller) return;
    try {
      await exportWalletRemediationProposal(
        walletId,
        proposal.proposalId,
        proposal.proposalDigest,
        walletName,
      );
    } catch (caught) {
      if (!controller.signal.aborted) setError(errorMessage(caught));
    } finally {
      endRequest(controller);
    }
  };

  const cancelPreview = async (): Promise<void> => {
    /* v8 ignore next -- The cancellation handler is only rendered for pending proposals. */
    if (!proposal || proposal.state !== 'pending') return;
    const controller = beginRequest('cancel');
    /* v8 ignore next -- The cancellation control is disabled while a request is active. */
    if (!controller) return;
    try {
      const cancelled = await cancelWalletRemediationProposal(
        walletId,
        proposal.proposalId,
        proposal.proposalDigest,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setProposal(cancelled);
      setAcknowledged(false);
    } catch (caught) {
      if (!controller.signal.aborted) setError(errorMessage(caught));
    } finally {
      endRequest(controller);
    }
  };

  const canApprove = Boolean(
    isApprovalSafeProposal(proposal, walletId) && acknowledged && !pendingAction,
  );

  return (
    <section className="surface-elevated rounded-xl border border-sanctuary-200 p-5 dark:border-sanctuary-800">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 text-primary-600 dark:text-primary-700" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">
            Wallet Metadata Safety
          </h3>
          <p className="mt-1 text-xs text-sanctuary-500">
            Preview proven metadata corrections for this wallet. Sanctuary will not change descriptors,
            keys, addresses, scripts, key order, or spending conditions.
          </p>
        </div>
      </div>

      {!proposal && (
        <Button
          className="mt-4"
          variant="secondary"
          size="sm"
          onClick={createPreview}
          disabled={Boolean(pendingAction)}
          isLoading={pendingAction === 'preview'}
        >
          Create safety preview
        </Button>
      )}

      {proposal && (
        <div className="mt-4 space-y-4">
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-sanctuary-500">Proposal ID</dt>
              <dd className="break-all font-mono text-sanctuary-800 dark:text-sanctuary-200">{proposal.proposalId}</dd>
            </div>
            <div>
              <dt className="text-sanctuary-500">Proposal digest</dt>
              <dd className="break-all font-mono text-sanctuary-800 dark:text-sanctuary-200">{proposal.proposalDigest}</dd>
            </div>
            <div>
              <dt className="text-sanctuary-500">Original state digest</dt>
              <dd className="break-all font-mono text-sanctuary-800 dark:text-sanctuary-200">{proposal.originalStateDigest}</dd>
            </div>
          </dl>

          <div className="rounded-lg bg-sanctuary-50 p-3 text-xs dark:bg-sanctuary-800">
            <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">Proof summary</p>
            <p className="mt-1 text-sanctuary-600 dark:text-sanctuary-300">
              {proposal.proof.unchangedAddressCount} of {proposal.proof.addressCount} addresses and{' '}
              {proposal.proof.unchangedScriptPubKeyCount} of {proposal.proof.scriptPubKeyCount} scripts are unchanged.
            </p>
            <p className="mt-1 text-sanctuary-600 dark:text-sanctuary-300">
              Stored recovery metadata consistency: {proposal.proof.recoveryStatus}. No live device recovery or
              signing exercise was performed ({proposal.proof.signingStatus}).
            </p>
          </div>

          {proposal.changes.length > 0 && (
            <div>
              <p className="text-xs font-medium text-sanctuary-900 dark:text-sanctuary-100">Proposed metadata changes</p>
              <ul className="mt-2 space-y-2 text-xs text-sanctuary-600 dark:text-sanctuary-300">
                {proposal.changes.map(change => (
                  <li key={`${change.kind}:${change.recordId}`} className="rounded-lg border border-sanctuary-200 p-2 dark:border-sanctuary-700">
                    {changeLabel(change.kind)}:{' '}
                    <span className="font-mono">{change.recordId}</span>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono">
                      {JSON.stringify(change.proposed, null, 2)}
                    </pre>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!proposal.eligible && (
            <div role="alert" className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-xs text-warning-700 dark:border-warning-800 dark:bg-warning-100">
              <div className="flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-medium">No safe remediation can be applied.</p>
                  {proposal.blockers.map(blocker => <p key={blocker.code} className="mt-1">{blocker.message}</p>)}
                </div>
              </div>
            </div>
          )}

          {isApprovalSafeProposal(proposal, walletId) && (
            <label className="flex items-start gap-2 text-xs text-sanctuary-700 dark:text-sanctuary-300">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={acknowledged}
                disabled={Boolean(pendingAction)}
                onChange={event => setAcknowledged(event.target.checked)}
              />
              <span>I verified this exact proposal ID and digest and approve only these metadata changes.</span>
            </label>
          )}

          {proposal.state === 'applied' && (
            <div role="status" className="rounded-lg border border-success-200 bg-success-50 p-3 text-xs text-success-700 dark:border-success-800 dark:bg-success-100">
              Applied successfully. Evidence remains available for export. Backout is forward-fix only; this workflow does not erase immutable history.
            </div>
          )}

          {proposal.state === 'cancelled' && (
            <div role="status" className="rounded-lg border border-sanctuary-200 bg-sanctuary-50 p-3 text-xs text-sanctuary-700 dark:border-sanctuary-700 dark:bg-sanctuary-800 dark:text-sanctuary-200">
              Cancelled without changing active wallet metadata. Immutable preview and cancellation evidence remain available for export.
            </div>
          )}

          <div className="text-xs text-sanctuary-600 dark:text-sanctuary-300">
            <p>{proposal.backout.message}</p>
            <p className="mt-1 break-all font-mono">
              Evidence: {proposal.proof.evidenceIds.join(', ')}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {isApprovalSafeProposal(proposal, walletId) && (
              <Button size="sm" onClick={approvePreview} disabled={!canApprove} isLoading={pendingAction === 'approve'}>
                Approve and apply
              </Button>
            )}
            {proposal.state === 'pending' && (
              <Button size="sm" variant="ghost" onClick={cancelPreview} disabled={Boolean(pendingAction)} isLoading={pendingAction === 'cancel'}>
                Cancel proposal
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={exportPreview}
              disabled={Boolean(pendingAction)}
              isLoading={pendingAction === 'export'}
            >
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              Export evidence
            </Button>
            {proposal.state !== 'applied' && (
              <Button size="sm" variant="ghost" onClick={createPreview} disabled={Boolean(pendingAction)}>
                Create new preview
              </Button>
            )}
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-xs text-zen-vermilion">{error}</p>}
    </section>
  );
}
