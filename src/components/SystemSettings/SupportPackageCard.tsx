import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, LifeBuoy, Radio, Square } from 'lucide-react';

import { useWallets } from '../../hooks/queries/useWallets';
import {
  armIncidentCapture,
  downloadSupportPackageArtifact,
  getIncidentCaptureStatus,
  previewIncidentSupportPackage,
  previewSupportPackage,
  teardownIncidentCapture,
  type IncidentCaptureStatus,
  type IncidentProfileRequest,
  type SupportPackageArtifact,
} from '../../api/admin/supportPackage';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Input } from '../ui/Input';
import { NoticeAlert } from '../ui/NoticeAlert';

const PRIVACY_NOTICE =
  'Aggregate counts and coarse activity windows can still reveal operational activity on small deployments. Share the file only with your intended support party. Packages created by version 0.8.56 are not safe to share.';

const INCIDENT_NOTICE =
  'Incident mode sends one transaction ID and two wallet selectors to this Sanctuary server for local matching. Those selectors are excluded from the resulting file. The file contains only categorical, privacy-minimized evidence and cannot prove delivery or reconstruct evidence that was never retained.';

const CONTROLLED_CAPTURE_NOTICE =
  'Controlled capture observes only a future manual reproduction for up to 15 minutes. It does not send a transaction, retry a job, contact Telegram, or change wallet or provider state.';

const INPUT_CLASS =
  'w-full rounded-md border border-sanctuary-200 surface-muted px-3 py-2 text-sm dark:border-sanctuary-700';
const SAFE_FACT_KEY = /(bucket|count|coverage|state|outcome|failure|observation|present|enabled|registered|retention|attempt)/i;
const FORBIDDEN_FACT_KEY = /(recipient|wallet|user|transaction|job|txid|address|amount|fee|message|endpoint|url|host|token|secret)/i;

interface SafeFact {
  label: string;
  value: string;
}

function collectSafeFacts(value: unknown, prefix = '', facts: SafeFact[] = []): SafeFact[] {
  if (facts.length >= 12 || value === null || value === undefined) return facts;
  if (Array.isArray(value)) {
    value.slice(0, 8).forEach((entry, index) => collectSafeFacts(entry, `${prefix}[${index}]`, facts));
    return facts;
  }
  if (typeof value !== 'object') return facts;

  Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    if (facts.length >= 12) return true;
    const path = prefix ? `${prefix}.${key}` : key;
    if (
      (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean')
      && SAFE_FACT_KEY.test(key)
      && !FORBIDDEN_FACT_KEY.test(key)
    ) {
      facts.push({ label: path, value: String(child) });
    } else if (typeof child === 'object' && child !== null) {
      collectSafeFacts(child, path, facts);
    }
    return false;
  });
  return facts;
}

function SupportPackagePreview({ artifact }: { artifact: SupportPackageArtifact }) {
  return (
    <div className="space-y-3 rounded-lg border border-sanctuary-200 p-3 dark:border-sanctuary-700">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium text-sanctuary-800 dark:text-sanctuary-200">
          Local preview · {artifact.preview.profile} v{artifact.preview.version}
        </span>
        <span className="text-emerald-700 dark:text-emerald-300">
          Privacy validation: {artifact.preview.privacyValidation}
        </span>
      </div>
      <div className="space-y-2">
        {Object.entries(artifact.preview.collectors).map(([name, section]) => {
          const facts = collectSafeFacts(section.data);
          return (
            <details key={name} className="rounded-md surface-secondary px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium text-sanctuary-800 dark:text-sanctuary-200">
                {name} · {section.status}
              </summary>
              <dl className="mt-2 grid grid-cols-1 gap-1 text-xs text-sanctuary-600 dark:text-sanctuary-400 sm:grid-cols-2">
                <div><dt className="inline font-medium">Source: </dt><dd className="inline">{section.provenance?.sourceProcess ?? 'not reported'}</dd></div>
                <div><dt className="inline font-medium">Kind: </dt><dd className="inline">{section.provenance?.sourceKind ?? 'not reported'}</dd></div>
                <div><dt className="inline font-medium">Window: </dt><dd className="inline">{section.provenance?.observationWindow ?? 'not reported'}</dd></div>
                <div><dt className="inline font-medium">Truncated: </dt><dd className="inline">{section.truncated ? `yes (${section.droppedCount} dropped)` : 'no'}</dd></div>
                {facts.map((fact) => (
                  <div key={`${fact.label}:${fact.value}`}>
                    <dt className="inline font-medium">{fact.label}: </dt>
                    <dd className="inline">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          );
        })}
      </div>
      <p className="text-xs text-sanctuary-500">
        This preview is parsed from the exact validated Blob held in this browser. Downloading it
        makes no second request and does not reserialize the file.
      </p>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => downloadSupportPackageArtifact(artifact)}
      >
        <Download className="mr-2 h-4 w-4" />
        Download Previewed File
      </Button>
    </div>
  );
}

function CaptureStatus({ status }: { status: IncidentCaptureStatus | null }) {
  const state = status?.state ?? 'unavailable';
  return (
    <div role="status" className="rounded-lg border border-sanctuary-200 p-3 text-sm dark:border-sanctuary-700">
      <span className="font-medium text-sanctuary-800 dark:text-sanctuary-200">
        Controlled capture: {state.replace('_', ' ')}
      </span>
      {status?.expiresIn && (
        <span className="ml-2 text-sanctuary-500">expires {status.expiresIn}</span>
      )}
      {status?.failure && (
        <span className="ml-2 text-amber-700 dark:text-amber-300">({status.failure})</span>
      )}
    </div>
  );
}

function requestFromForm(
  txid: string,
  senderWalletId: string,
  receiverWalletId: string,
  approximateIncidentTime: string,
): IncidentProfileRequest {
  return {
    txid: txid.trim().toLowerCase(),
    senderWalletId,
    receiverWalletId,
    approximateIncidentTime: new Date(approximateIncidentTime).toISOString(),
  };
}

export const SupportPackageCard: React.FC = () => {
  const { data: wallets = [], isLoading: walletsLoading } = useWallets();
  const [aggregateConfirmed, setAggregateConfirmed] = useState(false);
  const [aggregateArtifact, setAggregateArtifact] = useState<SupportPackageArtifact | null>(null);
  const [incidentArtifact, setIncidentArtifact] = useState<SupportPackageArtifact | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txid, setTxid] = useState('');
  const [senderWalletId, setSenderWalletId] = useState('');
  const [receiverWalletId, setReceiverWalletId] = useState('');
  const [approximateIncidentTime, setApproximateIncidentTime] = useState('');
  const [incidentConfirmed, setIncidentConfirmed] = useState(false);
  const [captureConfirmed, setCaptureConfirmed] = useState(false);
  const [captureStatus, setCaptureStatus] = useState<IncidentCaptureStatus | null>(null);
  const captureStatusGeneration = useRef(0);
  const captureStatusInitialized = useRef(false);

  const refreshCaptureStatus = useCallback(async () => {
    const generation = ++captureStatusGeneration.current;
    try {
      const status = await getIncidentCaptureStatus();
      if (generation === captureStatusGeneration.current) setCaptureStatus(status);
    } catch {
      if (generation === captureStatusGeneration.current) setCaptureStatus(null);
    }
  }, []);

  useEffect(() => {
    if (busyAction !== null) return undefined;
    if (!captureStatusInitialized.current) {
      captureStatusInitialized.current = true;
      void refreshCaptureStatus();
    }
    const interval = window.setInterval(() => void refreshCaptureStatus(), 10_000);
    return () => {
      captureStatusGeneration.current += 1;
      window.clearInterval(interval);
    };
  }, [busyAction, refreshCaptureStatus]);

  const incidentRequest = useMemo(() => {
    if (
      !/^[0-9a-fA-F]{64}$/.test(txid.trim())
      || !senderWalletId
      || !receiverWalletId
      || senderWalletId === receiverWalletId
      || !approximateIncidentTime
    ) return null;
    return requestFromForm(txid, senderWalletId, receiverWalletId, approximateIncidentTime);
  }, [approximateIncidentTime, receiverWalletId, senderWalletId, txid]);

  const runAction = async (name: string, action: () => Promise<void>, fixedError: string) => {
    captureStatusGeneration.current += 1;
    setBusyAction(name);
    setError(null);
    try {
      await action();
    } catch {
      setError(fixedError);
    } finally {
      setBusyAction(null);
    }
  };

  const clearIncidentArtifact = () => setIncidentArtifact(null);
  const updateIncidentField = (update: () => void) => {
    update();
    clearIncidentArtifact();
    setIncidentConfirmed(false);
    setCaptureConfirmed(false);
  };
  const captureIsActive = captureStatus?.state === 'arming'
    || captureStatus?.state === 'ready'
    || captureStatus?.state === 'partial';

  return (
    <div className="surface-elevated overflow-hidden rounded-xl border border-sanctuary-200 dark:border-sanctuary-800">
      <div className="border-b border-sanctuary-100 p-6 dark:border-sanctuary-800">
        <div className="flex items-center space-x-3">
          <div className="surface-secondary rounded-lg p-2 text-primary-600 dark:text-primary-500">
            <LifeBuoy className="h-5 w-5" />
          </div>
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100">Support Package</h3>
        </div>
      </div>

      <div className="space-y-8 p-6">
        <section className="space-y-4" aria-labelledby="aggregate-support-heading">
          <div>
            <h4 id="aggregate-support-heading" className="font-medium text-sanctuary-900 dark:text-sanctuary-100">Aggregate profile</h4>
            <p className="mt-1 text-sm text-sanctuary-600 dark:text-sanctuary-400">
              Aggregate notification diagnostics exclude identities, wallet and transaction data,
              credentials, message content, endpoints, payloads, and raw errors.
            </p>
          </div>
          <NoticeAlert message={PRIVACY_NOTICE} tone="warning" />
          <label className="flex items-start gap-2 text-sm text-sanctuary-700 dark:text-sanctuary-300">
            <input
              type="checkbox"
              checked={aggregateConfirmed}
              onChange={(event) => {
                setAggregateConfirmed(event.target.checked);
                setAggregateArtifact(null);
              }}
              className="mt-0.5 h-4 w-4 rounded border-sanctuary-300 text-primary-600 focus:ring-primary-500 dark:border-sanctuary-600"
            />
            I understand this package contains aggregate operational activity and confirm that I
            intend to generate the shareable aggregate profile.
          </label>
          <Button
            variant="primary"
            size="sm"
            disabled={!aggregateConfirmed || busyAction !== null}
            onClick={() => void runAction('aggregate', async () => {
              setAggregateArtifact(await previewSupportPackage());
            }, 'The privacy-safe support package could not be generated.')}
          >
            <Eye className="mr-2 h-4 w-4" />
            {busyAction === 'aggregate' ? 'Generating…' : 'Generate Aggregate Preview'}
          </Button>
          {aggregateArtifact && <SupportPackagePreview artifact={aggregateArtifact} />}
        </section>

        <section className="space-y-4 border-t border-sanctuary-200 pt-6 dark:border-sanctuary-700" aria-labelledby="incident-support-heading">
          <div>
            <h4 id="incident-support-heading" className="font-medium text-sanctuary-900 dark:text-sanctuary-100">Single-incident profile</h4>
            <p className="mt-1 text-sm text-sanctuary-600 dark:text-sanctuary-400">
              Use this separate profile only to investigate one locally selected notification incident.
            </p>
          </div>
          <NoticeAlert message={INCIDENT_NOTICE} tone="warning" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2 text-sm text-sanctuary-700 dark:text-sanctuary-300">
              Transaction ID
              <Input aria-label="Transaction ID" disabled={captureIsActive} value={txid} onChange={(event) => updateIncidentField(() => setTxid(event.target.value))} className="mt-1 font-mono" />
            </label>
            <label className="text-sm text-sanctuary-700 dark:text-sanctuary-300">
              Sender wallet
              <select aria-label="Sender wallet" className={`${INPUT_CLASS} mt-1`} disabled={walletsLoading || captureIsActive} value={senderWalletId} onChange={(event) => updateIncidentField(() => setSenderWalletId(event.target.value))}>
                <option value="">Select sender wallet</option>
                {wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}
              </select>
            </label>
            <label className="text-sm text-sanctuary-700 dark:text-sanctuary-300">
              Receiver wallet
              <select aria-label="Receiver wallet" className={`${INPUT_CLASS} mt-1`} disabled={walletsLoading || captureIsActive} value={receiverWalletId} onChange={(event) => updateIncidentField(() => setReceiverWalletId(event.target.value))}>
                <option value="">Select receiver wallet</option>
                {wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}
              </select>
            </label>
            <label className="sm:col-span-2 text-sm text-sanctuary-700 dark:text-sanctuary-300">
              Approximate incident time
              <Input type="datetime-local" aria-label="Approximate incident time" disabled={captureIsActive} value={approximateIncidentTime} onChange={(event) => updateIncidentField(() => setApproximateIncidentTime(event.target.value))} className="mt-1" />
            </label>
          </div>
          <label className="flex items-start gap-2 text-sm text-sanctuary-700 dark:text-sanctuary-300">
            <input type="checkbox" checked={incidentConfirmed} onChange={(event) => { setIncidentConfirmed(event.target.checked); clearIncidentArtifact(); }} className="mt-0.5 h-4 w-4" />
            I understand the incident profile contains privacy-minimized evidence about one selected
            incident and confirm that I intend to generate it locally.
          </label>
          <Button
            variant="primary"
            size="sm"
            disabled={!incidentConfirmed || !incidentRequest || busyAction !== null}
            onClick={() => void runAction('incident', async () => {
              setIncidentArtifact(await previewIncidentSupportPackage(incidentRequest!));
            }, 'The privacy-safe incident profile could not be generated.')}
          >
            <Eye className="mr-2 h-4 w-4" />
            {busyAction === 'incident' ? 'Generating…' : 'Generate Incident Preview'}
          </Button>
          {incidentArtifact && <SupportPackagePreview artifact={incidentArtifact} />}

          <div className="space-y-3 rounded-lg border border-sanctuary-200 p-4 dark:border-sanctuary-700">
            <div className="flex items-center gap-2 font-medium text-sanctuary-900 dark:text-sanctuary-100">
              <Radio className="h-4 w-4" /> Controlled capture
            </div>
            <NoticeAlert message={CONTROLLED_CAPTURE_NOTICE} tone="warning" />
            <CaptureStatus status={captureStatus} />
            <label className="flex items-start gap-2 text-sm text-sanctuary-700 dark:text-sanctuary-300">
              <input type="checkbox" checked={captureConfirmed} onChange={(event) => setCaptureConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4" />
              I confirm that I intend to arm a short-lived diagnostic capture for a manual reproduction.
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!captureConfirmed || !incidentRequest || busyAction !== null || captureStatus?.state === 'ready'}
                onClick={() => void runAction('arm', async () => {
                  setCaptureStatus(await armIncidentCapture(incidentRequest!));
                }, 'Controlled capture could not be armed.')}
              >
                <Radio className="mr-2 h-4 w-4" />
                {busyAction === 'arm' ? 'Arming…' : 'Arm Controlled Capture'}
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={busyAction !== null || !captureStatus || captureStatus.state === 'inactive'}
                onClick={() => void runAction('teardown', async () => {
                  setCaptureStatus(await teardownIncidentCapture());
                  setCaptureConfirmed(false);
                }, 'Controlled capture could not be stopped.')}
              >
                <Square className="mr-2 h-4 w-4" />
                {busyAction === 'teardown' ? 'Stopping…' : 'Stop Controlled Capture'}
              </Button>
            </div>
          </div>
        </section>

        <ErrorAlert message={error} className="mb-0" />
      </div>
    </div>
  );
};
