# Claude Code hooks

Guard scripts that Claude Code runs around its own tool calls. They enforce the
same rules as `CLAUDE.md`, but mechanically rather than by asking nicely.

They live here rather than in `.claude/hooks/` because `.claude/` is gitignored
in full — it holds per-developer state (agent cache, audit log, settings) and
would leak machine-specific paths. Tracking `.claude/` also adds a thirteenth
tracked root directory, which `scripts/quality/check-root-layout.mjs` rejects.
The scripts themselves are code and belong under review; only the wiring is
per-developer.

## What each one does

| Script | Event | Effect |
| --- | --- | --- |
| `block-direct-npm.sh` | `PreToolUse` on `Bash` | Refuses `npm run dev/preview/start` and `npx vite` on the host. Sanctuary runs in Docker; `./start.sh` is the entry point. `vitest` is deliberately still allowed. |
| `block-sensitive-edits.sh` | `PreToolUse` on `Edit`/`Write`/`NotebookEdit` | Refuses edits to lock files (silently undoes the override pins), `.env*` (secrets, user-managed), and applied Prisma migration SQL (immutable once created). |
| `typecheck-on-edit.sh` | `PostToolUse` on `Edit`/`Write` | Runs `tsc --noEmit` for the workspace owning the edited file and surfaces the error immediately, rather than letting CI find it. |

All three read the tool payload as JSON on stdin and exit `2` with a message on
stderr to block; any other path exits `0`.

## Wiring

They are not active until referenced from `.claude/settings.json`, which stays
untracked:

```jsonc
{
  "PreToolUse": [
    {
      "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/scripts/claude-hooks/block-direct-npm.sh" }]
    },
    {
      "matcher": "Edit|Write|NotebookEdit",
      "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/scripts/claude-hooks/block-sensitive-edits.sh" }]
    }
  ],
  "PostToolUse": [
    {
      "matcher": "Edit|Write",
      "hooks": [{ "type": "command", "command": "$CLAUDE_PROJECT_DIR/scripts/claude-hooks/typecheck-on-edit.sh" }]
    }
  ]
}
```

Prefer `$CLAUDE_PROJECT_DIR` over an absolute path. An absolute path pinned to
one checkout is the bug this directory exists because of: `typecheck-on-edit.sh`
hardcoded its repo root, so editing inside a git worktree typechecked the *other*
checkout — silently, since a clean result there is indistinguishable from a clean
result here. It now derives the root from the edited file via
`git rev-parse --show-toplevel`, and hardcoding the path in `settings.json`
would reintroduce the same failure one level up.

## Changing them

A hook that fails open is worse than no hook: it reports nothing and everyone
assumes it is working. `typecheck-on-edit.sh` pointed at a `tsconfig.json` path
that had moved and exited `TS5058` on every single edit for weeks, catching
nothing.

So after any change, check both directions — that it passes on good input **and
fails on bad**:

```bash
# should exit 0
echo '{"tool_input":{"file_path":"'"$PWD"'/src/utils/relativeTime.ts"}}' \
  | scripts/claude-hooks/typecheck-on-edit.sh; echo "exit=$?"

# introduce a deliberate type error first, then expect exit 2 and a real TS message
```
