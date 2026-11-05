# Workflow: update

Applies when the user asks to update or refresh. Handle each scope that has an `AGENTS.md`. When `workspaces.truncated` is true, find the rest with `git ls-files '*AGENTS.md'`, or by walking the folder outside git, and run `detect.mjs --scope` on each.

## Flow

1. **Read the stamp and take the changes since that commit.** `stamp` and `changedSinceStamp` in the `detect.mjs` output summarize them. `detect.mjs --scope <path>` lists more, and `git diff --name-only <commit>` lists all.
2. **Map changes to documents.**

   | Changed | Document |
   |---|---|
   | Manifests or CI | `AGENTS.md` |
   | Tokens or components | `design-system.md` |
   | Translation files | `voice-and-tone.md` |
   | New packages | The plan in [monorepo](monorepo.md) |

3. **Propose small diffs for affected parts only.** Read the changed files rather than reanalyzing the scope. Set the stamp to the current `HEAD` in every `AGENTS.md` you change. If nothing is affected, report that the files are current and refresh the stamp after approval.
4. **If the stamp is missing or its commit cannot be found, behave as a first run over existing files.** This covers a rebase, a shallow clone, and `commit=none`. `changedSinceStamp` is null and a warning names the commit. Follow the workflow that `state` selects.

## `ai-memory.md`

- `ai-memory.md` entries are never deleted without approval.
- Flag an entry that looks outdated, for example when the path in `Applies to:` changed or disappeared, and give the reason.
- On a `memory-budget` warning from `validate.mjs`, propose a consolidation as a diff.
