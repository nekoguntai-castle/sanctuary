// Contract: scripts/ci/images/playwright-runner.Dockerfile's default
// PLAYWRIGHT_VERSION build arg must equal the Playwright version resolved by
// package-lock.json (node_modules/playwright-core). Without this check, a
// Playwright bump (e.g. bumping @playwright/test in package.json) can leave
// the baked runner image silently stale: CI would keep installing the old
// Chromium build while tests run against a newer @playwright/test, or the
// prebaked image would stop matching what the lockfile actually installs.
//
// The browser/render E2E jobs in test.yml run inside that image via a
// job-level `container:` block (runner-infra's documented "Prefer
// container: for new images" pattern -- see
// docs/how-to/runner-job-images.md there, and this repo's own
// .github/workflows/verify-vectors.yml sanctuary-ci-go jobs, which use the
// same runs-on: docker-socket + container.image shape). A container image is
// named by an immutable digest rather than a runner label, so there is no
// per-host rollout to desync -- but the digest itself must (a) be present
// (not the PLAYWRIGHT_IMAGE_DIGEST_PENDING placeholder left for a human to
// fill in once the image is built and pushed) and (b) be identical between
// the two jobs, since both run the same image.
//
// counting-cats' equivalent image has no such automated check -- its
// runner label version and its Dockerfile's ARG default are kept in sync by
// hand. This repo adds the check counting-cats lacks, using node:test since
// that is this repo's convention for CI helper contract tests (see
// tests/ci/check-wallet-sync-lifecycle-contract.test.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dockerfilePath = path.join(repoRoot, 'scripts/ci/images/playwright-runner.Dockerfile');
const lockfilePath = path.join(repoRoot, 'package-lock.json');
const testWorkflowPath = path.join(repoRoot, '.github/workflows/test.yml');

const PLAYWRIGHT_IMAGE_REPO = 'nexus.tabineko.dev/nekoguntai-castle/sanctuary-ci-playwright';
const PLAYWRIGHT_IMAGE_DIGEST_PLACEHOLDER = 'PLAYWRIGHT_IMAGE_DIGEST_PENDING';
const PLAYWRIGHT_E2E_JOB_NAMES = ['full-browser-e2e-tests', 'full-render-e2e-tests'];

export function lockfilePlaywrightVersion(lockfile) {
  const entry = lockfile.packages?.['node_modules/playwright-core'];
  if (!entry?.version) {
    throw new Error('package-lock.json has no resolved node_modules/playwright-core version');
  }
  return entry.version;
}

export function dockerfilePlaywrightVersion(dockerfileText) {
  const match = dockerfileText.match(/^ARG PLAYWRIGHT_VERSION=(\S+)$/m);
  if (!match) {
    throw new Error('playwright-runner.Dockerfile has no default ARG PLAYWRIGHT_VERSION=<version>');
  }
  return match[1];
}

export function dockerfileVersionLabel(dockerfileText) {
  const match = dockerfileText.match(
    /org\.opencontainers\.image\.version="\$\{PLAYWRIGHT_VERSION\}"/,
  );
  if (!match) {
    throw new Error(
      'playwright-runner.Dockerfile has no LABEL org.opencontainers.image.version="${PLAYWRIGHT_VERSION}"',
    );
  }
  return match[0];
}

// Extracts the raw text of one top-level job's body from a workflow file, so
// the checks below can be scoped to a single job rather than matching
// anywhere in the file. Deliberately a plain regex/slice over the raw YAML
// text rather than a full parse, matching this file's existing convention.
export function extractJobBlock(workflowText, jobName) {
  const headerRe = new RegExp(`^  ${jobName}:\\s*$`, 'm');
  const headerMatch = headerRe.exec(workflowText);
  if (!headerMatch) {
    throw new Error(`workflow has no top-level job named ${jobName}`);
  }
  const bodyStart = headerMatch.index + headerMatch[0].length;
  const rest = workflowText.slice(bodyStart);
  const nextJobMatch = /^\S|^  \S[^\n]*:\s*$/m.exec(rest);
  const bodyEnd = nextJobMatch ? bodyStart + nextJobMatch.index : workflowText.length;
  return workflowText.slice(bodyStart, bodyEnd);
}

export function jobContainerImage(jobBlock, jobName) {
  const match = jobBlock.match(/^\s*container:\s*\n\s*image:\s*(\S+)\s*$/m);
  if (!match) {
    throw new Error(`job ${jobName} has no container.image`);
  }
  return match[1];
}

// Collects every `runs-on: sanctuary-playwright-<version>` value anywhere in
// a workflow file. The container: image pattern replaces that label
// entirely, so no job may still request it.
export function workflowPlaywrightRunnerLabels(workflowText) {
  return [...workflowText.matchAll(/^\s*runs-on:.*sanctuary-playwright-\S+/gm)].map(
    (match) => match[0].trim(),
  );
}

test('test.yml has no leftover sanctuary-playwright-* runs-on label', () => {
  const workflowText = readFileSync(testWorkflowPath, 'utf8');
  const labels = workflowPlaywrightRunnerLabels(workflowText);

  assert.deepEqual(
    labels,
    [],
    'The Playwright E2E jobs must run inside the sanctuary-ci-playwright container image ' +
      `(a digest-pinned container: block), not a sanctuary-playwright-* runner label. Found: ${labels.join(', ')}`,
  );
});

test('both Playwright E2E jobs pin the same digest-pinned sanctuary-ci-playwright image', () => {
  const workflowText = readFileSync(testWorkflowPath, 'utf8');
  const digestPattern = new RegExp(`^${PLAYWRIGHT_IMAGE_REPO.replace(/[.]/g, '\\.')}@sha256:[0-9a-f]{64}$`);

  const images = PLAYWRIGHT_E2E_JOB_NAMES.map((jobName) => {
    const jobBlock = extractJobBlock(workflowText, jobName);
    return { jobName, image: jobContainerImage(jobBlock, jobName) };
  });

  for (const { jobName, image } of images) {
    assert.notEqual(
      image,
      `${PLAYWRIGHT_IMAGE_REPO}@sha256:${PLAYWRIGHT_IMAGE_DIGEST_PLACEHOLDER}`,
      `${jobName}'s container.image still carries the ${PLAYWRIGHT_IMAGE_DIGEST_PLACEHOLDER} ` +
        'placeholder. Build and push scripts/ci/images/playwright-runner.Dockerfile via ' +
        "runner-infra's scripts/ops/build-runner-image.sh and paste the printed digest in " +
        'place of the placeholder before this can merge.',
    );
    assert.match(
      image,
      digestPattern,
      `${jobName}'s container.image (${image}) must be ` +
        `${PLAYWRIGHT_IMAGE_REPO}@sha256:<64 lowercase hex characters>`,
    );
  }

  const distinctDigests = new Set(images.map(({ image }) => image));
  assert.equal(
    distinctDigests.size,
    1,
    'full-browser-e2e-tests and full-render-e2e-tests must pin the identical ' +
      `sanctuary-ci-playwright digest; found: ${[...distinctDigests].join(', ')}`,
  );
});

test('playwright-runner.Dockerfile default version matches the lockfile', () => {
  const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
  const dockerfileText = readFileSync(dockerfilePath, 'utf8');

  const lockVersion = lockfilePlaywrightVersion(lockfile);
  const dockerfileVersion = dockerfilePlaywrightVersion(dockerfileText);

  assert.equal(
    dockerfileVersion,
    lockVersion,
    `playwright-runner.Dockerfile ARG PLAYWRIGHT_VERSION=${dockerfileVersion} must match ` +
      `package-lock.json node_modules/playwright-core version ${lockVersion}. Bump the ` +
      'Dockerfile default alongside any Playwright version bump.',
  );
});

test('playwright-runner.Dockerfile records its version in an OCI label', () => {
  const dockerfileText = readFileSync(dockerfilePath, 'utf8');

  // Traces a built image's digest back to the Playwright version it bakes,
  // since the digest alone (what test.yml pins) carries no human-readable
  // version information.
  assert.doesNotThrow(() => dockerfileVersionLabel(dockerfileText));
});

test('lockfilePlaywrightVersion rejects a lockfile missing the package', () => {
  assert.throws(() => lockfilePlaywrightVersion({ packages: {} }), /playwright-core/);
});

test('dockerfilePlaywrightVersion rejects a Dockerfile missing the ARG default', () => {
  assert.throws(() => dockerfilePlaywrightVersion('FROM scratch\n'), /PLAYWRIGHT_VERSION/);
});

test('dockerfileVersionLabel rejects a Dockerfile missing the OCI version label', () => {
  assert.throws(() => dockerfileVersionLabel('FROM scratch\n'), /org\.opencontainers\.image\.version/);
});

test('extractJobBlock rejects an unknown job name', () => {
  assert.throws(() => extractJobBlock('jobs:\n  foo:\n    runs-on: ubuntu-22.04\n', 'bar'), /bar/);
});

test('jobContainerImage rejects a job block without a container.image', () => {
  assert.throws(() => jobContainerImage('    runs-on: ubuntu-22.04\n', 'foo'), /foo/);
});
