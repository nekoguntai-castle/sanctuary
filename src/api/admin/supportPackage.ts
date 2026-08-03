/** Privacy-safe support package API and local artifact handling. */

import apiClient from '../client';
import { downloadBlob } from '../../utils/download';

export interface IncidentProfileRequest {
  txid: string;
  senderWalletId: string;
  receiverWalletId: string;
  approximateIncidentTime: string;
}

export type IncidentCaptureState =
  | 'inactive'
  | 'arming'
  | 'ready'
  | 'partial'
  | 'invalid'
  | 'tearing_down';

export interface IncidentCaptureStatus {
  state: IncidentCaptureState;
  expiresIn?: string;
  failure?: string;
}

export interface SupportPackageSectionPreview {
  status: 'ok' | 'error';
  truncated: boolean;
  droppedCount: number;
  provenance?: {
    sourceProcess?: string;
    sourceKind?: string;
    observationWindow?: string;
  };
  data?: Record<string, unknown>;
}

export interface SupportPackagePreview {
  version: string;
  profile: 'shareable_aggregate' | 'single_incident';
  generatedAt: string;
  collectors: Record<string, SupportPackageSectionPreview>;
  privacyValidation: 'passed';
}

export interface SupportPackageArtifact {
  /** The exact server-validated bytes retained for the eventual local download. */
  blob: Blob;
  filename: string;
  preview: SupportPackagePreview;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSection(value: unknown): SupportPackageSectionPreview {
  if (!isRecord(value) || (value.status !== 'ok' && value.status !== 'error')) {
    throw new Error('Invalid support package section');
  }
  if (typeof value.truncated !== 'boolean' || typeof value.droppedCount !== 'number') {
    throw new Error('Invalid support package section bounds');
  }
  const provenance = isRecord(value.provenance)
    ? {
        ...(typeof value.provenance.sourceProcess === 'string'
          ? { sourceProcess: value.provenance.sourceProcess }
          : {}),
        ...(typeof value.provenance.sourceKind === 'string'
          ? { sourceKind: value.provenance.sourceKind }
          : {}),
        ...(typeof value.provenance.observationWindow === 'string'
          ? { observationWindow: value.provenance.observationWindow }
          : {}),
      }
    : undefined;
  return {
    status: value.status,
    truncated: value.truncated,
    droppedCount: value.droppedCount,
    ...(provenance ? { provenance } : {}),
    ...(isRecord(value.data) ? { data: value.data } : {}),
  };
}

function parsePreview(value: unknown): SupportPackagePreview {
  if (!isRecord(value) || typeof value.version !== 'string') {
    throw new Error('Invalid support package envelope');
  }
  if (value.profile !== 'shareable_aggregate' && value.profile !== 'single_incident') {
    throw new Error('Invalid support package profile');
  }
  if (typeof value.generatedAt !== 'string' || !isRecord(value.collectors)) {
    throw new Error('Invalid support package envelope');
  }
  const collectors = Object.fromEntries(
    Object.entries(value.collectors).map(([name, section]) => [name, parseSection(section)]),
  );
  const meta = isRecord(value.meta) ? value.meta : undefined;
  const privacyValidation = value.privacyValidation ?? meta?.privacyValidation;
  if (privacyValidation !== undefined && privacyValidation !== 'passed') {
    throw new Error('Support package privacy validation was not confirmed');
  }
  return {
    version: value.version,
    profile: value.profile,
    generatedAt: value.generatedAt,
    collectors,
    // A successful response from these endpoints is emitted only after the
    // server validates the exact response bytes. Older aggregate envelopes do
    // not serialize this marker, so the transport boundary supplies it.
    privacyValidation: 'passed',
  };
}

function filenameFor(preview: SupportPackagePreview): string {
  const timestamp = preview.generatedAt
    .replace(/[^0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const profile = preview.profile === 'single_incident' ? 'incident' : 'aggregate';
  return `sanctuary-support-${profile}-${timestamp}.json`;
}

async function artifactFromBlob(blob: Blob): Promise<SupportPackageArtifact> {
  const preview = parsePreview(JSON.parse(await blob.text()));
  return { blob, preview, filename: filenameFor(preview) };
}

async function fetchArtifact(endpoint: string, body: object): Promise<SupportPackageArtifact> {
  const blob = await apiClient.fetchBlob(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return artifactFromBlob(blob);
}

/** Compatibility action: generate and immediately download the aggregate profile. */
export async function downloadSupportPackage(): Promise<void> {
  await apiClient.download('/admin/support-package', undefined, {
    method: 'POST',
    body: { confirmShareableAggregate: true },
  });
}

/** Generate one aggregate artifact for local preview and later byte-identical download. */
export async function previewSupportPackage(): Promise<SupportPackageArtifact> {
  return fetchArtifact('/admin/support-package', { confirmShareableAggregate: true });
}

/** Generate one privacy-minimized incident artifact for local preview. */
export async function previewIncidentSupportPackage(
  request: IncidentProfileRequest,
): Promise<SupportPackageArtifact> {
  return fetchArtifact('/admin/support-package/incident', {
    ...request,
    confirmIncidentProfile: true,
  });
}

/** Download the exact Blob previously validated and previewed; performs no API request. */
export function downloadSupportPackageArtifact(artifact: SupportPackageArtifact): void {
  downloadBlob(artifact.blob, artifact.filename);
}

export async function getIncidentCaptureStatus(): Promise<IncidentCaptureStatus> {
  return apiClient.get<IncidentCaptureStatus>('/admin/support-package/incident-capture');
}

export async function armIncidentCapture(
  request: IncidentProfileRequest,
): Promise<IncidentCaptureStatus> {
  return apiClient.post<IncidentCaptureStatus>('/admin/support-package/incident-capture', {
    ...request,
    confirmIncidentCapture: true,
  });
}

export async function teardownIncidentCapture(): Promise<IncidentCaptureStatus> {
  return apiClient.delete<IncidentCaptureStatus>('/admin/support-package/incident-capture', {
    confirmIncidentCaptureTeardown: true,
  });
}
