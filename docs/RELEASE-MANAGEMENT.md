# Release management

`package.json` owns the version. RenderLab has **no release or deployment path yet**: the repository carries only the CI workflow, normal implementation changes leave the version alone, and nothing creates tags, GitHub Releases, packages or hosted deployments. The [governing specification](specifications/2026-10-18-renderlab.md) §21 requires a separate governed task for any production release or deployment.

The provider controls a future release depends on are already in force, so a release path can only be added safely:

- the `release-tag-immutability` ruleset blocks updating or deleting any `v*` tag, with no bypass actors;
- immutable GitHub Releases are enabled before any Release exists, so the first published Release is immutable;
- the repository contract (`scripts/repository-contract.mjs`) accepts exactly one workflow, `ci.yml`, so a release workflow cannot arrive without a controlled change that also extends that contract and its tests.

## Adding a release path

A controlled task that introduces releases follows the shared Wizard-Gang baseline release shape used by RigLab and Hexframe, adapted in that task:

1. Queue it through a plan-only change; it never rides along with feature work.
2. Add the release workflows (a cutter that tags the exact accepted `main` commit after its post-merge CI, and a release job that reproduces, attests and publishes), their contract rules and their tests in one change.
3. Decide in that task what a release publishes (for example a reproduced source archive with provenance) and whether a hosted demo is in scope; a deployment target needs its own runbook and controls.
4. Verify live settings with `npm run verify:github-settings` before merging the version change that triggers the first release.

Until then, a reader of RenderLab runs it from source with `cd ~/Documents/GitHub/RenderLab && npm ci && npm start`.
