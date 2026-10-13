# Bug scrub loop — iteration 3

Run bug-scrub-loop-20261012-sanctuary, whole-repository scope, source main
`a60b2cc46fe60bc687d67427da49420424af46e3`. One compatible CI-only delivery PR.

## Goal and evidence

P2 `install-ci--isolated-driver-trigger-gap`: install-test.yml outer PR filters
omit release-surface paths that classify-install-scope.sh explicitly promises
stack-smoke and latest-stable baseline-upgrade coverage. Driver-only fixture
classifies correctly, but workflow never starts. Missing categories extend across
scripts/ci, workflow/action files and nested Dockerfiles. Quality's stubbed unit
contracts and RC's separate fresh-install lane do not provide the promised lanes.

Non-goals: runtime/source behavior, migrations, version bumps, runner infrastructure,
branch protections, globally requiring optional workflows, new CI scope policy,
and P3 backlog. Preserve existing docs exclusions and install-specific triggers.

## Implementation

- [x] Re-read release-surface classifier case and release-candidate outer filters;
  enumerate current and future representative paths for each intended category.
- [x] Add failing regression to an existing registered CI contract suite, using
  parsed install workflow trigger paths and representative classifier fixtures.
  Prove each isolated driver and each missing category starts the PR workflow and
  reaches bounded stack-smoke + latest-stable baseline lanes. Preserve docs-only
  exclusion and unrelated application-file behavior. Check push path parity while
  preserving tag-only push semantics. Do not merely search the entire YAML for
  a path (job references would falsely pass).
- [x] Align install-test.yml push/PR paths with the existing release-surface
  categories. Prefer broad canonical globs over adding just two filenames;
  retain install-specific paths. No expansion beyond documented classifier policy.
  Exact canonical patterns: scripts/ci/**, scripts/ownership/**, tests/install/**,
  .github/workflows/**, .github/actions/**, **/Dockerfile, docker-compose*.yml,
  docker/compose/**, start.sh, install.sh, scripts/setup.sh. Match the exact
  Dockerfile basename, not **/*Dockerfile; gateway/Service.Dockerfile stays outside
  that category. Check both parsed path sections, preserve every existing
  install-specific trigger/exclusion, exact prerelease tag list and no push branches.
- [x] Run regression red before workflow edit, then green; owning classifier,
  workflow composition, registration completeness and install unit suites.
  Use canonical standalone/cleanup wrappers where required. No direct live DB,
  unguarded Docker tests, host application servers or generated-client races.
- [x] Run relevant shell/YAML syntax and architecture/resource-ownership checks;
  inspect final diff for unrelated changes. Prior full application gates at the
  identical application tree remain valid; no application code is changed.
- [x] Independent adversarial review and parent verification of trigger semantics,
  docs exclusions, tag behavior and test registration. Recursively review any
  material plan change before implementation.

## Delivery and closeout

- [ ] Re-fetch main, check open PRs and reconfirm source evidence. Commit with
  normal hooks; one reviewed PR with regression evidence. Reserve remote branch
  before push. Require all protected exact-head checks plus affected install/RC
  evidence or explicit reviewed infrastructure disposition; no status rewrites.
- [ ] Protected squash merge with branch auto-deletion disabled; verify actual
  merge object/ancestry and identical tested tree, then exact main CI.
- [ ] Archive reviewed plan, progress and all unique commits. Obtain exact one-off
  cleanup approval, remove owned resources and verify original inventory equality.
- [ ] Fresh complete full-scope scrub; do not call the loop clean from tests alone.

Rollback: protected revert of workflow/tests only. No migration or data repair.
Nested implement-merge uses caller-owned goal/state, rebuild_policy defer and
cleanup_policy iteration-baseline. Final deployment only after fresh zero-P0/P1/P2:
recheck original/current running stack, persist pending operation, run documented
`./start.sh --rebuild` from existing sanctuary-main checkout, verify deployed commit,
health/readiness and persist terminal result. Never start a stopped stack.

## Review
Pass1: independent reviews confirmed intent and scope. Accepted precision: exact
canonical globs, Dockerfile basename negative fixture, exact tag-only push check.
Pass2: independent complete reread and parent source review clean; converged.

## Implementation verification

Parsed outer-trigger regression failed on the original workflow; it now passes
with the actual isolated drivers, future category paths, root/gateway/nested exact
Dockerfiles and compose variants. Classifier fixtures independently prove selected
bounded smoke/baseline lanes. Native Node24 path matching retains ordered exclusions.
Full install unit runner:20/20 commands,18 install suites +2 composition suites,
zero failures. Registration10/10, resource ownership412 identities, architecture
2378 files/10452 imports, workflow test-only policy, syntax and diff checks pass.
Independent final review clean. Proposed new global Markdown exclusions rejected:
existing install-doc exclusions remain, while classifier already declines other
Markdown before selecting runtime lanes; changing broader exclusions is unnecessary.
No application production source differs from the fully tested prior merged tree.
Delivery and target CI pending; no deployment.

Normal hooks passed all9319 frontend tests. First hook attempt identified missing
generated Prisma client in fresh worktree; generated client/shared workspace,
verified owning hardware-report16 tests, then full hooks passed. No source fix
or bypass was needed.
