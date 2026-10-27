# Contributing

Read [AGENTS.md](AGENTS.md) for the shared controlled-delivery workflow and [README.md](README.md) for this repository's product, commands, required checks, source boundaries and release/deployment details. Read [SECURITY.md](SECURITY.md) before reporting a vulnerability.

## Work queue

`implementation_plan.md` is the permanent current/future queue. Implement its first open task. Remove a delivered task in its completing change; leave an empty plan tracked when no task remains. Any PR may add, edit, reorder or remove queued tasks at any time; a change to the plan alone is a `[PLAN] Imperative summary` PR that takes no ID. A new task takes an ID above every ID ever used, and a removed queued ID is retired.

Fetch current `main`, the open release branch and open PRs before editing and again before merging. Reconcile any concurrent plan or base movement, then require the exact current PR head to pass the required checks for its base. Squash a validated task head once into the open `release/rNNN` branch. On the owner's "release", rebase-merge the release PR's validated head into protected `main` after the full suite; verify that main's tree equals the tested head's tree and branch cleanup.

## Commands and boundaries

Use the exact Node and npm versions committed in `.node-version` and `package.json`, then `npm ci`. `npm run check` is the canonical credential-free acceptance gate. Run task-specific focused tests, `git diff --check`, and the repository's separate advisory gate when applicable. `verify:github-settings` reads live policy; `apply:github-settings` alone performs committed settings changes with independent post-apply verification. Keep tokens in process or provider secret state.

Use [README.md](README.md) and its linked current authorities for repository-specific product ownership, dependency pins, release identity, deployment and no-production boundaries. A process normalization change does not create a release or deploy production.
