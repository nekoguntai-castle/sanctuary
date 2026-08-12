import { expect, test, type Page, type Route } from '@playwright/test';
import {
  MAINNET_WALLET,
  MAINNET_WALLET_ID,
  mockAuthenticatedApi,
} from './userJourneyApi';

const PROPOSAL_DIGEST = 'a'.repeat(64);
const ORIGINAL_STATE_DIGEST = 'b'.repeat(64);
const POLICY_DIGEST = 'c'.repeat(64);
const PROPOSAL_ID = `wallet-remediation-v1:${PROPOSAL_DIGEST}`;
const ORIGINAL_STATE = {
  wallet: {
    id: MAINNET_WALLET_ID, type: 'single_sig', scriptType: 'native_segwit', network: 'mainnet',
    quorum: null, totalSigners: null, descriptor: 'wpkh(example)', changeDescriptor: 'wpkh(change)',
    descriptorPolicyVersion: 1, descriptorSourceKind: 'imported_pair',
    sourceDescriptor: 'wpkh(example)', sourceChangeDescriptor: 'wpkh(change)',
    sourceDescriptorChecksum: null, sourceChangeDescriptorChecksum: null,
    fingerprint: 'aabbccdd', canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
    canonicalPolicyVersion: 1,
  },
  signers: [],
  addresses: [],
  ownerUserIds: ['test-user'],
} as const;

const ELIGIBLE_PROPOSAL = {
  proposalId: PROPOSAL_ID,
  attemptId: '11111111-1111-4111-8111-111111111111',
  proofDigest: 'e'.repeat(64),
  walletId: MAINNET_WALLET_ID,
  schemaVersion: 'sanctuary.wallet-remediation.v1',
  proposalDigest: PROPOSAL_DIGEST,
  originalStateDigest: ORIGINAL_STATE_DIGEST,
  originalState: ORIGINAL_STATE,
  createdAt: '2026-08-11T20:00:00.000Z',
  state: 'pending',
  eligible: true,
  changes: [{
    kind: 'address_coordinate',
    recordId: 'address-1',
    proposed: { branch: 0, coordinateVersion: 1 },
    evidenceIds: ['evidence-address-1'],
  }],
  proof: {
    preservedPolicyDigest: POLICY_DIGEST,
    addressCount: 2,
    unchangedAddressCount: 2,
    scriptPubKeyCount: 2,
    unchangedScriptPubKeyCount: 2,
    recoveryStatus: 'recovery-proven', signingStatus: 'not-tested', recoveryEvidenceDigest: 'd'.repeat(64),
    evidenceIds: ['evidence-address-1'],
  },
  blockers: [],
  backout: {
    state: 'not-applied',
    message: 'No active wallet metadata has changed.',
  },
} as const;

const BLOCKED_PROPOSAL = {
  ...ELIGIBLE_PROPOSAL,
  state: 'blocked',
  eligible: false,
  changes: [],
  proof: {
    ...ELIGIBLE_PROPOSAL.proof,
    unchangedAddressCount: 0,
    unchangedScriptPubKeyCount: 0,
    recoveryStatus: 'blocked', signingStatus: 'not-tested', recoveryEvidenceDigest: null,
    evidenceIds: [],
  },
  blockers: [{
    code: 'recovery-metadata-unproven',
    message: 'Stored recovery metadata consistency could not be proven; signing was not tested.',
  }],
} as const;

const APPLIED_PROPOSAL = {
  ...ELIGIBLE_PROPOSAL,
  state: 'applied',
  appliedAt: '2026-08-11T20:05:00.000Z',
  backout: {
    state: 'forward-fix-only',
    message: 'Applied evidence is immutable; use a new proposal for any correction.',
  },
} as const;

const CANCELLED_PROPOSAL = {
  ...ELIGIBLE_PROPOSAL,
  state: 'cancelled',
} as const;

type RemediationScenario = 'eligible' | 'blocked' | 'stale';

type RemediationRequests = {
  previewBodies: unknown[];
  approvalBodies: unknown[];
  cancellationBodies: unknown[];
  exportDigests: string[];
};

function parseApiPath(route: Route): { method: string; path: string; url: URL } {
  const request = route.request();
  const url = new URL(request.url());
  return {
    method: request.method(),
    path: url.pathname.replace(/^\/api\/v1/, ''),
    url,
  };
}

function readPostBody(route: Route): unknown {
  try {
    return route.request().postDataJSON();
  } catch {
    return null;
  }
}

async function installRemediationFixture(
  page: Page,
  scenario: RemediationScenario,
): Promise<RemediationRequests> {
  const requests: RemediationRequests = {
    previewBodies: [],
    approvalBodies: [],
    cancellationBodies: [],
    exportDigests: [],
  };

  await page.route('**/api/v1/**', async route => {
    const { method, path, url } = parseApiPath(route);
    const proposalRoot = `/wallets/${MAINNET_WALLET_ID}/remediation/proposals`;

    if (method === 'POST' && path === proposalRoot) {
      requests.previewBodies.push(readPostBody(route));
      const proposal = scenario === 'blocked' ? BLOCKED_PROPOSAL : ELIGIBLE_PROPOSAL;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(proposal) });
      return;
    }

    if (method === 'POST' && path === `${proposalRoot}/${PROPOSAL_ID}/approve`) {
      requests.approvalBodies.push(readPostBody(route));
      if (scenario === 'stale') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Proposal no longer matches the active wallet state' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(APPLIED_PROPOSAL),
      });
      return;
    }

    if (method === 'POST' && path === `${proposalRoot}/${PROPOSAL_ID}/cancel`) {
      requests.cancellationBodies.push(readPostBody(route));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(CANCELLED_PROPOSAL),
      });
      return;
    }

    if (method === 'GET' && path === `${proposalRoot}/${PROPOSAL_ID}/export`) {
      requests.exportDigests.push(url.searchParams.get('digest') ?? '');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Content-Disposition': 'attachment; filename="wallet-remediation-evidence.json"' },
        body: JSON.stringify({ proposalId: PROPOSAL_ID, proposalDigest: PROPOSAL_DIGEST }),
      });
      return;
    }

    await route.fallback();
  });

  return requests;
}

async function openAdvancedSettings(page: Page): Promise<void> {
  await page.goto(`/#/wallets/${MAINNET_WALLET_ID}`);
  const main = page.getByRole('main');
  await main.getByRole('tab', { name: 'Settings', exact: true }).click();
  await main.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await expect(main.getByRole('heading', { name: 'Technical Details' })).toBeVisible();
}

test.describe('Wallet metadata remediation safety', () => {
  const runtimeErrors = new WeakMap<Page, string[]>();

  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    runtimeErrors.set(page, errors);
    page.on('pageerror', error => errors.push(error.message));
  });

  test.afterEach(async ({ page }, testInfo) => {
    expect(
      runtimeErrors.get(page) ?? [],
      `Unexpected page runtime errors in "${testInfo.title}"`,
    ).toEqual([]);
  });

  test('owner previews, acknowledges the exact proposal, applies it, and exports its evidence', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const requests = await installRemediationFixture(page, 'eligible');
    await openAdvancedSettings(page);

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Wallet Metadata Safety' })).toBeVisible();
    expect(requests.previewBodies).toEqual([]);

    await main.getByRole('button', { name: 'Create safety preview' }).click();
    await expect(main.getByText(PROPOSAL_ID, { exact: true })).toBeVisible();
    await expect(main.getByText(PROPOSAL_DIGEST, { exact: true })).toBeVisible();
    await expect(main.getByText(ORIGINAL_STATE_DIGEST, { exact: true })).toBeVisible();
    await expect(main.getByText('2 of 2 addresses and 2 of 2 scripts are unchanged.')).toBeVisible();
    await expect(main.getByText('Evidence: evidence-address-1')).toBeVisible();
    expect(requests.previewBodies).toEqual([{}]);

    const approveButton = main.getByRole('button', { name: 'Approve and apply' });
    await expect(approveButton).toBeDisabled();
    await main.getByRole('checkbox', {
      name: 'I verified this exact proposal ID and digest and approve only these metadata changes.',
    }).check();
    await expect(approveButton).toBeEnabled();
    await approveButton.click();

    await expect(main.getByRole('status')).toContainText('Applied successfully');
    expect(requests.approvalBodies).toEqual([{ proposalDigest: PROPOSAL_DIGEST }]);

    const downloadPromise = page.waitForEvent('download');
    await main.getByRole('button', { name: 'Export evidence' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      `Journey_Main_Wallet_remediation_wallet-remediation-v1_${PROPOSAL_DIGEST}.json`,
    );
    expect(requests.exportDigests).toEqual([PROPOSAL_DIGEST]);
    expect(unhandledRequests).toEqual([]);
  });

  test('blocked proof remains visibly ineligible and cannot be approved', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const requests = await installRemediationFixture(page, 'blocked');
    await openAdvancedSettings(page);

    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Create safety preview' }).click();
    await expect(main.getByRole('alert')).toContainText('No safe remediation can be applied.');
    await expect(main.getByRole('alert')).toContainText(
      'Stored recovery metadata consistency could not be proven; signing was not tested.',
    );
    await expect(main.getByRole('button', { name: 'Approve and apply' })).toHaveCount(0);
    await expect(main.getByRole('checkbox')).toHaveCount(0);
    expect(requests.approvalBodies).toEqual([]);
    expect(unhandledRequests).toEqual([]);
  });

  test('stale approval is discarded and requires a new exact preview', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const requests = await installRemediationFixture(page, 'stale');
    await openAdvancedSettings(page);

    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Create safety preview' }).click();
    await main.getByRole('checkbox').check();
    await main.getByRole('button', { name: 'Approve and apply' }).click();

    await expect(main.getByRole('alert')).toHaveText(
      'This preview is stale or no longer approvable. Create a new safety preview.',
    );
    await expect(main.getByText(PROPOSAL_ID, { exact: true })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Create safety preview' })).toBeVisible();
    expect(requests.approvalBodies).toEqual([{ proposalDigest: PROPOSAL_DIGEST }]);
    expect(unhandledRequests).toEqual([]);
  });

  test('owner cancels the exact proposal without applying active metadata', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const requests = await installRemediationFixture(page, 'eligible');
    await openAdvancedSettings(page);

    const main = page.getByRole('main');
    await main.getByRole('button', { name: 'Create safety preview' }).click();
    await main.getByRole('button', { name: 'Cancel proposal' }).click();

    await expect(main.getByRole('status')).toContainText('Cancelled without changing active wallet metadata');
    await expect(main.getByRole('button', { name: 'Approve and apply' })).toHaveCount(0);
    expect(requests.cancellationBodies).toEqual([{ proposalDigest: PROPOSAL_DIGEST }]);
    expect(requests.approvalBodies).toEqual([]);
    expect(unhandledRequests).toEqual([]);
  });

  test('non-owner cannot see or call wallet remediation controls', async ({ page }) => {
    const viewerWallet = { ...MAINNET_WALLET, userRole: 'viewer', canEdit: false };
    const unhandledRequests = await mockAuthenticatedApi(page, {
      wallets: [viewerWallet],
      failures: {
        [`GET /wallets/${MAINNET_WALLET_ID}`]: { status: 200, body: viewerWallet },
      },
    });
    const requests = await installRemediationFixture(page, 'eligible');
    await openAdvancedSettings(page);

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Wallet Metadata Safety' })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Create safety preview' })).toHaveCount(0);
    expect(requests.previewBodies).toEqual([]);
    expect(requests.approvalBodies).toEqual([]);
    expect(requests.cancellationBodies).toEqual([]);
    expect(requests.exportDigests).toEqual([]);
    expect(unhandledRequests).toEqual([]);
  });
});
