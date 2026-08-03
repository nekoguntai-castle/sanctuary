import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportPackageCard } from '../../src/components/SystemSettings/SupportPackageCard';
import * as supportPackageApi from '../../src/api/admin/supportPackage';

vi.mock('../../src/hooks/queries/useWallets', () => ({
  useWallets: () => ({
    data: [
      { id: 'sender-1', name: 'Sender wallet' },
      { id: 'receiver-2', name: 'Receiver wallet' },
    ],
    isLoading: false,
  }),
}));
vi.mock('../../src/api/admin/supportPackage', () => ({
  armIncidentCapture: vi.fn(),
  downloadSupportPackageArtifact: vi.fn(),
  getIncidentCaptureStatus: vi.fn(),
  previewIncidentSupportPackage: vi.fn(),
  previewSupportPackage: vi.fn(),
  teardownIncidentCapture: vi.fn(),
}));

function artifact(profile: 'shareable_aggregate' | 'single_incident'): supportPackageApi.SupportPackageArtifact {
  return {
    blob: new Blob(['canonical-bytes']),
    filename: `support-${profile}.json`,
    preview: {
      version: profile === 'shareable_aggregate' ? '2.1.0' : '1.0.0',
      profile,
      generatedAt: '2026-08-02T12:30:00.000Z',
      privacyValidation: 'passed' as const,
      collectors: {
        notificationQueue: {
          status: 'ok' as const,
          truncated: false,
          droppedCount: 0,
          provenance: {
            sourceProcess: 'redis_shared',
            sourceKind: 'queue_getters',
            observationWindow: 'point_in_time',
          },
          data: { waitingCountBucket: 'one' },
        },
      },
    },
  };
}

async function fillIncidentForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Transaction ID'), 'a'.repeat(64));
  await user.selectOptions(screen.getByLabelText('Sender wallet'), 'sender-1');
  await user.selectOptions(screen.getByLabelText('Receiver wallet'), 'receiver-2');
  await user.type(screen.getByLabelText('Approximate incident time'), '2026-08-02T12:30');
}

describe('SupportPackageCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supportPackageApi.getIncidentCaptureStatus).mockResolvedValue({ state: 'inactive' });
    vi.mocked(supportPackageApi.previewSupportPackage).mockResolvedValue(artifact('shareable_aggregate'));
    vi.mocked(supportPackageApi.previewIncidentSupportPackage).mockResolvedValue(artifact('single_incident'));
    vi.mocked(supportPackageApi.armIncidentCapture).mockResolvedValue({
      state: 'ready',
      expiresIn: 'under_fifteen_minutes',
    });
    vi.mocked(supportPackageApi.teardownIncidentCapture).mockResolvedValue({ state: 'inactive' });
  });

  it('discloses aggregate exclusions, incident limitations, capture behavior, and old-package risk', async () => {
    render(<SupportPackageCard />);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/inactive/i));

    expect(screen.getByText(/exclude identities, wallet and transaction data/i)).toBeInTheDocument();
    expect(screen.getByText(/aggregate counts and coarse activity windows/i)).toBeInTheDocument();
    expect(screen.getByText(/version 0.8.56 are not safe to share/i)).toBeInTheDocument();
    expect(screen.getByText(/selectors are excluded from the resulting file/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot prove delivery or reconstruct evidence/i)).toBeInTheDocument();
    expect(screen.getByText(/does not send a transaction, retry a job, contact Telegram/i)).toBeInTheDocument();
  });

  it('requires aggregate confirmation, previews once, and downloads the same local artifact', async () => {
    const user = userEvent.setup();
    const aggregateArtifact = artifact('shareable_aggregate');
    vi.mocked(supportPackageApi.previewSupportPackage).mockResolvedValue(aggregateArtifact);
    render(<SupportPackageCard />);

    const previewButton = screen.getByRole('button', { name: /Generate Aggregate Preview/i });
    expect(previewButton).toBeDisabled();
    await user.click(screen.getByLabelText(/confirm that I intend to generate the shareable aggregate/i));
    await user.click(previewButton);

    expect(await screen.findByText(/Local preview · shareable_aggregate/i)).toBeInTheDocument();
    expect(screen.getByText(/Privacy validation: passed/i)).toBeInTheDocument();
    expect(screen.getByText(/waitingCountBucket:/i)).toBeInTheDocument();
    expect(supportPackageApi.previewSupportPackage).toHaveBeenCalledOnce();

    await user.click(screen.getAllByRole('button', { name: /Download Previewed File/i })[0]);
    expect(supportPackageApi.downloadSupportPackageArtifact).toHaveBeenCalledWith(aggregateArtifact);
    expect(supportPackageApi.previewSupportPackage).toHaveBeenCalledOnce();
  });

  it('keeps incident generation separate and requires complete selectors plus confirmation', async () => {
    const user = userEvent.setup();
    render(<SupportPackageCard />);
    const incidentButton = screen.getByRole('button', { name: /Generate Incident Preview/i });
    expect(incidentButton).toBeDisabled();

    await fillIncidentForm(user);
    expect(incidentButton).toBeDisabled();
    await user.click(screen.getByLabelText(/confirm that I intend to generate it locally/i));
    await user.click(incidentButton);

    expect(await screen.findByText(/Local preview · single_incident/i)).toBeInTheDocument();
    expect(supportPackageApi.previewIncidentSupportPackage).toHaveBeenCalledWith({
      txid: 'a'.repeat(64),
      senderWalletId: 'sender-1',
      receiverWalletId: 'receiver-2',
      approximateIncidentTime: expect.stringMatching(/^2026-08-02T/),
    });
    expect(supportPackageApi.previewSupportPackage).not.toHaveBeenCalled();
  });

  it('clears an incident preview when a selector changes', async () => {
    const user = userEvent.setup();
    render(<SupportPackageCard />);
    await fillIncidentForm(user);
    await user.click(screen.getByLabelText(/confirm that I intend to generate it locally/i));
    await user.click(screen.getByRole('button', { name: /Generate Incident Preview/i }));
    expect(await screen.findByText(/Local preview · single_incident/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Receiver wallet'), 'sender-1');
    expect(screen.queryByText(/Local preview · single_incident/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/confirm that I intend to generate it locally/i)).not.toBeChecked();
  });

  it('shows capture state and requires separate confirmation before arming or stopping', async () => {
    const user = userEvent.setup();
    render(<SupportPackageCard />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/inactive/i));
    await fillIncidentForm(user);

    const armButton = screen.getByRole('button', { name: /Arm Controlled Capture/i });
    expect(armButton).toBeDisabled();
    await user.click(screen.getByLabelText(/intend to arm a short-lived diagnostic capture/i));
    await user.click(armButton);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/ready/i));
    expect(supportPackageApi.armIncidentCapture).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Transaction ID')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Stop Controlled Capture/i }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/inactive/i));
    expect(supportPackageApi.teardownIncidentCapture).toHaveBeenCalledOnce();
  });

  it('shows a fixed error and permits aggregate retry without leaking private errors', async () => {
    vi.mocked(supportPackageApi.previewSupportPackage).mockRejectedValueOnce(new Error('private error'));
    const user = userEvent.setup();
    render(<SupportPackageCard />);

    await user.click(screen.getByLabelText(/confirm that I intend to generate the shareable aggregate/i));
    await user.click(screen.getByRole('button', { name: /Generate Aggregate Preview/i }));

    expect(await screen.findByText('The privacy-safe support package could not be generated.')).toBeInTheDocument();
    expect(screen.queryByText(/private error/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate Aggregate Preview/i })).toBeEnabled();
  });

  it('renders bounded nested and array facts while excluding identifying keys', async () => {
    const rich = artifact('shareable_aggregate');
    rich.preview.collectors.notificationQueue.data = {
      label: 'ignored',
      observations: [0, ...Array.from({ length: 7 }, (_, index) => ({
        state: index % 2 ? 'ready' : 'partial',
        coverage: 'all',
      }))],
      nested: { outcome: 'accepted' },
      walletId: 'must-not-render',
    };
    rich.preview.collectors.minimal = {
      status: 'error',
      truncated: true,
      droppedCount: 1,
    };
    vi.mocked(supportPackageApi.previewSupportPackage).mockResolvedValue(rich);
    const user = userEvent.setup();
    render(<SupportPackageCard />);
    await user.click(screen.getByLabelText(/confirm that I intend to generate the shareable aggregate/i));
    await user.click(screen.getByRole('button', { name: /Generate Aggregate Preview/i }));
    expect((await screen.findAllByText(/observations\[/i)).length).toBeGreaterThan(10);
    expect(screen.getAllByText(/not reported/i)).toHaveLength(3);
    expect(screen.queryByText(/must-not-render/i)).not.toBeInTheDocument();
  });

  it('shows unavailable state when capture status cannot be read', async () => {
    vi.mocked(supportPackageApi.getIncidentCaptureStatus).mockRejectedValue(new Error('private'));
    render(<SupportPackageCard />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/unavailable/i));
    expect(screen.queryByText(/private/i)).not.toBeInTheDocument();
  });

  it('shows categorical capture failure and exercises periodic status refresh', async () => {
    vi.mocked(supportPackageApi.getIncidentCaptureStatus).mockResolvedValue({
      state: 'invalid',
      failure: 'session_expired',
    });
    const intervalSpy = vi.spyOn(window, 'setInterval').mockImplementation(((handler: TimerHandler) => {
      if (typeof handler === 'function') handler();
      return 1;
    }) as typeof window.setInterval);
    render(<SupportPackageCard />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/session_expired/i));
    expect(supportPackageApi.getIncidentCaptureStatus).toHaveBeenCalledTimes(2);
    intervalSpy.mockRestore();
  });

  it('pauses polling while a capture action is active', async () => {
    const intervalSpy = vi.spyOn(window, 'setInterval')
      .mockImplementation((() => 1) as unknown as typeof window.setInterval);
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    let resolveArm!: (status: supportPackageApi.IncidentCaptureStatus) => void;
    vi.mocked(supportPackageApi.armIncidentCapture).mockReturnValue(new Promise(resolve => {
      resolveArm = resolve;
    }));
    const user = userEvent.setup();
    render(<SupportPackageCard />);
    await waitFor(() => expect(supportPackageApi.getIncidentCaptureStatus).toHaveBeenCalledOnce());
    await fillIncidentForm(user);
    await user.click(screen.getByLabelText(/intend to arm a short-lived diagnostic capture/i));
    await user.click(screen.getByRole('button', { name: /Arm Controlled Capture/i }));
    expect(clearIntervalSpy).toHaveBeenCalledWith(1);
    expect(supportPackageApi.getIncidentCaptureStatus).toHaveBeenCalledOnce();
    resolveArm({ state: 'ready' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/ready/i));
    intervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('ignores a stale rejected status request after a newer action starts', async () => {
    let rejectStatus!: (error: Error) => void;
    vi.mocked(supportPackageApi.getIncidentCaptureStatus).mockReturnValue(new Promise((_resolve, reject) => {
      rejectStatus = reject;
    }));
    const user = userEvent.setup();
    render(<SupportPackageCard />);
    await user.click(screen.getByLabelText(/confirm that I intend to generate the shareable aggregate/i));
    await user.click(screen.getByRole('button', { name: /Generate Aggregate Preview/i }));
    rejectStatus(new Error('stale private failure'));
    await waitFor(() => expect(screen.getByText(/Local preview · shareable_aggregate/i)).toBeInTheDocument());
  });
});
