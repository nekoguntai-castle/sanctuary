import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the pre-test hooks in server/package.json that rebuild
// @sanctuary/shared before vitest resolves workspace imports. The hooks
// exist because shared/dist/ is gitignored and goes stale after `git pull`
// when new files land under shared/schemas/. Without the hooks, server
// vitest fails to resolve @sanctuary/shared/schemas/* and the coverage
// chain silently breaks. See docs/plans/grade-loop-remediation-plan.md.

const serverPackageJsonPath = join(__dirname, '..', '..', '..', 'package.json');
const HELPER_NAME = '_predistshared';
const HELPER_SCRIPT = 'cd .. && npm run build --workspace=shared';
const HOOK_PREFIX = `npm run ${HELPER_NAME} && `;
const HOOK_REMAINDER = 'prisma generate';

function readServerScripts(): Record<string, string> {
  const raw = readFileSync(serverPackageJsonPath, 'utf8');
  const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
  return parsed.scripts ?? {};
}

describe('server pre-test shared rebuild hooks', () => {
  const scripts = readServerScripts();

  it('defines the shared helper script with the verified working invocation', () => {
    expect(scripts[HELPER_NAME]).toBe(HELPER_SCRIPT);
  });

  it.each([
    'pretest',
    'pretest:run',
    'pretest:coverage',
    'pretest:ci',
  ] as const)(
    '%s chains the helper before prisma generate',
    (hook) => {
      const value = scripts[hook];
      expect(value, `${hook} script is missing`).toBeDefined();
      expect(value).toBe(`${HOOK_PREFIX}${HOOK_REMAINDER}`);
    },
  );

  // `test:run:ci` deliberately has no pretest hook. It is only ever invoked from
  // CI, and every one of its call sites already builds shared and generates the
  // Prisma client in an earlier step of the same job:
  //   - .github/workflows/test.yml:405, :942, :949 — preceded by the
  //     setup-server-deps composite, which builds shared and runs prisma generate
  //     (scripts/ci/setup-server-dependencies.sh).
  //   - .github/workflows/verify-vectors.yml — twelve call sites, each in a job
  //     whose "Install server dependencies" step runs `npm --workspace shared run
  //     build` immediately before `npx prisma generate`.
  // Re-adding the hook would re-run both on every invocation, which cost 12-25s
  // per call and was paid twice per attempt inside a three-attempt retry loop in
  // full-backend-integration-tests. If a new call site ever lacks that setup, add
  // the setup to the job rather than restoring the hook.
  it('leaves test:run:ci without a pretest hook, since CI sets up beforehand', () => {
    expect(scripts['pretest:run:ci']).toBeUndefined();
    expect(scripts['test:run:ci']).toBeDefined();
  });
});
