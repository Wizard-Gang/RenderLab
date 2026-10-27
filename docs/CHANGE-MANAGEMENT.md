# Change management

This is the canonical way RenderLab accepts and merges a change. Every accepted task gets one permanent `RLDR-###` ID; a change to the plan alone takes none. The [governing specification](specifications/2026-10-18-renderlab.md) §20 reserves `RLDR-001`…`RLDR-021` for the baseline. The root `RLDR-001` bootstrap commit precedes provider protection; every later change follows the controlled PR path. GitHub history is the permanent record of accepted changes.

## Authority and sequence

Fetch `main`, inspect open PRs and current CI, then reconcile `implementation_plan.md` with first-parent history. The first open task is next. Each task carries nonempty `Dependency`, `Why`, `Scope`, `Non-goals`, `Acceptance`, `Tests`, `Validation`, `Documentation` and `Authorities` fields, the task shape the specification requires. A delivering PR removes its own task, and the last one leaves the tracked queue empty. Do not start a later task or a duplicate PR.

Any PR may add, edit, reorder or remove queued tasks, at any time and from any queue state. A PR that changes only `implementation_plan.md` is titled `[PLAN] Imperative summary` on a `plan-imperative-summary` branch; it takes no ID, carries the same controlled body, leaves `config/release.json` alone and squashes into the open release branch like a task. A task PR may edit other tasks in the same commit, and may deliver a task that was never queued under a new ID.

IDs start at `RLDR-001` and are unique, permanent and never recycled. A new task, queued or delivered, takes an ID above every ID ever used in history or any earlier plan, so removing a queued task retires its ID; history and the queue need not be contiguous or ascending. A correction or revert receives a new ID and cites the affected change in its body. Branches are `rldr-NNN-imperative-summary`. PR titles and commit subjects are exactly `[RLDR-NNN] [TYPE] Imperative summary`, with the same ID, type, and subject. Types: `INIT`, `FEAT`, `FIX`, `SEC`, `API`, `A11Y`, `I18N`, `AI`, `DB`, `OPS`, `TEST`, `DOCS`, `REFACTOR`, `PERF`, `BUILD`, `REVERT`, `CHORE`.

The one commit in the PR range carries ordered, nonempty fields:

```text
[RLDR-###] [TYPE] Imperative summary

Change:
What changed.

Reason:
Why it changed.

Impact:
What boundary or behavior is affected.

Risk:
Low
Concrete exposure. Use Medium or High when appropriate.

Controls:
How the risk is constrained or reversed.

Validation:
Checks actually run and their results.

Evidence:
Relevant paths, run URLs, or exact provider observations.

Source:
Direct work or the source commit/issue used.

Release:
The intended version or Unreleased.
```

Risk is low for policy prose with no control change, medium for build and process behavior, and high for authentication, permissions, secrets, protected history, release publication, or destructive effects. High-risk changes name a rollback or forward correction and its authority. Do not backfill unobserved validation.

## Acceptance path

1. Start from the exact tip of the open `release/rNNN` branch (current `main` through RLDR-007) on an isolated branch, implement one task, and update its plan block in the same patch. Keep one controlled commit in the PR range.
2. Agents do not run tests or `npm run check` locally; CI's `verify` runs `npm run check` and `npm run test:browser` on the release PR's exact head, or on any branch through `gh workflow run verify.yml --ref <branch>`. Run pinned `npm ci`, `npm run check:gate` (the plan queue, workflow shell, repository, boundary and fixture checks, typecheck and build: exactly the `gate` job), `npm run check:change`, `npm run audit:dependencies`, and `PATCH_BASE_SHA=<full-base> PATCH_HEAD_SHA=<full-head> npm run check:patch`. The patch check uses the committed range; a working-tree `git diff --check` alone does not prove the PR range. Verify live settings when provider policy is touched. Record future CI/provider observations in the PR timeline or delivery report; the immutable commit and matching PR body contain only evidence known at authoring time or explicitly marked pending.
3. Open a PR targeting the release branch. Its body must equal the controlled commit body. Set the squash subject and body explicitly to that controlled record when merging. CI checks out the event's exact `pull_request.head.sha`; `change-id` validates the PR title, branch, subject, body, one-commit range, ID uniqueness, task retirement and `config/release.json`. `gate` runs the non-test checks and the patch check. The release ruleset requires both with the branch current with its base.
4. Before merging, re-fetch `main` and the PR, record the exact current head SHA, the required check run IDs and conclusions for that SHA, and mergeability. Re-read the live ruleset and repository settings. A changed base or head requires a fresh exact-head check. Diagnose failed jobs from their complete logs for the exact run attempt.
5. Squash merge only the validated head into the release branch. Set the squash subject and body to the controlled commit record. Merge commits are disabled, task PRs never rebase-merge, and no direct push, force push, or deletion of `main` is permitted.
6. Re-fetch the release branch, confirm its expected first-parent controlled commit and tree, plan retirement, branch deletion, and a clean worktree. Report a missing check as missing, even if the PR merge succeeded.

## Release branches (from RLDR-008)

The owner's 2026-10-25 rulings batch tasks so the full suite, including the Chromium and WebKit browser tests, runs once per release. Tasks through RLDR-007 merged straight into `main`; `check:change` refuses a later task PR into `main`.

- `release/rNNN` (r001, r002, …) is cut from main's tip with `git push origin main:refs/heads/release/rNNN`. One is open at a time. `config/release.json` names it as `{id, branch, tasks}`; each task PR appends its ID, and a release's first task rewrites the file.
- The release PR, `release/rNNN` into `main`, opens only when the owner says "release". Its title is `[RELEASE] rNNN: RLDR-0xx..RLDR-0yy` (one ID for a one-task release). Its commits are exactly one controlled commit per listed task, oldest first, plus any `[PLAN]` commits. `verify`, `change-id` and `security` must pass on its exact head with the branch current with `main`, and it rebase-merges, so main gains one commit per task or plan change. A red release is fixed forward by a task PR into the release branch.
- GitHub is the release record: the merged release PR, its commits and its exact-head checks. The repository keeps no release or delivery ledger.

The provider contract is committed in `config/github-repository-settings.json`. `npm run verify:github-settings` reads live repository merge settings and rulesets; `npm run apply:github-settings` changes only those committed controls and independently reads them back. CI has read-only repository permissions. RenderLab has no release or deployment workflow; adding one is a separate governed task that also extends the repository contract. The rulesets have no bypass actors. The repository's actual plan or provider capability must be checked live before asserting enforcement.

`npm run test:contracts` (`node --test tests/contracts/*.test.mjs`) guards release-branch identity, history/plan/PR identity, the specification pin, repository workflow structure and permissions, the no-deploy and React/TypeScript-only boundaries, the PixiJS v8 rule, the dev launcher and provider policy comparison. `npm run test` (Vitest) guards the application code; `npm run test:browser` (Playwright) guards it in real Chromium and WebKit. [Testing](TESTING.md) describes the layers. CI runs every layer on the release PR's exact head; agents do not run them locally.
