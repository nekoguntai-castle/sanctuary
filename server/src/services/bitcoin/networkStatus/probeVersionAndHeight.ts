/**
 * Shared version+height probe: request both RPCs in parallel via
 * `allSettled` (never `all`, so a rejection on one cannot leave the other's
 * outcome unobserved) and report a single success/failure outcome. Used by
 * both the pool probe and the direct singleton fallback so the two paths
 * cannot drift in how they interpret a partial RPC failure.
 */

export interface VersionAndHeightClient {
  getServerVersion(): Promise<{ server: string; protocol: string }>;
  getBlockHeight(): Promise<number>;
}

export type ProbeVersionAndHeightResult =
  | { ok: true; version: { server: string; protocol: string }; blockHeight: number }
  | { ok: false; failure: unknown };

export async function probeVersionAndHeight(
  client: VersionAndHeightClient,
): Promise<ProbeVersionAndHeightResult> {
  const [versionResult, heightResult] = await Promise.allSettled([
    client.getServerVersion(),
    client.getBlockHeight(),
  ]);

  if (versionResult.status === 'fulfilled' && heightResult.status === 'fulfilled') {
    return { ok: true, version: versionResult.value, blockHeight: heightResult.value };
  }

  const failure =
    versionResult.status === 'rejected'
      ? versionResult.reason
      : (heightResult as PromiseRejectedResult).reason;
  return { ok: false, failure };
}
