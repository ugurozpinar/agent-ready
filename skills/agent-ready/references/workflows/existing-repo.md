# Workflow: existing repository

Applies when `detect.mjs` reports `state: single`, and to each scope of a monorepo.

## Evidence order

Take each fact from the first source that settles it:

1. Code: manifests, config, entry points, tests
2. README and CONTRIBUTING
3. CI config
4. ADRs
5. Existing instruction files
6. Interview, for what the sources above leave open, in this priority order: product, users, voice, interface

## Plan

- Treat `signals` and `commandCandidates` as hints. Confirm them against the sources, and let the user override any of them.
- List each skipped document with its reason. The user can request it anyway.
- Use the `kind` in `instructionFiles` to pick a row of the table below.

## Language

Generated files default to English. If the repository's documentation or interface uses another language, ask in the plan which language to use. Examples in `voice-and-tone.md` always use the product's language.

## Existing files

Human-written content is never silently changed or removed. Each change below is shown as a diff first.

| Found | Behavior |
|---|---|
| Hand-written `AGENTS.md` | Keep it, add what is missing and the stamp, and offer shortening separately |
| `CLAUDE.md` with content, no `AGENTS.md` | Propose moving general content to `AGENTS.md`, keeping Claude-specific content under `@AGENTS.md`. If refused, add only the bridge line `@AGENTS.md` to the `CLAUDE.md` |
| Both present and conflicting | Show the conflicts; the user resolves them |
| `CLAUDE.md` symlinked to `AGENTS.md` | Leave as is; new bridges use imports |
| `.cursorrules`, `copilot-instructions.md` | Read as evidence, never modify |
| `CLAUDE.local.md`, `AGENTS.override.md` | Never modify; warn about `AGENTS.override.md` |
| Existing `docs/ai/*.md` | Merge, keeping human content |
| `docs/` is a published site | See below |

## Published docs site

When `publishedDocsSite` is not null, ask for a folder other than `docs/ai/`, because personas and memory could become public. Write there, and have `AGENTS.md` index the chosen paths.

## Large repository

When `recommendedStrategy` is `parallel` and there is no workspace:

1. Propose up to 5 subsystems in the plan, chosen by `hotDirs` and file count. The user can change them.
2. Run one `repo-analyst` for each, with the subsystem path as `<scope>`.
3. List everything left out as not analyzed in the final report.

Use `detect.mjs --scope <path>` for detail on one subsystem.
