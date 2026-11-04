# Rules for `AGENTS.md`

Templates: `assets/templates/agents-md.md` for the root, `assets/templates/package-agents-md.md` for a package.

## Purpose
The one file agents always load, so every line costs tokens on every task. It holds what agents cannot discover: a one-sentence description, commands, non-obvious rules, and when to read the other documents. Bloated context files can lower agent success and raise cost. If a line would not change what an agent does, delete it.

## Generate when
Always, at the root and in each selected package. Write a `CLAUDE.md` beside each one containing the single line `@AGENTS.md`, unless the user declines.

## Evidence
Manifests, CI config, README, CONTRIBUTING, analyst findings.

- Copy a command only if a manifest, Makefile, justfile, or CI config defines it. `validate.mjs` rejects `package.json`, Makefile, and justfile commands that do not exist.
- Remove a command line when that command does not exist. A new project has no commands until they exist. Add another command only when agents need it and cannot guess it.
- Phrase each rule as an instruction, with its reason when the reason is not obvious.
- Unconfirmed statements make the document `draft`, and they are listed under `## Open questions`. `Status:` and `## Open questions` stay in English in every language. `AGENTS.md` has neither, so an unconfirmed statement stays out of it and goes to the final report as an open question.

Filling the template:

- Replace every `{{ar:...}}` marker. `{{ar:commit}}` is the short 7-character hash of the `HEAD` commit at analysis time, or `none` outside git or before the first commit.
- If there are no non-obvious rules, keep the `## Rules` heading and write `None yet.` Do not invent rules.
- Remove the index line of every document that was skipped. Use the chosen paths if the user picked a folder other than `docs/ai/`.
- Do not embed or import other documents. The index only says when to read them.
- Monorepo: replace `{{ar:packages-rule}}` with this line, using a path or glob that covers the package files: "Before working in a package, read its `AGENTS.md` (`packages/*/AGENTS.md`)." Otherwise delete the marker's line.
- Budgets: root 120 lines, package 60 lines, root-to-package chain 32 KiB. Aim well below them.
- Packages hold differences only. Do not repeat a root rule or command that applies unchanged. Under `## Docs`, list files the package owns, or point to the root `AGENTS.md` when it owns none.

## Questions
Any rule agents must follow that the code does not show?

## Leave out
- File tree and stack lists
- Style that a linter or formatter enforces
- Generic advice such as "write clean code" or "add tests"

## Good example
This example shows shape only. Its facts are invented, and nothing from it may be reused.

```markdown
# Tally

Invoicing web app for freelance accountants in the EU.

## Commands
- Test: `pnpm test`
- Lint: `pnpm lint`

## Rules
- Store money as integer cents. Never use floats for amounts.
- Run `pnpm db:generate` after editing `prisma/schema.prisma`; install does not do it.
- Do not edit `src/generated/`; it is overwritten on every build.

## Project docs (read when relevant)
- `docs/ai/ai-memory.md`: before architectural or product decisions. Add an entry
  when you learn something a senior developer new to the project would need and
  cannot get from the code, or when a major decision is made. Commit it with the
  related change.
- `docs/ai/voice-and-tone.md`: before writing user-visible text.

## Keep this file current
If you change build, test, or lint commands, update this file in the same change.

<!-- agent-ready: v=0.1.0 commit=4f2a9c1 -->
```
