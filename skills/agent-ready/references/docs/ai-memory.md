# Rules for `docs/ai/ai-memory.md`

Template: `assets/templates/ai-memory.md`.

## Purpose
What a senior developer new to the project needs to know and cannot get from the code, including non-technical knowledge. Agents read it before architectural or product decisions, and add to it when a major decision is made.

## Generate when
Always. If there is nothing to record yet, leave the headings empty rather than filling them.

## Evidence
ADRs, significant history (reverts, migrations, removed features), interview.

- Every entry traces to a document, a commit, or a user answer. Do not guess why something was done.
- Unconfirmed statements make the document `draft`, and they are listed under `## Open questions`. `Status:` and `## Open questions` stay in English in every language. `ai-memory.md` has neither, so an unconfirmed statement stays out of it and goes to the final report as an open question.
- Budget: 200 lines. Over budget, propose consolidating entries.
- Keep the template's "How to use this file" section as it is. Later agents follow it.
- On updates, change an outdated entry instead of adding a contradicting one, and never delete an entry without approval.

## Questions
- What should a senior joining next week hear first?
- What was tried and rejected?

## Leave out
- Anything derivable from code: structure, dependencies, what a function does
- Task status, TODOs, and plans
- Personal preferences

## Good example
```markdown
## Constraints

### 2026-03-12: Invoices stay in EUR only
Type: constraint
Why: Finance reconciliation is EUR-only until the contract ends in 2027.
Applies to: billing/

## Tried and rejected

### 2026-05-02: Background PDF rendering with a queue
Type: rejected
Why: Clients download right after sending, and the delay caused duplicate sends. Rendering stays synchronous.
Applies to: invoices/pdf/
```
