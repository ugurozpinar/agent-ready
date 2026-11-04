# Workflow: monorepo

Applies when `detect.mjs` reports `state: monorepo`. Handle the root and each selected package with [existing-repo](existing-repo.md), then apply the rules here.

## Scope selection

Choose scopes in the plan. `scopes` lists the root first, then packages by recent activity.

| `workspaces.total` | Default selection |
|---|---|
| 20 or fewer | Root and every package |
| More than 20 | Root only. Propose the 10 most active packages; none is selected until the user picks |

- The user can add or remove any package. List each unselected package as skipped, with the reason.
- When `workspaces.truncated` is true, at most 25 scopes are listed. Run `detect.mjs --scope <path>` for any other package the user names.

## Gather

Analyze each selected package as the subagent strategy in `SKILL.md` says, and analyze the root as well.

## Layering

```
AGENTS.md, CLAUDE.md               # repo-wide rules, cross-package work
docs/ai/                           # shared product docs and memory
packages/web/AGENTS.md, CLAUDE.md  # differences only
packages/web/docs/ai/              # only when the package has its own truth
```

- Put shared documents at the root. Put only differences in packages, and leave out any root rule or command that applies unchanged.
- Create `docs/ai/` in a package only when its truth differs from the root, for example a separate product with its own voice.

## Root coverage rule

Whenever package `AGENTS.md` files exist, the root `AGENTS.md` must contain this rule, with a path or glob covering them. Agents that start at the root do not load package files on their own.

"Before working in a package, read its `AGENTS.md` (`packages/*/AGENTS.md`)."

Adapt the glob to the real layout, for example `crates/*/AGENTS.md`. When the request limits the run to one package and the root lacks the rule, include the rule in the plan as a root change.

## Package files

Write relative links from the package file's own folder, for example `../../docs/ai/ai-memory.md`.
