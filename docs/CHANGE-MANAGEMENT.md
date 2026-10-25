# Change management

This is the canonical way RenderLab accepts and merges a change. Every accepted repository change gets one permanent `RLDR-###` ID; the [governing specification](specifications/2026-10-18-renderlab.md) §20 reserves `RLDR-001`…`RLDR-021` for the baseline. The root `RLDR-001` bootstrap commit precedes provider protection; every later change follows the controlled PR path. GitHub history is the permanent record of accepted changes.

## Authority and sequence

Fetch `main`, inspect open PRs and current CI, then reconcile `implementation_plan.md` with first-parent history. The first open task is next. Plan headings reserve contiguous IDs; each task carries nonempty `Dependency`, `Why`, `Scope`, `Non-goals`, `Acceptance`, `Tests`, `Validation`, `Documentation` and `Authorities` fields, the task shape the specification requires. A delivering PR removes its own task, and the last one leaves the tracked queue empty. A blocked task stays first until its prerequisite is resolved or the owner explicitly changes priority through a controlled change. Do not start a later task or a duplicate PR. When the queue is empty, the next instruction fills it through a controlled, plan-only change before implementation begins.

IDs are sequential from `RLDR-001`, unique, permanent, and never recycled. A correction or revert receives the next ID and cites the affected change in its body. Branches are `rldr-NNN-imperative-summary`. PR titles and commit subjects are exactly `[RLDR-NNN] [TYPE] Imperative summary`, with the same ID, type, and subject. Types: `INIT`, `FEAT`, `FIX`, `SEC`, `API`, `A11Y`, `I18N`, `AI`, `DB`, `OPS`, `TEST`, `DOCS`, `REFACTOR`, `PERF`, `BUILD`, `REVERT`, `CHORE`.

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

1. Start from current `main` on an isolated branch, implement one task, and update its plan block in the same patch. Keep one controlled commit in the PR range.
2. Agents do not run tests or `npm run check` locally; CI's `verify` runs `npm run check` and `npm run test:browser` on the exact head. Run pinned `npm ci`, `npm run typecheck`, `npm run build`, the `check:*` scripts, `npm run audit:dependencies`, and `PATCH_BASE_SHA=<full-base> PATCH_HEAD_SHA=<full-head> npm run check:patch`. The patch check uses the committed range; a working-tree `git diff --check` alone does not prove the PR range. Verify live settings when provider policy is touched. Record future CI/provider observations in the PR timeline or delivery report; the immutable commit and matching PR body contain only evidence known at authoring time or explicitly marked pending.
3. Open a PR targeting `main`. Its body must equal the controlled commit body. Set the squash subject and body explicitly to that controlled record when merging. CI checks out the event's exact `pull_request.head.sha`; `change-id` validates the PR title, branch, subject, body, one-commit range, task order, and task retirement. `verify` runs the offline gate, the Chromium and WebKit browser tests and the patch check; `security` audits dependencies. The ruleset requires all three checks to pass with the branch current with `main`.
4. Before merging, re-fetch `main` and the PR, record the exact current head SHA, the required check run IDs and conclusions for that SHA, and mergeability. Re-read the live ruleset and repository settings. A changed base or head requires a fresh exact-head check. Diagnose failed jobs from their complete logs for the exact run attempt.
5. Squash merge only the validated head. Set the squash subject and body to the controlled commit record. Merge commits and rebase merges are disabled; no ordinary direct push, force push, or deletion of `main` is permitted.
6. Re-fetch `main`, confirm its expected first-parent controlled commit and tree, post-merge required CI on the new SHA, plan retirement, branch deletion, and a clean worktree. Report a missing check as missing, even if the PR merge succeeded.

The provider contract is committed in `config/github-repository-settings.json`. `npm run verify:github-settings` reads live repository merge settings and rulesets; `npm run apply:github-settings` changes only those committed controls and independently reads them back. CI has read-only repository permissions. RenderLab has no release or deployment workflow; adding one is a separate governed task that also extends the repository contract. The rulesets have no bypass actors. The repository's actual plan or provider capability must be checked live before asserting enforcement.

`npm run test:contracts` (`node --test tests/contracts/*.test.mjs`) guards history/plan/PR identity, the specification pin, repository workflow structure and permissions, the no-deploy and React/TypeScript-only boundaries, the PixiJS v8 rule, the dev launcher and provider policy comparison. `npm run test` (Vitest) guards the application code; `npm run test:browser` (Playwright) guards it in real Chromium and WebKit. [Testing](TESTING.md) describes the layers. CI runs every layer on the exact head; agents do not run them locally.
