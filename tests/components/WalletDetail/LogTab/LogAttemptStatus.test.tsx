import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LogAttemptStatus } from '../../../../src/components/WalletDetail/LogTab/LogAttemptStatus';
import type {
  WalletSyncControls,
  WalletSyncLifecycleClassification,
} from '../../../../src/utils/walletSyncLifecycle';

const checkpoint = {
  timestamp: Date.parse('2026-08-26T12:00:30.000Z'),
  details: {
    kind: 'sync_progress',
    event: 'batch_completed',
    stage: 'candidate_fetch',
    unit: 'transactions',
    batch: 1,
    batchCount: 4,
    elapsedMs: 25,
    completed: 25,
    total: 100,
  },
} as const;

const settled: WalletSyncLifecycleClassification = {
  state: 'settled',
  incrementalPending: false,
  fullResyncPending: false,
};

const controls = (requestPending = false): WalletSyncControls => ({
  requestSubmitting: false,
  executionRunning: false,
  requestPending,
  incrementalPending: requestPending,
  fullResyncPending: false,
  actionRequired: false,
  syncDisabled: requestPending,
  fullResyncDisabled: false,
});

describe('LogAttemptStatus', () => {
  it('labels a checkpoint current only during a running lease', () => {
    render(
      <LogAttemptStatus
        checkpoint={checkpoint}
        lifecycle={{
          ...settled,
          state: 'running',
          leaseClaimedAt: Date.parse('2026-08-26T12:00:00.000Z'),
        }}
        controls={controls()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Current attempt: Fetching transaction candidates',
    );
  });

  it('labels retained progress as prior when another request is pending', () => {
    render(
      <LogAttemptStatus checkpoint={checkpoint} lifecycle={settled} controls={controls(true)} />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Attempt stopped; sync request pending. Last checkpoint is from a prior attempt.',
    );
  });

  it('does not relabel a previous attempt checkpoint when a newer lease starts', () => {
    render(
      <LogAttemptStatus
        checkpoint={checkpoint}
        lifecycle={{
          ...settled,
          state: 'running',
          leaseClaimedAt: Date.parse('2026-08-26T12:01:00.000Z'),
        }}
        controls={controls()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Last checkpoint is from a prior attempt',
    );
    expect(screen.getByRole('status')).not.toHaveTextContent('Current attempt');
  });

  it('reports expired lease evidence before a pending request', () => {
    render(
      <LogAttemptStatus
        checkpoint={checkpoint}
        lifecycle={{
          ...settled,
          state: 'attention',
          attentionReason: 'lease_evidence_expired',
        }}
        controls={controls(true)}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Lease evidence expired. Last checkpoint is from a prior attempt.',
    );
  });

  it('renders a prior checkpoint for a settled attempt', () => {
    render(
      <LogAttemptStatus checkpoint={checkpoint} lifecycle={settled} controls={controls()} />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Last checkpoint is from a prior attempt: Fetching transaction candidates',
    );
  });

  it('renders nothing without a checkpoint or exceptional lifecycle evidence', () => {
    const { container } = render(
      <LogAttemptStatus checkpoint={null} lifecycle={settled} controls={controls()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('reports pending and expired states without inventing a prior checkpoint', () => {
    const { rerender } = render(
      <LogAttemptStatus checkpoint={null} lifecycle={settled} controls={controls(true)} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Attempt stopped; sync request pending.');
    expect(screen.getByRole('status')).not.toHaveTextContent('prior attempt');

    rerender(
      <LogAttemptStatus
        checkpoint={null}
        lifecycle={{
          ...settled,
          state: 'attention',
          attentionReason: 'lease_evidence_expired',
        }}
        controls={controls()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Lease evidence expired.');
    expect(screen.getByRole('status')).not.toHaveTextContent('prior attempt');
  });
});
