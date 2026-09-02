#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStrictJson } from './canonical-json.mjs';

const DOCKER_CLASSES = new Set([
  'compose_container', 'compose_network', 'compose_volume', 'oci_image', 'buildkit_cache',
]);
const PHASE6_HOST_CLASSES = new Set(['collector_process', 'git_worktree', 'temporary_artifact']);
const SOURCE_EXTENSIONS = new Set(['.sh', '.bash', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.yml', '.yaml', '.json']);
const EXCLUDED_PREFIXES = [
  'docs/archive/', 'tasks/', 'scripts/ci/vendor/', 'node_modules/', 'coverage/', 'dist/',
  'server/tests/', 'tests/ci/', 'tests/config/', 'tests/install/unit/', 'tests/ownership/',
  'tests/scripts/',
];
const EXCLUDED_PATHS = new Set(['scripts/ownership/check-lifecycle-callsites.mjs']);
const EXCLUDED_HOST_PATHS = new Set([
  // This file is the scanner's fixture corpus: destructive command strings are test data,
  // not executable host operations. Its temporary fixture roots are intentionally test-owned.
  'tests/ownership/lifecycle-host-callsite-scanner.test.mjs',
  'tests/ownership/lifecycle-callsite-scanner.test.mjs',
]);
const HOST_SOURCE_PREFIXES = ['.github/', 'scripts/', 'tests/'];
const CANONICAL_HOST_INTERNAL_PATHS = new Set([
  'scripts/ownership/ci-cleanup-coordinator.mjs',
  'scripts/ownership/cleanup-process-group-launcher.mjs',
  'scripts/ownership/cleanup-supervisor.mjs',
  'scripts/ownership/registration.mjs',
  'scripts/ci/run-with-log.sh',
  'scripts/perf/wallet-sync-persistence-driver.cjs',
]);
const EXPLICIT_HOST_CREATION_PATHS = new Map([
  ['scripts/ci/create-registered-staging.sh', 'temporary_artifact'],
  ['scripts/ci/create-isolated-workspace.sh', 'temporary_artifact'],
  ['scripts/perf/wallet-sync-high-fanout-replay.mjs', 'collector_process'],
]);
const PUBLIC_COMMAND_DOCS = new Set([
  'README.md', 'docs/how-to/docker.md', 'gateway/README.md',
  'scripts/bitcoin-core-docker/README.md', 'scripts/templates/README.template.md',
  'scripts/verify-psbt/README.md',
]);
const REGISTERED_PRODUCER_PATHS = new Set([
  'scripts/ci/build-runtime-image.sh',
  'scripts/ci/observe-runtime-image-cves.sh',
  'scripts/ci/run-jade-emulator-proof.sh',
  'scripts/ci/run-ledger-emulator-proof.sh',
  'scripts/ci/run-trezor-emulator-proof.sh',
  'scripts/ci/wallet-sync-replay-image.sh',
  'scripts/offline/apply-bundle.sh',
  'scripts/ops/grafana-quiescence-records.sh',
  'scripts/ops/run-grafana-password-migration.sh',
  'scripts/ownership/compose-image-registration.sh',
  'scripts/ownership/producer-hooks.sh',
  'scripts/perf/wallet-sync-high-fanout-replay.mjs',
  'scripts/perf/wallet-sync-replay-creation.mjs',
]);
const REGISTERED_TRANSIENT_PRODUCER_PATHS = new Set([
  'scripts/ci/run-jade-emulator-proof.sh',
  'scripts/ci/run-ledger-emulator-proof.sh',
  'scripts/ci/run-psbt-core-subject.sh',
  'scripts/ci/run-trezor-emulator-proof.sh',
  'scripts/ops/grafana-quiescence-records.sh',
  'scripts/ops/run-grafana-password-migration.sh',
]);
const REGISTERED_TRANSIENT_CREATION_COUNTS = new Map(
  [...REGISTERED_TRANSIENT_PRODUCER_PATHS].map((relativePath) => [relativePath, 1]),
);
const REGISTERED_IMAGE_CREATION_COUNTS = new Map([
  ['scripts/ci/build-runtime-image.sh', 1],
  ['scripts/ci/run-jade-emulator-proof.sh', 1],
  ['scripts/ci/run-ledger-emulator-proof.sh', 1],
  ['scripts/ci/wallet-sync-replay-image.sh', 2],
  ['scripts/offline/apply-bundle.sh', 1],
  ['scripts/verify-addresses/verify-repeatable.sh', 1],
]);
const RETAINED_APPLICATION_PRODUCER_PATHS = new Set([
  'scripts/bitcoin-core-docker/build.sh',
  'scripts/offline/create-bundle.sh',
]);
const RETAINED_SHARED_CACHE_PATHS = new Set([
  'README.md',
  'docs/how-to/docker.md',
  'scripts/bitcoin-core-docker/build.sh',
  'scripts/ci/build-runtime-image.sh',
  'scripts/ci/run-compose-e2e-subject.sh',
  'scripts/ci/run-jade-emulator-proof.sh',
  'scripts/ci/run-ledger-emulator-proof.sh',
  'scripts/ci/wallet-sync-replay-image.sh',
  'scripts/offline/create-bundle.sh',
  'scripts/ops/phase2-gateway-audit-compose-smoke.mjs',
  'scripts/ownership/run-operator-compose.sh',
  'scripts/perf/phase3-compose-benchmark-smoke.mjs',
  'scripts/setup.sh',
  'scripts/templates/README.template.md',
  'scripts/verify-addresses/verify-repeatable.sh',
  'start.sh',
  'tests/install/e2e/fresh-install.test.sh',
]);
const SELF_COORDINATED_PRODUCER_PATHS = new Set([
  '.github/workflows/podman-socket-canary.yml',
  'scripts/ci/run-compose-e2e-subject.sh',
  'scripts/ci/run-docker-test-subject.sh',
  'scripts/ci/run-jade-emulator-proof.sh',
  'scripts/ci/run-jade-protocol-harness.sh',
  'scripts/ci/run-ledger-emulator-proof.sh',
  'scripts/ci/run-psbt-core-subject.sh',
  'scripts/ci/run-trezor-emulator-proof.sh',
  'scripts/ops/phase2-alert-receiver-smoke.mjs',
  'scripts/ops/phase2-gateway-audit-compose-smoke.mjs',
  'scripts/perf/phase3-compose-benchmark-smoke.mjs',
  'scripts/run-integration-tests.sh',
  'scripts/verify-addresses/verify-repeatable.sh',
  'tests/install/e2e/fresh-install.test.sh',
  'tests/install/e2e/install-script.test.sh',
  'tests/install/e2e/upgrade-install.test.sh',
]);
const COORDINATED_COMPONENT_PATHS = new Set([
  'scripts/perf/phase3-compose/backend-scale-out-proof.mjs',
  'scripts/perf/phase3-compose/worker-proofs.mjs',
  'tests/install/utils/helpers.sh',
  'tests/install/utils/upgrade-assertions.sh',
  'tests/install/utils/upgrade-wallet-sync-retirement-helpers.sh',
]);
const APPLICATION_LIFECYCLE_PATHS = new Set([
  'scripts/ops/run-grafana-password-migration.sh',
  'scripts/ownership/run-operator-compose.sh',
  'scripts/secrets/migrate-runtime-secrets.sh',
  'scripts/setup.sh',
  'server/src/utils/docker/tor.ts',
  'src/components/Monitoring/MonitoringDisabledBanner.tsx',
  'start.sh',
  'uninstall.sh',
]);

function trackedFiles(root) {
  // Include new non-ignored sources so a pre-commit quality run cannot miss a
  // newly introduced cleanup bypass merely because it is not staged yet.
  return execFileSync(
    'git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0').filter(Boolean);
}

function isSourcePath(relativePath) {
  if (EXCLUDED_PATHS.has(relativePath)) return false;
  if (EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return false;
  if (PUBLIC_COMMAND_DOCS.has(relativePath)) return true;
  if (path.basename(relativePath) === 'package.json') return true;
  if (path.extname(relativePath) === '.json') return false;
  return SOURCE_EXTENSIONS.has(path.extname(relativePath));
}

function isHostSourcePath(relativePath) {
  if (EXCLUDED_PATHS.has(relativePath) || EXCLUDED_HOST_PATHS.has(relativePath)) return false;
  if (relativePath.startsWith('scripts/ci/vendor/')) return false;
  if (!HOST_SOURCE_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return false;
  return SOURCE_EXTENSIONS.has(path.extname(relativePath));
}

function stripShellHeredocs(source) {
  const retained = [];
  let terminator = null;
  for (const line of source.split('\n')) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      continue;
    }
    retained.push(line);
    const match = /<<-?\s*["']?([A-Za-z_][A-Za-z0-9_-]*)["']?/.exec(line);
    if (match && !/\b(?:bash|sh|node|python3?)\b[^<]*<</.test(line)) {
      terminator = match[1];
    }
  }
  return retained.join('\n');
}

function normalizeDockerGlobalOptions(line) {
  const value = String.raw`(?:"[^"]*"|'[^']*'|[^\s]+)`;
  const valuedOption = String.raw`(?:--config|--context|-c|--host|-H|--log-level|-l|--connection|--url|--identity|--root|--runroot|--runtime|--storage-driver|--events-backend|--tmpdir)`;
  const flagOption = String.raw`(?:--debug|-D|--tls|--tlsverify|--remote)`;
  const globals = new RegExp(
    String.raw`\b(docker|podman)(?:\s+(?:${valuedOption}(?:=${value}|\s+${value})|${flagOption}))+(?=\s)`,
    'g',
  );
  return line.replace(globals, '$1');
}

function executableStatements(source) {
  return stripShellHeredocs(source)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((line) => !/^\s*(?:#(?!\!)|\/\/)/.test(line))
    .join('\n')
    .replace(/\\\r?\n/g, ' ')
    .split('\n').map((line) => normalizeDockerGlobalOptions(line.replace(/\s+/g, ' ').trim()))
    .filter((line) => line && !/^(?:echo|printf)\b/.test(line));
}

function shellCoordinatorGuardIndex(source) {
  const patterns = [
    /if\s+\[\[?[^\n;]*SANCTUARY_CLEANUP_COORDINATED[^\n;]*(?:!=|-ne)\s*["']?1["']?[^\n;]*\]\]?\s*;?\s*then\b[\s\S]{0,800}?\b(?:exit|return)\s+[1-9]\d*\b[\s\S]{0,200}?\bfi\b/g,
    /\[\[?[^\n]*SANCTUARY_CLEANUP_COORDINATED[^\n]*(?:=|==|-eq)\s*["']?1["']?[^\n]*\]\]?[^\n]*\|\|\s*\{[\s\S]{0,800}?\b(?:exit|return)\s+[1-9]\d*\b[\s\S]{0,200}?\}/g,
  ];
  const indices = patterns.map((expression) => expression.exec(source)?.index ?? -1)
    .filter((index) => index >= 0);
  return indices.length > 0 ? Math.min(...indices) : -1;
}

function matches(text, expressions) {
  return expressions.some((expression) => expression.test(text));
}

function dockerApiDeletes(text, collection) {
  const endpoint = String.raw`\/(?:v\d+(?:\.\d+)*\/)?${collection}\/(?!create\b)`;
  const method = String.raw`\bmethod\s*:\s*["']DELETE["']`;
  return new RegExp(`${endpoint}.{0,320}${method}`).test(text)
    || new RegExp(`${method}.{0,320}${endpoint}`).test(text);
}

function dockerApiCleanupClasses(text) {
  const collections = [
    ['containers', 'compose_container'], ['networks', 'compose_network'],
    ['volumes', 'compose_volume'], ['images', 'oci_image'],
  ];
  return collections.filter(([collection]) => dockerApiDeletes(text, collection))
    .map(([, resourceClass]) => resourceClass);
}

const DIRECT_CONTAINER_RUN = /\b(?:docker|podman)\s+run\b/;
const DIRECT_CONTAINER_CREATE = /\b(?:docker|podman)\s+(?:container\s+)?create\b/;
const ARGV_CONTAINER_RUN = /["'](?:docker|podman)["']\s*,\s*["']run["']/;
const DOCKER_HELPER_RUN = /\b(?:docker|podman)\s*\(\s*\[\s*["']run["']/;
const PREFIX_CONTAINER_RUN = /\bcommand\s*:\s*["'](?:docker|podman)["'].{0,160}\b(?:prefixArgs|args)\s*:\s*\[\s*["']run["']/;
const SHELL_CONTAINER_ARRAY = /\b\w*(?:args|command)\s*=\(\s*(?:create|run)\b/;
const INDIRECT_CONTAINER_PRODUCER = new RegExp(
  String.raw`\b(?:docker|podman)\s+["']?\$\{?\w*(?:args|command)\[@\]`,
);
const DIRECT_INVOKED_CONTAINER_PRODUCER = new RegExp(
  String.raw`\b(?:run|operation|execFileSync|spawnSync|spawn)\s*\(\s*\[\s*["'](?:docker|podman)["']\s*,\s*["'](?:create|run)["']`,
);
const RUN_COMPOSE_COORDINATOR_GUARD = new RegExp(
  String.raw`\[\s*"\$\{SANCTUARY_CLEANUP_COORDINATED:-0\}"\s*=\s*1\s*\]\s*\|\|\s*\{`,
);

function containerCreationCount(source) {
  const expressions = [
    /\b(?:docker|podman)\s+(?:container\s+)?create\b/g,
    /\b(?:docker|podman)\s+run\b/g,
    /["'](?:docker|podman)["']\s*,\s*["'](?:container["']\s*,\s*["'])?(?:create|run)["']/g,
    /\b(?:docker|podman)\s*\(\s*\[\s*["'](?:create|run)["']/g,
    /\bcommand\s*:\s*["'](?:docker|podman)["'].{0,160}\b(?:prefixArgs|args)\s*:\s*\[\s*["'](?:create|run)["']/g,
    /\b\w*(?:args|command)\s*=\(\s*(?:create|run)\b/g,
    /\/containers\/create\b/g,
  ];
  return countExpressionMatches(source, expressions);
}

function imageCreationCount(source) {
  const expressions = [
    /\b(?:docker|podman)\s+(?:(?:buildx|builder)\s+)?build\b/g,
    /\b(?:docker|podman)\s+(?:image\s+)?load\b/g,
    /["'](?:docker|podman)["']\s*,\s*["'](?:(?:buildx|builder|image)["']\s*,\s*["'])?(?:build|load)["']/g,
    /\/(?:v\d+(?:\.\d+)*\/)?images\/(?:create|load)\b/g,
    new RegExp("\\/v\\d+(?:\\.\\d+)*\\/build(?:\\?|[\"']|\\x60|$)", 'g'),
  ];
  return countExpressionMatches(source, expressions);
}

function countExpressionMatches(source, expressions) {
  let total = 0;
  for (const expression of expressions) total += [...source.matchAll(expression)].length;
  return total;
}

function directlyInvokesContainerProducer(source) {
  return DIRECT_INVOKED_CONTAINER_PRODUCER.test(source)
    || INDIRECT_CONTAINER_PRODUCER.test(source);
}

function isContainerRunProducer(line) {
  return DIRECT_CONTAINER_RUN.test(line) || ARGV_CONTAINER_RUN.test(line)
    || DOCKER_HELPER_RUN.test(line) || PREFIX_CONTAINER_RUN.test(line)
    || SHELL_CONTAINER_ARRAY.test(line);
}

function hasForegroundRemoveForm(line) {
  return /\b(?:docker|podman)\s+run\s+--rm(?:\s|$)/.test(line)
    || /["'](?:docker|podman)["']\s*,\s*["']run["']\s*,\s*["']--rm["']/.test(line)
    || /\b(?:docker|podman)\s*\(\s*\[\s*["']run["']\s*,\s*["']--rm["']/.test(line)
    || /(?:prefixArgs|args)\s*:\s*\[\s*["']run["']\s*,\s*["']--rm["']/.test(line);
}

function hasDetachedOrBoundedShellControl(line) {
  return /(?:\b(?:docker|podman)\s+run\s+--rm\s+-d(?:\s|$)|["']-d["']|--detach\b|\btimeout\b|(?:^|[^|])\|(?:[^|]|$)|(?:^|\s)&(?:\s|$))/.test(line);
}

function explicitlyForegroundDaemonAtomic(statements) {
  const producers = statements.filter(isContainerRunProducer);
  if (producers.length === 0) return false;
  return producers.every((line) => (
    hasForegroundRemoveForm(line) && !hasDetachedOrBoundedShellControl(line)
  ));
}

function dockerClasses(text) {
  const classes = new Set();
  const engine = String.raw`(?:docker|podman)`;
  const quote = String.raw`["']`;
  if (matches(text, [
    new RegExp(String.raw`\b${engine}\s+(?:container\s+)?(?:rm|stop|kill)\b`),
    new RegExp(String.raw`\b${engine}(?:\s+compose|-compose)?\b.{0,160}\brun\b.{0,160}--rm\b`),
    new RegExp(String.raw`${quote}${engine}${quote}\s*,\s*${quote}(?:(?:container)${quote}\s*,\s*${quote})?(?:rm|stop|kill)${quote}`),
    /\/containers\/[\w${}.-]+\/(?:stop|kill)\b/,
    /\b(?:run_project_compose|compose_output)\b[^\n]{0,240}\b(?:down|rm|stop|kill)\b/,
    /\brunCompose\s*\(\s*\[\s*['"](?:down|rm|stop|kill)['"]/,
  ]) || dockerApiDeletes(text, 'containers')) classes.add('compose_container');
  const composeMutation = new RegExp(
    String.raw`\b${engine}(?:\s+compose|-compose)\b.{0,320}\b(?:down|rm|stop|kill)\b`,
  );
  const composeWrapperMutation = /\b(?:run_project_compose|compose_output|runCompose|COMPOSE_COMMAND|composeArgs|run-compose\.sh|run-operator-compose\.sh)\b.{0,320}\b(?:down|rm|stop|kill)\b/;
  if (composeMutation.test(text) || composeWrapperMutation.test(text)) {
    classes.add('compose_container');
    if (/\bdown\b/.test(text)) classes.add('compose_network');
    if (/\bdown\b.{0,100}(?:(?:\s|['"],?\s*)-v\b|--volumes\b)/.test(text)) {
      classes.add('compose_volume');
    }
  }
  if (matches(text, [
    new RegExp(String.raw`\b${engine}\s+network\s+rm\b`),
    new RegExp(String.raw`${quote}${engine}${quote}\s*,\s*${quote}network${quote}\s*,\s*${quote}rm${quote}`),
  ]) || dockerApiDeletes(text, 'networks')) classes.add('compose_network');
  if (matches(text, [
    new RegExp(String.raw`\b${engine}\s+volume\s+rm\b`),
    new RegExp(String.raw`${quote}${engine}${quote}\s*,\s*${quote}volume${quote}\s*,\s*${quote}rm${quote}`),
  ]) || dockerApiDeletes(text, 'volumes')) classes.add('compose_volume');
  if (matches(text, [
    new RegExp(String.raw`\b${engine}\s+(?:image\s+rm|rmi)\b`),
    new RegExp(String.raw`${quote}${engine}${quote}\s*,\s*${quote}(?:image${quote}\s*,\s*${quote}rm|rmi)${quote}`),
  ]) || dockerApiDeletes(text, 'images')) classes.add('oci_image');
  if (/\b(?:docker|podman)\s+(?:builder|buildx)\s+prune\b|\bbuildctl\b.{0,80}\bprune\b/.test(text)) {
    classes.add('buildkit_cache');
  }
  if (/\b(?:docker|podman)\s+(?:builder|buildx)\s+rm\b/.test(text)) {
    classes.add('buildkit_cache');
  }
  if (/cleanup-docker-resources\.sh\b/.test(text)
      && /--(?:project|prefix|runner-leftovers)\b/.test(text)) {
    classes.add('compose_container');
    classes.add('compose_network');
    if (!/--runner-leftovers\b/.test(text) || /--(?:project|prefix)\b/.test(text)) {
      classes.add('compose_volume');
    }
  }
  if (/cleanup-ci-callsite\.sh\b.{0,80}\brun\b/.test(text)) {
    classes.add('compose_container');
    classes.add('compose_network');
    classes.add('compose_volume');
  }
  return [...classes].sort();
}

function dockerCreationClasses(text) {
  const classes = new Set();
  const engine = String.raw`(?:docker|podman)`;
  const compose = String.raw`${engine}\s+compose`;
  const composeWrapper = String.raw`(?:run_project_compose|compose_output|runCompose|COMPOSE_COMMAND|composeArgs|run-compose\.sh|run-operator-compose\.sh)`;
  if (matches(text, [
    new RegExp(String.raw`\b${engine}\s+(?:container\s+)?create\b`),
    new RegExp(String.raw`\b${engine}\s+run\b`),
    new RegExp(String.raw`["']${engine}["']\s*,\s*["'](?:container["']\s*,\s*["'])?create["']`),
    new RegExp(String.raw`["']${engine}["']\s*,\s*["']run["']`),
    DOCKER_HELPER_RUN,
    PREFIX_CONTAINER_RUN,
    /\bcreate\s+--rm\s+--cidfile\b/,
    SHELL_CONTAINER_ARRAY,
    /\/containers\/create\b/,
  ])) classes.add('compose_container');
  const composeCreate = new RegExp(String.raw`\b(?:${compose}|${composeWrapper})\b.{0,320}\b(?:up|create)\b`);
  if (!/\b(?:up|create)\s+--help\b/.test(text) && composeCreate.test(text)) {
    classes.add('compose_container');
    classes.add('compose_network');
    classes.add('compose_volume');
  }
  const composeRun = new RegExp(String.raw`\b(?:${compose}|${composeWrapper})\b.{0,320}\brun\b`);
  if (composeRun.test(text)) {
    classes.add('compose_container');
    classes.add('compose_network');
    classes.add('compose_volume');
  }
  if (matches(text, [
    new RegExp(String.raw`\b${engine}\s+network\s+create\b`),
    new RegExp(String.raw`["']${engine}["']\s*,\s*["']network["']\s*,\s*["']create["']`),
    /\/(?:v\d+(?:\.\d+)*\/)?networks\/create\b/,
  ])) classes.add('compose_network');
  if (matches(text, [
    new RegExp(String.raw`\b${engine}\s+volume\s+create\b`),
    new RegExp(String.raw`["']${engine}["']\s*,\s*["']volume["']\s*,\s*["']create["']`),
    /\/(?:v\d+(?:\.\d+)*\/)?volumes\/create\b/,
  ])) classes.add('compose_volume');
  const buildsImage = matches(text, [
    new RegExp(String.raw`\b${engine}\s+(?:(?:buildx|builder)\s+)?build\b`),
    new RegExp(String.raw`\b(?:${compose}|${composeWrapper})\b.{0,320}\bbuild\b`),
    new RegExp(String.raw`["']${engine}["']\s*,\s*["'](?:(?:buildx|builder)["']\s*,\s*["'])?build["']`),
    new RegExp("\\/v\\d+(?:\\.\\d+)*\\/build(?:\\?|[\"']|\\x60|$)"),
  ]);
  const loadsImage = matches(text, [
    new RegExp(String.raw`\b${engine}\s+(?:image\s+)?load\b`),
    new RegExp(String.raw`["']${engine}["']\s*,\s*["'](?:image["']\s*,\s*["'])?load["']`),
    /\/(?:v\d+(?:\.\d+)*\/)?images\/(?:create|load)\b/,
  ]);
  if (buildsImage || loadsImage) classes.add('oci_image');
  if (buildsImage || /\b(?:docker|podman)\s+(?:builder|buildx)\s+create\b/.test(text)) {
    classes.add('buildkit_cache');
  }
  return [...classes].sort();
}

function hasCreationRegistration(statements, resourceClass) {
  const registered = statements.some((line) => new RegExp(
    String.raw`\bregister_owned_resource\s+${resourceClass}\b`,
  ).test(line));
  if (!registered) return false;
  if (resourceClass === 'oci_image') {
    return statements.some((line) => /\b(?:ownership_label_args|recover_[a-z_]*image|image_reference_is_absent|recover_and_register_loaded_archive|verify_loaded_images|register_loaded_images)\b/.test(line));
  }
  return statements.some((line) => /\b(?:ownership_label_args|recover_exact_created|ownedCreationListArgs)\b/.test(line));
}

function hasSelfCoordinatorBoundary(relativePath, source) {
  if (!SELF_COORDINATED_PRODUCER_PATHS.has(relativePath)) return false;
  if (relativePath === 'scripts/run-integration-tests.sh') {
    return /if \[ "\$\{SANCTUARY_CLEANUP_COORDINATED:-0\}" != 1 \]; then[\s\S]*?exec "\$PROJECT_ROOT\/scripts\/ci\/cleanup-ci-callsite\.sh"/.test(source);
  }
  const statements = executableStatements(source);
  const hasShellGuard = shellCoordinatorGuardIndex(source) >= 0;
  const hasJavaScriptGuard = /const\s+coordinatedCleanup\s*=\s*process\.env\.SANCTUARY_CLEANUP_COORDINATED\s*===\s*["']1["'];[\s\S]*?if\s*\(\s*!coordinatedCleanup\b[\s\S]*?throw new Error\(/.test(source);
  const boundary = statements.findIndex((line) => (
    (/cleanup-ci-callsite\.sh\b.{0,320}\b(?:run|auto-run)\b/.test(line)
      && !/(?:&&|\|\|)[^;]*cleanup-ci-callsite\.sh\b/.test(line))
    || /\binstall_e2e_cleanup_auto_run\b/.test(line)
    || (hasShellGuard
      && /(?:\[|\[\[)[^\]]*SANCTUARY_CLEANUP_COORDINATED[^\]]*(?:!=|==|=)[^\]]*["']?1\b/.test(line))
    || (hasJavaScriptGuard && /process\.env\.SANCTUARY_CLEANUP_COORDINATED/.test(line))
  ));
  if (boundary < 0) return false;
  const firstCreation = statements.findIndex((line) => (
    !/cleanup-ci-callsite\.sh\b/.test(line) && dockerCreationClasses(line).length > 0
  ));
  return firstCreation < 0 || boundary < firstCreation;
}

function hasCoordinatedComponentBoundary(relativePath, source) {
  if (!COORDINATED_COMPONENT_PATHS.has(relativePath)) return false;
  if (relativePath.startsWith('scripts/perf/phase3-compose/')) {
    return /\brunCompose\b/.test(source) && !/\b(?:docker|podman)\s+compose\b/.test(source);
  }
  const boundary = shellCoordinatorGuardIndex(source);
  if (boundary < 0) return false;
  const persistentCreation = source.search(
    /\b(?:docker|podman)\s+(?:(?:container\s+)?create\b|run\b.{0,320}(?:\s-d(?:\s|$)|--detach\b))/,
  );
  return persistentCreation < 0 || boundary < persistentCreation;
}

function hasRegisteredTransientCreation(relativePath, statements, resourceClass) {
  if (resourceClass !== 'compose_container'
      || !REGISTERED_TRANSIENT_PRODUCER_PATHS.has(relativePath)) return false;
  const stamps = statements.some((line) => (
    /\bownership_label_args\s+compose_container\s+exact_delete\b/.test(line)
  ));
  const recovers = statements.some((line) => /\brecover_exact_created_container\b/.test(line));
  const reinspects = statements.some((line) => (
    /\b(?:assert_registered_transient|assert_launched_migration|inspect_control_helper)\b/.test(line)
  ));
  const retires = statements.some((line) => (
    /\b(?:retire_registered_transient|retire_migration_container|retire_control_helper)\b/.test(line)
  ));
  const source = statements.join('\n');
  const registers = statements.some((line) => (
    /\b(?:register_owned_resource\s+compose_container|register_transient_container)\b/.test(line)
  ));
  const creationUsesOwnershipLabels = rawContainerProducerStatements(statements).every((line) => (
    /\b(?:OWNERSHIP_LABEL_ARGS|container_ownership_labels|trezor_create_args)\b/.test(line)
  ));
  const creationCount = containerCreationCount(source);
  return stamps && recovers && reinspects && retires && registers && creationUsesOwnershipLabels
    && creationCount === REGISTERED_TRANSIENT_CREATION_COUNTS.get(relativePath);
}

function hasRegisteredImageCreation(relativePath, statements, resourceClass, source) {
  const expectedCount = REGISTERED_IMAGE_CREATION_COUNTS.get(relativePath);
  if (resourceClass !== 'oci_image' || expectedCount === undefined) return false;
  const exactMechanism = hasCreationRegistration(statements, resourceClass)
    || /\b(?:register_exact_built_image|register_loaded_image|recover_and_register_loaded_archive|register_loaded_images)\b/.test(source);
  return exactMechanism && imageCreationCount(statements.join('\n')) === expectedCount;
}

function registeredReplayContainerCreation(relativePath, source) {
  return relativePath === 'scripts/perf/wallet-sync-high-fanout-replay.mjs'
    && /\bcreateRegisteredReplayResource\b/.test(source)
    && /\binspectCreatedIdentity\b|\bcreateReplayResource\b/.test(source)
    && !directlyInvokesContainerProducer(source);
}

function rawContainerProducerStatements(statements) {
  return statements.filter((line) => (
    DIRECT_CONTAINER_RUN.test(line) || DIRECT_CONTAINER_CREATE.test(line)
      || ARGV_CONTAINER_RUN.test(line)
      || DOCKER_HELPER_RUN.test(line) || PREFIX_CONTAINER_RUN.test(line)
      || SHELL_CONTAINER_ARRAY.test(line)
  ));
}

function coordinatorCreationIsScoped(relativePath, statements, resourceClass, source) {
  if (resourceClass === 'compose_container') {
    const producers = rawContainerProducerStatements(statements);
    if (producers.length === 0 || explicitlyForegroundDaemonAtomic(statements)
        || hasRegisteredTransientCreation(relativePath, statements, resourceClass)) return true;
    return producers.every((line) => /\$\{?(?:OWNERSHIP_LABEL_ARGS|container_ownership_labels|container_labels)\[?@?\]?/.test(line));
  }
  if (resourceClass === 'oci_image') {
    return imageCreationCount(statements.join('\n')) === 0
      || hasRegisteredImageCreation(relativePath, statements, resourceClass, source);
  }
  if (['compose_network', 'compose_volume'].includes(resourceClass)) {
    const command = resourceClass === 'compose_network' ? 'network' : 'volume';
    const directCreate = new RegExp(`\\b(?:docker|podman)\\s+${command}\\s+create\\b`);
    const argvCreate = new RegExp(`["'](?:docker|podman)["']\\s*,\\s*["']${command}["']\\s*,\\s*["']create["']`);
    return !statements.some((line) => (
      directCreate.test(line) || argvCreate.test(line)
    ));
  }
  return true;
}

function hasTorApplicationBoundary(source, resourceClass) {
  if (resourceClass === 'compose_container') {
    return /currentTorOwnership/.test(source) && /inspectHasCreatedIdentity/.test(source);
  }
  return resourceClass === 'oci_image'
    && /currentTorOwnership/.test(source) && /drainDockerPull/.test(source)
    && /TOR_DIGEST/.test(source);
}

function specializedApplicationBoundary(relativePath, source, resourceClass) {
  const contracts = {
    'scripts/ops/run-grafana-password-migration.sh': resourceClass === 'compose_volume'
      && /ownership_label_args\s+compose_volume\s+preserve_ambiguous/.test(source)
      && /stable_compose_volume_identity/.test(source),
    'server/src/utils/docker/tor.ts': hasTorApplicationBoundary(source, resourceClass),
    'scripts/setup.sh': /ownership\/deployment-lifecycle\.sh/.test(source)
      && /ownership_(?:initialize|refresh)_build_identity/.test(source),
    'start.sh': /ownership\/deployment-lifecycle\.sh/.test(source)
      && /ownership_(?:initialize|refresh)_build_identity/.test(source),
    'scripts/ownership/run-operator-compose.sh': /deployment_use_active/.test(source)
      && /Destructive operator Compose commands require an exact active deployment manifest/.test(source)
      && /--confirm-data-delete/.test(source),
    'uninstall.sh': /run-operator-compose\.sh/.test(source)
      && /Type 'DELETE' to confirm complete uninstallation/.test(source)
      && /--confirm-data-delete/.test(source),
  };
  return contracts[relativePath];
}

function hasApplicationLifecycleBoundary(relativePath, source, resourceClass) {
  if (!APPLICATION_LIFECYCLE_PATHS.has(relativePath)) return false;
  const specialized = specializedApplicationBoundary(relativePath, source, resourceClass);
  return specialized ?? /run-operator-compose\.sh/.test(source);
}

function hasRunComposeCoordinatorBoundary(source, statements) {
  const dispatch = source.search(/case\s+"\$\(compose_subcommand\s+"\$@"\)"\s+in/);
  const fallback = source.search(/\n\s*\*\)\s*\n/);
  const boundary = source.search(RUN_COMPOSE_COORDINATOR_GUARD);
  const composeExec = source.search(/\bexec\s+docker\s+compose\s+"\$@"/);
  if (dispatch < 0 || fallback < dispatch || boundary < fallback || composeExec < boundary) return false;
  return !statements.some(isUncoordinatedRunComposeMutation);
}

function isUncoordinatedRunComposeMutation(line) {
  return dockerClasses(line).length > 0
    && !/\bexec\s+docker\s+compose\s+"\$@"/.test(line);
}

function coordinatorCreationMechanism(relativePath, statements, resourceClass, source) {
  if (hasSelfCoordinatorBoundary(relativePath, source)
      && coordinatorCreationIsScoped(relativePath, statements, resourceClass, source)) {
    return true;
  }
  return hasCoordinatedComponentBoundary(relativePath, source);
}

function hasRegisteredOtherResourceCreation(relativePath, statements, resourceClass, source) {
  if (!REGISTERED_PRODUCER_PATHS.has(relativePath)) return false;
  if (['compose_container', 'oci_image'].includes(resourceClass)) return false;
  return hasCreationRegistration(statements, resourceClass)
    || /\b(?:register_exact_built_image|register_loaded_image|registerActiveResource|createRegisteredReplayResource)\b/.test(source);
}

function recognizedCreationMechanism(relativePath, statements, resourceClass, source) {
  if (coordinatorCreationMechanism(relativePath, statements, resourceClass, source)) {
    return 'cleanup_coordinator';
  }
  if (hasRegisteredTransientCreation(relativePath, statements, resourceClass)) {
    return 'registered_transient';
  }
  if (resourceClass === 'compose_container'
      && registeredReplayContainerCreation(relativePath, source)) return 'registered_exact';
  if (hasRegisteredImageCreation(relativePath, statements, resourceClass, source)) {
    return 'registered_exact';
  }
  if (hasRegisteredOtherResourceCreation(relativePath, statements, resourceClass, source)) {
    return 'registered_exact';
  }
  if (RETAINED_APPLICATION_PRODUCER_PATHS.has(relativePath)) return 'retained_application';
  if (hasApplicationLifecycleBoundary(relativePath, source, resourceClass)) return 'application_api';
  if (PUBLIC_COMMAND_DOCS.has(relativePath)
      && statements.some((line) => /run-operator-compose\.sh\b/.test(line))) return 'application_api';
  return null;
}

function creationMechanismFor(relativePath, statements, resourceClass, source) {
  if (resourceClass === 'buildkit_cache') {
    return RETAINED_SHARED_CACHE_PATHS.has(relativePath)
      && !/\b(?:docker|podman)\s+(?:builder|buildx)\s+(?:create|rm|prune)\b/.test(source)
      ? 'retained_shared_cache' : 'producer';
  }
  const recognized = recognizedCreationMechanism(relativePath, statements, resourceClass, source);
  if (recognized) return recognized;
  if (resourceClass === 'compose_container'
      && explicitlyForegroundDaemonAtomic(statements)) {
    return 'daemon_atomic';
  }
  if (/^(?:docker-compose\.yml|docker\/compose\/[^/]+\.yml)$/.test(relativePath)
      && statements.some((line) => /io\.sanctuary\.(?:deployment|run|lifecycle)/.test(line))) {
    return 'ownership_manifest';
  }
  return 'producer';
}

function broadPrunes(text) {
  const patterns = [
    ['system_prune', /\b(?:docker|podman)\s+system\s+prune\b/],
    ['builder_prune', /\b(?:docker|podman)\s+(?:builder|buildx)\s+prune\b|\bbuildctl\b.{0,80}\bprune\b/],
    ['resource_prune', /\b(?:docker|podman)\s+(?:image|container|network|volume)\s+prune\b/],
    ['age_filtered_delete', /\b(?:docker|podman)\s+(?:(?:container|image|network|volume)\s+)?(?:rm|rmi)\b.*--filter(?:=|\s+)["']?(?:until|before|since)=|--filter(?:=|\s+)["']?(?:until|before|since)=.*\b(?:docker|podman)\s+(?:(?:container|image|network|volume)\s+)?(?:rm|rmi)\b/],
  ];
  const kinds = patterns.filter(([, expression]) => expression.test(text)).map(([kind]) => kind);
  const hasDelete = /\b(?:docker|podman)\s+(?:(?:container|image|network|volume)\s+)?(?:rm|rmi)\b/.test(text);
  if (hasDelete) {
    const selectors = [...text.matchAll(/--filter(?:=|\s+)["']?name=([^"'\s)]+)/g)];
    if (selectors.some((match) => !(match[1].startsWith('^') && match[1].endsWith('$')))) {
      kinds.push('name_prefix_delete');
    }
  }
  return kinds;
}

function hasRegisteredTransientLifecycle(statements) {
  const stampsExactOwnership = statements.some((line) => (
    /\bownership_label_args\s+compose_container\s+exact_delete\b/.test(line)
  ));
  const retiresAndReinspects = statements.some((line) => /\bretire_(?:control_helper|migration_container)\b/.test(line))
    && statements.some((line) => /\binspect_(?:control_helper|migration_container)\b/.test(line))
    && statements.some((line) => /\bcontainer_(?:id_)?is_absent\b/.test(line));
  return stampsExactOwnership && retiresAndReinspects;
}

function hasRegisteredExactVolumeLifecycle(statements) {
  return statements.some((line) => /\bregister_owned_resource\s+compose_volume\b/.test(line))
    && statements.some((line) => /\bdocker\s+volume\s+rm\s+["']?\$\{?cache_volume/.test(line))
    && statements.some((line) => /\bdocker\s+volume\s+inspect\s+["']?\$\{?cache_volume/.test(line));
}

function directMutationStatements(statements, resourceClass) {
  return statements.filter((line) => {
    if (/cleanup-ci-callsite\.sh\b/.test(line)) return false;
    if (/\b(?:(?:docker|podman)(?:\s+compose|-compose)?|COMPOSE_COMMAND)\b.{0,160}\brun\b.{0,160}--rm\b/.test(line)
        && !/\b(?:docker|podman)(?:\s+compose|-compose)?\s+(?:down|stop|kill|rm|network\s+rm|volume\s+rm|image\s+rm|rmi)\b/.test(line)) return false;
    return dockerClasses(line).includes(resourceClass);
  });
}

function mutationsUseExactIdentity(mutations, expression) {
  return mutations.every((line) => expression.test(line));
}

function hasAllStatementMarkers(statements, markers) {
  return markers.every((marker) => statements.some((line) => line.includes(marker)));
}

function hasRegisteredRuntimeImageMutation(relativePath, statements, resourceClass, mutations) {
  return relativePath === 'scripts/ci/build-runtime-image.sh'
    && resourceClass === 'oci_image'
    && hasAllStatementMarkers(statements, [
      'register_exact_built_image', 'recover_exact_runtime_image',
      'retire_exact_runtime_reference', 'prove_shared_image_survived',
    ])
    && mutationsUseExactIdentity(mutations, /\$(?:\{)?image_ref\b/);
}

function hasRegisteredProducerHookMutation(relativePath, statements, resourceClass, mutations) {
  return relativePath === 'scripts/ownership/compose-image-registration.sh'
    && resourceClass === 'oci_image'
    && hasAllStatementMarkers(statements, [
      'ownership_image_id_from_inspect', 'ownership_bounded_image_inspect',
      'ownership_bounded_image_list', 'ownership_bounded_image_remove',
      'ownership_timeout_window_before_deadline', 'wait_for_ci_compose_image_refs',
      'register_exact_built_image', 'retire_exact_built_image',
    ])
    && mutationsUseExactIdentity(
      mutations,
      /\btimeout\b.{0,120}\bdocker\s+image\s+rm\s+["']?\$(?:\{)?image_ref\b/,
    );
}

function hasRegisteredReplayCleanup(relativePath, statements, resourceClass, mutations) {
  return relativePath === 'scripts/perf/wallet-sync-replay-cleanup.mjs'
    && ['compose_container', 'compose_network'].includes(resourceClass)
    && hasAllStatementMarkers(statements, ['inspectCleanupIdentity', 'removeCleanupResource'])
    && mutationsUseExactIdentity(mutations, /\bresource\.immutableIdentity\b/);
}

function hasRegisteredHighFanoutCleanup(relativePath, statements, resourceClass, mutations) {
  return relativePath === 'scripts/perf/wallet-sync-high-fanout-replay.mjs'
    && resourceClass === 'compose_container'
    && hasAllStatementMarkers(statements, ['registerActiveResource'])
    && mutationsUseExactIdentity(mutations, /\bactiveResourceIdentity\b/);
}

function isRegisteredTransientProducerStatement(line) {
  return /\bdocker\s+run\b.{0,160}--rm\b.{0,160}--detach\b|\bdocker\s+run\b.{0,160}--detach\b.{0,160}--rm\b/.test(line)
    || /\bdocker\s+create\b.{0,160}--rm\b/.test(line)
    || /\bcreate\s+--rm\s+--cidfile\b/.test(line)
    || /\b\w+_run_args=\(run\s+--rm\s+(?:-d|--detach)\b/.test(line);
}

function hasRegisteredTransientMutation(statements, resourceClass, mutations) {
  if (resourceClass !== 'compose_container') return false;
  const registeredRetirement = statements.some((line) => /\bretire_registered_transient\b/.test(line))
    && statements.some(isRegisteredTransientProducerStatement)
    && mutationsUseExactIdentity(mutations,
      /\$(?:\{)?(?:container_id|exact_id|VERIFY_PSBT_CORE_CONTAINER_ID|REGENERATE_PSBT_CORE_CONTAINER_ID)\b/);
  const specializedRetirement = hasRegisteredTransientLifecycle(statements)
    && mutationsUseExactIdentity(mutations,
      /\$(?:\{)?(?:helper_id|expected_id)\b|\bcompose_output\s+stop\s+grafana\b/);
  return registeredRetirement || specializedRetirement;
}

function hasRegisteredExactImageIdMutation(statements, resourceClass, mutations) {
  if (resourceClass !== 'oci_image') return false;
  const hasRegistration = statements.some((line) => (
    /\bregister_owned_resource\s+oci_image\b/.test(line)
  ));
  const removesExactId = statements.some((line) => (
    /\bdocker\s+image\s+rm\s+["']?\$\{?cleanup_image_id/.test(line)
  ));
  const directlyInspectsId = statements.some((line) => (
    /\bdocker\s+image\s+inspect\s+["']?\$\{?cleanup_image_id/.test(line)
  ));
  const provesIdAbsent = hasAllStatementMarkers(statements, ['image_id_is_absent'])
    && statements.some((line) => /\bdocker\s+image\s+inspect\s+["']?\$\{?exact_id/.test(line))
    && statements.some((line) => /\bdocker\s+image\s+ls\s+--no-trunc\b/.test(line));
  return hasRegistration && removesExactId && (directlyInspectsId || provesIdAbsent)
    && mutationsUseExactIdentity(mutations, /\$(?:\{)?cleanup_image_id\b/);
}

function hasRegisteredExactImageReferenceMutation(statements, resourceClass, mutations) {
  if (resourceClass !== 'oci_image') return false;
  const registersReferenceAndId = statements.some((line) => (
    /\bregister_owned_resource\s+oci_image\b/.test(line)
      && /\$(?:\{)?python_image\b/.test(line)
      && /\$(?:\{)?(?:cleanup_image_id|python_image_id)\b/.test(line)
  ));
  const requiredProofs = [
    /\bdocker\s+image\s+rm\s+["']?\$(?:\{)?python_image\b/,
    /\bimage_reference_is_absent\s+["']?\$(?:\{)?python_image\b.{0,80}\$(?:\{)?cleanup_image_id\b/,
    /\bdocker\s+image\s+inspect\b.{0,120}\$(?:\{)?exact_reference\b/,
    /\bdocker\s+image\s+ls\s+--no-trunc\s+--filter\b.{0,120}reference=\$(?:\{)?exact_reference\b/,
  ];
  return registersReferenceAndId
    && requiredProofs.every((proof) => statements.some((line) => proof.test(line)))
    && mutationsUseExactIdentity(mutations, /\$(?:\{)?python_image\b/);
}

function isApplicationMutationBoundary(relativePath, source, resourceClass) {
  const publicOperatorCommand = PUBLIC_COMMAND_DOCS.has(relativePath)
    && /run-operator-compose\.sh/.test(source);
  return publicOperatorCommand
    || hasApplicationLifecycleBoundary(relativePath, source, resourceClass)
    || hasCoordinatedComponentBoundary(relativePath, source);
}

function mechanismFor(relativePath, statements, resourceClass, source) {
  if (relativePath === 'scripts/ownership/cleanup-docker-executor.mjs') return 'canonical_executor';
  if (relativePath === 'scripts/ownership/operator-recovery-cli.mjs'
      && source.includes('executePreparedOperatorRecovery')) return 'cleanup_coordinator';
  if (relativePath === 'scripts/ownership/run-compose.sh'
      && hasRunComposeCoordinatorBoundary(source, statements)) {
    return 'cleanup_coordinator';
  }
  const mutationStatements = directMutationStatements(statements, resourceClass);
  if (hasRegisteredRuntimeImageMutation(
    relativePath, statements, resourceClass, mutationStatements,
  )) {
    return 'registered_exact';
  }
  if (hasRegisteredProducerHookMutation(
    relativePath, statements, resourceClass, mutationStatements,
  )) {
    return 'registered_exact';
  }
  if (hasRegisteredReplayCleanup(relativePath, statements, resourceClass, mutationStatements)) {
    return 'registered_exact';
  }
  if (hasRegisteredHighFanoutCleanup(
    relativePath, statements, resourceClass, mutationStatements,
  )) {
    return 'registered_exact';
  }
  if (relativePath === 'server/src/utils/docker/tor.ts'
      && hasApplicationLifecycleBoundary(relativePath, source, resourceClass)) return 'application_api';
  if (['scripts/ownership/run-operator-compose.sh', 'uninstall.sh'].includes(relativePath)
      && hasApplicationLifecycleBoundary(relativePath, source, resourceClass)) {
    return 'application_api';
  }
  const coordinator = hasSelfCoordinatorBoundary(relativePath, source)
    || statements.some((line) => /cleanup-ci-callsite\.sh\b.{0,80}\b(?:run|auto-run)\b/.test(line));
  const registeredTransient = hasRegisteredTransientMutation(
    statements, resourceClass, mutationStatements,
  );
  const registeredExactImageId = hasRegisteredExactImageIdMutation(
    statements, resourceClass, mutationStatements,
  );
  const registeredExactImageReference = hasRegisteredExactImageReferenceMutation(
    statements, resourceClass, mutationStatements,
  );
  if (registeredTransient) return 'registered_transient';
  if (registeredExactImageId || registeredExactImageReference) return 'registered_exact';
  if (resourceClass === 'compose_volume' && hasRegisteredExactVolumeLifecycle(statements)
      && mutationsUseExactIdentity(mutationStatements, /\$(?:\{)?cache_volume\b/)) {
      return 'registered_exact';
  }
  if (mutationStatements.length > 0 && hasSelfCoordinatorBoundary(relativePath, source)) {
    return 'cleanup_coordinator';
  }
  if (mutationStatements.length > 0
      && isApplicationMutationBoundary(relativePath, source, resourceClass)) {
    return 'application_api';
  }
  if (mutationStatements.length > 0) return 'direct';
  if (coordinator) return 'cleanup_coordinator';
  const daemonAtomicContainer = resourceClass === 'compose_container'
    && explicitlyForegroundDaemonAtomic(statements)
    && !statements.some((line) => /\bdocker\s+(?:container\s+)?(?:rm|stop|kill)\b/.test(line));
  if (daemonAtomicContainer) return 'daemon_atomic';
  return 'direct';
}

function addClasses(target, resourceClasses) {
  resourceClasses.forEach((resourceClass) => target.add(resourceClass));
}

function cleanupClassesFor(relativePath, source, statements) {
  const classes = new Set(statements.flatMap(dockerClasses));
  addClasses(classes, dockerApiCleanupClasses(statements.join(' ')));
  if (relativePath === 'scripts/ownership/cleanup-docker-executor.mjs'
      && source.includes('export function buildDockerMutation')) {
    addClasses(classes, ['compose_container', 'compose_network', 'compose_volume', 'oci_image']);
  }
  if (relativePath === 'scripts/ownership/operator-recovery-cli.mjs'
      && source.includes('executePreparedOperatorRecovery')) {
    addClasses(classes, ['compose_container', 'compose_network', 'compose_volume']);
  }
  if (relativePath === 'scripts/ownership/run-compose.sh'
      && statements.some((line) => /\bdocker\s+compose\b/.test(line))) {
    addClasses(classes, ['compose_container', 'compose_network', 'compose_volume']);
  }
  if (['scripts/ownership/run-operator-compose.sh', 'uninstall.sh'].includes(relativePath)
      && hasApplicationLifecycleBoundary(relativePath, source, 'compose_container')) {
    addClasses(classes, ['compose_container', 'compose_network', 'compose_volume']);
  }
  return classes;
}

function addComposeManifestCreationClasses(relativePath, source, classes) {
  if (!/^(?:docker-compose\.yml|docker\/compose\/[^/]+\.yml)$/.test(relativePath)
      || !/io\.sanctuary\.(?:deployment-id|creation-run-id)/.test(source)) return;
  for (const resourceClass of ['compose_container', 'compose_network', 'compose_volume']) {
    const marker = new RegExp(`io\\.sanctuary\\.resource-class["']?\\s*[:=]\\s*["']?${resourceClass}\\b`);
    if (marker.test(source)) classes.add(resourceClass);
  }
}

function creationClassesFor(relativePath, source, statements) {
  const classes = new Set([
    ...statements.flatMap(dockerCreationClasses),
    ...dockerCreationClasses(statements.join('\n')),
  ]);
  if (relativePath === 'scripts/ownership/run-operator-compose.sh'
      && hasApplicationLifecycleBoundary(relativePath, source, 'compose_container')) {
    addClasses(classes, ['buildkit_cache', 'compose_container', 'compose_network', 'compose_volume', 'oci_image']);
  }
  addComposeManifestCreationClasses(relativePath, source, classes);
  return classes;
}

function hasRecursivePathDeletion(text) {
  return /\brm\s+(?:--[^\s]*recursive\b|-[A-Za-z]*[rR][A-Za-z]*\b)/.test(text)
    || hasJavaScriptRecursivePathDeletion(text)
    || /\bfind\s+[^\n;]{0,320}(?:-delete\b|-exec\s+rm\s+(?:--[^\s]*recursive|-[A-Za-z]*[rR][A-Za-z]*))/.test(text);
}

function hasJavaScriptRecursivePathDeletion(text) {
  return /\b(?:rmSync|rm|fs\.rmSync|fs\.rm)\s*\([^)]{0,320}\brecursive\s*:\s*true/.test(text);
}

function isContainerInternalPathDeletion(line) {
  return /\bdocker\s+(?:run|exec)\b/.test(line)
    && /\bfind\s+\/(?:dst|app|tmp)\//.test(line);
}

function processSignalStatements(statements) {
  return statements.filter((line) => (
    /(?:^|[;&|]\s*|\b(?:if|then|while|until)\s+!?\s*)kill\s+/.test(line)
      || /(?:^|[;&|]\s*)pkill\s+/.test(line)
      || /\b[A-Za-z_$][\w$]*\.kill\s*\(/.test(line)
  ));
}

function isSignalObservation(line) {
  return /\bkill\s+-0(?:\s|$)/.test(line)
    || /\b[A-Za-z_$][\w$]*\.kill\s*\([^,()]+,\s*0\s*\)/.test(line);
}

function hasWorktreeCommand(text, command) {
  const shell = new RegExp(String.raw`\bgit\b[^\n;]{0,240}\bworktree\s+${command}\b`);
  const argv = new RegExp(
    String.raw`["']git["'][^\n;]{0,240}["']worktree["'][^\n;]{0,120}["']${command}["']`,
  );
  return shell.test(text) || argv.test(text);
}

function hasCanonicalHostInternalProof(relativePath, source) {
  if (!CANONICAL_HOST_INTERNAL_PATHS.has(relativePath)) return false;
  if (relativePath === 'scripts/ownership/registration.mjs') {
    return /\.keys-\$\{process\.pid\}/.test(source)
      && /renameSync\(staging, keys\)/.test(source)
      && /rmSync\(staging,\s*\{\s*recursive:\s*true/.test(source);
  }
  const ownsProcessIdentity = /\bspawn\s*\(|\bprocess\.pid\b|\bkill\s+[^\n]*"\$\$"/.test(source);
  return ownsProcessIdentity && processSignalStatements(executableStatements(source)).length > 0;
}

function orderedRegistrationShape(source, patterns) {
  let offset = 0;
  for (const pattern of patterns) {
    const match = pattern.exec(source.slice(offset));
    if (!match) return false;
    offset += match.index + match[0].length;
  }
  return true;
}

function exposesBeforeRegistration(source, start, registration, handlePattern) {
  const startMatch = start.exec(source);
  if (!startMatch) return true;
  const registrationMatch = registration.exec(source.slice(startMatch.index + startMatch[0].length));
  if (!registrationMatch) return true;
  const between = source.slice(
    startMatch.index + startMatch[0].length,
    startMatch.index + startMatch[0].length + registrationMatch.index,
  );
  return between.split('\n').some((line) => (
    /\b(?:printf|echo)\b/.test(line) && handlePattern.test(line)
  ));
}

function textBeforeRegistration(source, start, registration) {
  const startMatch = start.exec(source);
  if (!startMatch) return null;
  const registrationMatch = registration.exec(source.slice(startMatch.index + startMatch[0].length));
  if (!registrationMatch) return null;
  return source.slice(
    startMatch.index + startMatch[0].length,
    startMatch.index + startMatch[0].length + registrationMatch.index,
  );
}

function hasRegisteredStagingProof(relativePath, source) {
  if (relativePath !== 'scripts/ci/create-registered-staging.sh') return false;
  const creation = /artifact=\$\(mktemp -d "\$parent\/\$label\.XXXXXX"\) \|\| return/;
  return orderedRegistrationShape(source, [
      /ownership_initialize/,
      /describe-host-authority\.mjs"\s+\\?\s*temporary "\$parent" "\$SANCTUARY_OPERATION_RUN_ID"\) \|\| return/,
      /execution_authority=\$\(printf '%s' "\$authority_bundle" \| jq -c '\.executionAuthority'\) \|\| return/,
      /identity=\$\(printf '%s' "\$authority_bundle" \| jq -r '\.immutableIdentity'\) \|\| return/,
      /register_owned_resource temporary_artifact obsolete exact_delete path\s+\\?\s*"\$parent" "\$identity" --execution-authority "\$execution_authority"\s+\\?\s*"\$SANCTUARY_OPERATION_RUN_ID" \|\| return/,
      creation,
      /printf '%s\\n' "\$artifact"/,
    ]);
}

function hasRegisteredCollectorProof(relativePath, source) {
  if (relativePath !== 'scripts/ci/registered-collector-process.sh') return false;
  const observation = /write_marker "\$heartbeat" heartbeat \|\| return/;
  const registration = /register_owned_resource collector_process obsolete exact_delete authority/;
  return !exposesBeforeRegistration(source, observation, registration, /\$(?:pid|heartbeat|terminal)\b/)
    && orderedRegistrationShape(source, [
      observation,
      /ownership_initialize/,
      /describe-host-authority\.mjs"\s+\\?\s*collector "\$pid" "\$script" "\$heartbeat" "\$terminal"\) \|\| return/,
      /execution_authority=\$\(printf '%s' "\$authority_bundle" \| jq -c '\.executionAuthority'\) \|\| return/,
      /identity=\$\(printf '%s' "\$authority_bundle" \| jq -r '\.immutableIdentity'\) \|\| return/,
      /register_owned_resource collector_process obsolete exact_delete authority\s+\\?\s*"\$pid" "\$identity" --execution-authority "\$execution_authority"\s+\\?\s*"\$SANCTUARY_OPERATION_RUN_ID" \|\| return/,
      /printf '%s\\t%s\\n' "\$heartbeat" "\$terminal"/,
    ]);
}

function hasRegisteredIsolatedWorkspaceProof(relativePath, source) {
  if (relativePath !== 'scripts/ci/create-isolated-workspace.sh') return false;
  const creation = /workdir="\$\(mktemp -d "\$parent\/\$\(safe_label "\$label"\)\.XXXXXX"\)"/;
  const registration = /register_owned_resource temporary_artifact active exact_delete path "\$workdir" "\$path_identity"/;
  const between = textBeforeRegistration(source, creation, registration);
  if (between === null || between.split('\n').some((line) => (
    /\$workdir\b/.test(line)
      && !/temporary "\$workdir" "\$SANCTUARY_OPERATION_RUN_ID"/.test(line)
  ))) return false;
  return orderedRegistrationShape(source, [
      creation,
      /SANCTUARY_PROJECT_DIR="\$source_workspace" ownership_initialize/,
      /describe-host-authority\.mjs"\s+\\?\s*temporary "\$workdir" "\$SANCTUARY_OPERATION_RUN_ID"\)"/,
      /execution_authority="\$\(printf '%s' "\$authority_bundle" \| jq -c '\.executionAuthority'\)"/,
      /path_identity="\$\(printf '%s' "\$authority_bundle" \| jq -r '\.immutableIdentity'\)"/,
      /register_owned_resource temporary_artifact active exact_delete path "\$workdir" "\$path_identity"\s+\\?\s*--execution-authority "\$execution_authority" "\$run_id"/,
      /repo="\$workdir\/repo"/,
      /git clone --quiet --no-hardlinks "\$source_workspace" "\$repo"/,
      /printf '%s\\n' "\$repo"/,
    ]);
}

function hasRegisteredWorktreeProof(relativePath, source) {
  if (relativePath !== 'tests/install/e2e/upgrade-install.test.sh') return false;
  const creation = /git -C "\$TARGET_PROJECT_ROOT" worktree add --detach\s+\\?\s*"\$UPGRADE_SOURCE_CHECKOUT" "\$source_ref" >\/dev\/null \|\| add_status=\$\?/;
  const registration = /register_owned_resource git_worktree obsolete exact_delete path/;
  const between = textBeforeRegistration(source, creation, registration);
  if (between === null) return false;
  const prematureUse = between.split('\n').some((line) => (
    /\$UPGRADE_SOURCE_CHECKOUT\b/.test(line)
      && !/\[ ! -d "\$UPGRADE_SOURCE_CHECKOUT" \]/.test(line)
      && !/worktree "\$UPGRADE_SOURCE_CHECKOUT"/.test(line)
  ));
  return !prematureUse && orderedRegistrationShape(source, [
    creation,
    /describe-host-authority\.mjs"\s+\\?\s*worktree "\$UPGRADE_SOURCE_CHECKOUT" "\$source_oid" "\$SANCTUARY_DEPLOYMENT_ID"\s+\\?\s*"\$SANCTUARY_OPERATION_RUN_ID"\)" \|\| return 1/,
    /execution_authority="\$\(printf '%s' "\$authority_bundle" \| jq -c '\.executionAuthority'\)" \|\| return 1/,
    /worktree_identity="\$\(printf '%s' "\$authority_bundle" \| jq -r '\.immutableIdentity'\)" \|\| return 1/,
    /register_owned_resource git_worktree obsolete exact_delete path\s+\\?\s*"\$UPGRADE_SOURCE_CHECKOUT" "\$worktree_identity"\s+\\?\s*--execution-authority "\$execution_authority" "\$SANCTUARY_OPERATION_RUN_ID" \|\| return 1/,
    /\[ "\$add_status" -eq 0 \] \|\| return "\$add_status"/,
    /PROJECT_ROOT="\$UPGRADE_SOURCE_CHECKOUT"/,
  ]);
}

function hasTestFixtureProof(relativePath, source, statements) {
  if (!relativePath.startsWith('tests/') || relativePath.startsWith('tests/install/e2e/')) {
    return false;
  }
  const declaresFixture = /\b(?:mktemp|mkdtempSync|tmpdir)\b|\bTEST_[A-Z0-9_]*(?:ROOT|DIR|TMP|TEMP)[A-Z0-9_]*\b|\bfixture\b|\b[A-Z][A-Z0-9_]*_PID\b/i.test(source);
  const destructive = statements.filter((line) => (
    hasRecursivePathDeletion(line)
      || processSignalStatements([line]).some((candidate) => !isSignalObservation(candidate))
      || hasWorktreeCommand(line, '(?:add|remove|prune)')
  ));
  const broadHostTarget = /\$(?:\{)?(?:HOME|GITHUB[_]WORKSPACE|RUNNER_WORKSPACE)\b|\brm\s+(?:--[^\s]*recursive|-[A-Za-z]*[rR][A-Za-z]*)\s+['"]?\/|\bfind\s+['"]?\/|\b(?:rmSync|rm|fs\.rmSync|fs\.rm)\s*\(\s*['"]\/|\b(?:process\.)?kill\s*\(\s*1\b|\bkill\s+(?:-[A-Z]+\s+)?1\b/;
  return declaresFixture && destructive.length > 0
    && destructive.every((line) => !broadHostTarget.test(line));
}

function hostMechanism(relativePath, source, statements) {
  if (hasCanonicalHostInternalProof(relativePath, source)) return 'canonical_host_internal';
  if (hasTestFixtureProof(relativePath, source, statements)) return 'test_fixture';
  return 'host_migration';
}

function hostLifecycleFindings(relativePath, source, statements) {
  if (!isHostSourcePath(relativePath)) return [];
  const findings = [];
  const text = statements.join('\n');
  const mechanism = hostMechanism(relativePath, source, statements);
  const recursiveDeletions = statements.filter((line) => (
    hasRecursivePathDeletion(line) && !isContainerInternalPathDeletion(line)
  ));
  if (recursiveDeletions.length > 0 || hasJavaScriptRecursivePathDeletion(text)) {
    findings.push({
      path: relativePath, resourceClass: 'temporary_artifact', operation: 'cleanup', mechanism,
    });
  }

  const signals = processSignalStatements(statements);
  const mutatingSignals = signals.filter((line) => !isSignalObservation(line));
  if (mutatingSignals.length > 0) {
    findings.push({
      path: relativePath, resourceClass: 'collector_process', operation: 'cleanup', mechanism,
    });
  } else if (signals.length > 0) {
    findings.push({
      path: relativePath, resourceClass: 'collector_process', operation: 'register',
      mechanism: 'reference_observation',
    });
  }

  if (hasWorktreeCommand(text, '(?:remove|prune)')) {
    findings.push({
      path: relativePath, resourceClass: 'git_worktree', operation: 'cleanup',
      mechanism: hasRegisteredWorktreeProof(relativePath, source) ? 'registered_exact' : mechanism,
    });
  }
  if (hasWorktreeCommand(text, 'add')) {
    findings.push({
      path: relativePath, resourceClass: 'git_worktree', operation: 'create',
      mechanism: hasRegisteredWorktreeProof(relativePath, source) ? 'registered_exact' : mechanism,
    });
  }
  if (hasWorktreeCommand(text, 'list') && !hasWorktreeCommand(text, '(?:add|remove|prune)')) {
    findings.push({
      path: relativePath, resourceClass: 'git_worktree', operation: 'register',
      mechanism: 'reference_observation',
    });
  }

  const explicitClass = EXPLICIT_HOST_CREATION_PATHS.get(relativePath);
  if (explicitClass && !findings.some((entry) => (
    entry.resourceClass === explicitClass && entry.operation === 'create'
  ))) {
    findings.push({
      path: relativePath, resourceClass: explicitClass, operation: 'create',
      mechanism: hasRegisteredStagingProof(relativePath, source)
        ? 'registered_exact'
        : hasRegisteredIsolatedWorkspaceProof(relativePath, source)
        ? 'registered_exact'
        : relativePath === 'scripts/perf/wallet-sync-high-fanout-replay.mjs'
          && /assertCoordinatedReplayAuthority/.test(source)
          && /SANCTUARY_CLEANUP_COORDINATED/.test(source)
          && /SANCTUARY_OWNERSHIP_ROOT/.test(source)
          ? 'cleanup_coordinator'
          : 'host_migration',
    });
  }
  if (relativePath === 'scripts/ci/registered-collector-process.sh') {
    findings.push({
      path: relativePath, resourceClass: 'collector_process', operation: 'register',
      mechanism: hasRegisteredCollectorProof(relativePath, source)
        ? 'registered_exact' : 'host_migration',
    });
  }
  return findings;
}

function lifecycleFindings(relativePath, source, statements) {
  const findings = [];
  for (const resourceClass of [...cleanupClassesFor(relativePath, source, statements)].sort()) {
    const mechanism = mechanismFor(relativePath, statements, resourceClass, source);
    findings.push({ path: relativePath, resourceClass, operation: 'cleanup', mechanism });
  }
  for (const resourceClass of [...creationClassesFor(relativePath, source, statements)].sort()) {
    const mechanism = creationMechanismFor(relativePath, statements, resourceClass, source);
    findings.push({ path: relativePath, resourceClass, operation: 'create', mechanism });
  }
  return findings;
}

function registrationFindings(relativePath, source, statements) {
  const findings = [...DOCKER_CLASSES].filter((resourceClass) => statements.some((line) => (
    new RegExp(String.raw`\bregister_owned_resource\s+${resourceClass}\b`).test(line)
  ))).map((resourceClass) => ({
    path: relativePath, resourceClass, operation: 'register', mechanism: 'registered_exact',
  }));
  const replayMarkers = ['createRegisteredReplayResource', 'recoverCreatedIdentity', 'ownedCreationListArgs'];
  if (relativePath !== 'scripts/perf/wallet-sync-replay-creation.mjs'
      || !replayMarkers.every((marker) => source.includes(marker))) return findings;
  return findings.concat(['compose_container', 'compose_network'].map((resourceClass) => ({
    path: relativePath, resourceClass, operation: 'create', mechanism: 'registered_exact',
  })));
}

function scanSourceFile(root, relativePath) {
  let source;
  try { source = readFileSync(path.join(root, relativePath), 'utf8'); } catch { return null; }
  const statements = executableStatements(source);
  const dockerFindings = isSourcePath(relativePath)
    ? [...lifecycleFindings(relativePath, source, statements),
      ...registrationFindings(relativePath, source, statements)]
    : [];
  return {
    findings: [
      ...dockerFindings,
      ...hostLifecycleFindings(relativePath, source, statements),
    ],
    broadPrunes: isSourcePath(relativePath)
      ? [...new Set(statements.flatMap(broadPrunes))]
        .map((kind) => ({ path: relativePath, kind }))
      : [],
  };
}

export function scanLifecycleCallsites({ root, files = trackedFiles(root) }) {
  const result = { findings: [], broadPrunes: [] };
  for (const relativePath of [...files].sort().filter((entry) => (
    isSourcePath(entry) || isHostSourcePath(entry)
  ))) {
    const scanned = scanSourceFile(root, relativePath);
    if (!scanned) continue;
    result.findings.push(...scanned.findings);
    result.broadPrunes.push(...scanned.broadPrunes);
  }
  return result;
}

function identity(entry) { return `${entry.path}:${entry.resourceClass}:${entry.operation}`; }

function coverageErrors(declared, discovered) {
  const errors = [];
  for (const [key] of discovered) {
    if (!declared.has(key)) errors.push(`unclassified lifecycle callsite: ${key}`);
  }
  for (const [key, entry] of declared) {
    if ((DOCKER_CLASSES.has(entry.resourceClass) || PHASE6_HOST_CLASSES.has(entry.resourceClass))
        && ['cleanup', 'create', 'register'].includes(entry.operation)
        && !discovered.has(key)) errors.push(`stale lifecycle callsite: ${key}`);
  }
  return errors;
}

const EXEMPT_CREATE_MECHANISMS = new Set([
  'cleanup_coordinator', 'daemon_atomic', 'registered_exact', 'registered_transient',
  'retained_shared_cache', 'retained_application', 'ownership_manifest',
]);
const EXEMPT_CLEANUP_MECHANISMS = new Set([
  'canonical_executor', 'cleanup_coordinator', 'daemon_atomic', 'registered_transient',
  'registered_exact',
]);
const APPLICATION_MECHANISMS = new Set(['application_api', 'ownership_manifest']);
const EXEMPT_HOST_MECHANISMS = new Set([
  'canonical_host_internal', 'cleanup_coordinator', 'registered_exact', 'test_fixture',
]);

function exemptDeclarationErrors(key, entry, finding) {
  if (entry.disposition !== 'exempt' || !finding) return [];
  if (PHASE6_HOST_CLASSES.has(entry.resourceClass)) {
    return EXEMPT_HOST_MECHANISMS.has(finding.mechanism)
      ? [] : [`unverified host lifecycle cannot be exempt: ${key}`];
  }
  if (entry.operation === 'create' && !EXEMPT_CREATE_MECHANISMS.has(finding.mechanism)) {
    return [`unverified Docker producer cannot be exempt: ${key}`];
  }
  if (entry.operation === 'cleanup' && !EXEMPT_CLEANUP_MECHANISMS.has(finding.mechanism)) {
    return [`direct Docker cleanup cannot be exempt: ${key}`];
  }
  if (entry.operation === 'register' && finding.mechanism !== 'registered_exact') {
    return [`Docker registration is not exact: ${key}`];
  }
  return [];
}

function referenceDeclarationErrors(key, entry, finding, phase) {
  if (entry.disposition !== 'reference_only') return [];
  if (PHASE6_HOST_CLASSES.has(entry.resourceClass)) {
    return finding?.mechanism === 'reference_observation'
      ? [] : [`host reference is not a mechanically read-only observation: ${key}`];
  }
  const errors = [];
  if (entry.operation === 'create' && finding && !APPLICATION_MECHANISMS.has(finding.mechanism)) {
    errors.push(`Docker producer is not an application lifecycle reference: ${key}`);
  }
  if (phase >= 5 && DOCKER_CLASSES.has(entry.resourceClass)
      && !entry.safetyContract.includes('application lifecycle')) {
    errors.push(`Docker cleanup reference must name its application lifecycle: ${key}`);
  }
  if (finding && !APPLICATION_MECHANISMS.has(finding.mechanism)) {
    errors.push(`Docker mutation is not a mechanically recognized application lifecycle: ${key}`);
  }
  return errors;
}

function deferredDeclarationErrors(key, entry) {
  if (entry.disposition !== 'deferred') return [];
  if (PHASE6_HOST_CLASSES.has(entry.resourceClass) && entry.safetyContract.includes('Phase 6')) return [];
  return [`only an explicit Phase 6 host artifact may be deferred: ${key}`];
}

function declarationEntryErrors(key, entry, finding, phase) {
  const errors = [];
  if (!['migrate', 'reference_only', 'exempt', 'deferred'].includes(entry.disposition)) {
    errors.push(`invalid lifecycle disposition: ${key}`);
  }
  return errors.concat(
    exemptDeclarationErrors(key, entry, finding),
    referenceDeclarationErrors(key, entry, finding, phase),
    deferredDeclarationErrors(key, entry),
  );
}

function declarationErrors(declared, discovered, phase) {
  return [...declared].flatMap(([key, entry]) => (
    declarationEntryErrors(key, entry, discovered.get(key), phase)
  ));
}

export function phase5MigrationBlockers(inventory) {
  return inventory.callsites.filter((entry) => DOCKER_CLASSES.has(entry.resourceClass)
    && entry.disposition === 'migrate').map(identity).sort();
}

export function phase6MigrationBlockers(inventory) {
  return inventory.callsites.filter((entry) => PHASE6_HOST_CLASSES.has(entry.resourceClass)
    && ['deferred', 'migrate'].includes(entry.disposition)).map(identity).sort();
}

export function validateLifecycleCallsites({ inventory, scan, phase = 5 }) {
  const declared = new Map(inventory.callsites.map((entry) => [identity(entry), entry]));
  const discovered = new Map(scan.findings.map((entry) => [identity(entry), entry]));
  const errors = [
    ...coverageErrors(declared, discovered),
    ...declarationErrors(declared, discovered, phase),
  ];
  if (phase >= 5) for (const blocker of phase5MigrationBlockers(inventory)) {
    errors.push(`unresolved Phase 5 Docker lifecycle migration: ${blocker}`);
  }
  if (phase >= 6) for (const blocker of phase6MigrationBlockers(inventory)) {
    errors.push(`unresolved Phase 6 host lifecycle migration: ${blocker}`);
  }
  for (const prune of scan.broadPrunes) {
    errors.push(`broad Docker cleanup is forbidden: ${prune.path}:${prune.kind}`);
  }
  if (errors.length > 0) throw new AggregateError(errors.map((message) => new Error(message)), errors.join('\n'));
  const migrations = [...declared.values()].filter((entry) => DOCKER_CLASSES.has(entry.resourceClass)
    && entry.disposition === 'migrate').length;
  return { callsites: discovered.size, broadPrunes: 0, migrations };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const inventoryPath = path.resolve(process.argv[2] ?? path.join(root, 'config/resource-lifecycle-callsites.json'));
  const inventory = parseStrictJson(readFileSync(inventoryPath));
  const result = validateLifecycleCallsites({
    inventory, scan: scanLifecycleCallsites({ root }), phase: 6,
  });
  const hostMigrations = inventory.callsites.filter((entry) => (
    PHASE6_HOST_CLASSES.has(entry.resourceClass)
      && ['deferred', 'migrate'].includes(entry.disposition)
  )).length;
  console.log(`lifecycle callsite registry is complete (${result.callsites} lifecycle identities; ${result.migrations} Docker migrations and ${hostMigrations} host migrations remain)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
