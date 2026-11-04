# Workflow: new project

Applies when `detect.mjs` reports `state: empty`. The evidence is the interview, because there is no code.

## Plan

Ask the opening question before showing the plan, because the answer decides which documents to offer: "Describe the product and who it is for". It counts toward the question limit.

Offer these documents, and list each skipped one with its reason:

| Document | Offer when |
|---|---|
| `AGENTS.md`, `CLAUDE.md` | Always |
| `docs/ai/ai-memory.md` | Always |
| `docs/ai/product-overview.md` | The user describes a product to be built |
| `docs/ai/personas.md` | The product will have identifiable end users |
| `docs/ai/voice-and-tone.md` | User-facing text is planned |
| `docs/ai/design-system.md` | A user interface is planned |

## Language

Generated files default to English. If the user plans the documentation or interface in another language, ask in the plan which language to use. Examples in `voice-and-tone.md` always use the product's language.

## Interview

After the opening question, ask only what is still missing, in this priority order: product, users, voice, interface.

## Write

- Under `## Commands` in `AGENTS.md`, write `None yet.` A planned command is not a command until it exists.
- Write the rest from the answers. Each unanswered topic stays in `## Open questions`, and that document is `draft`.
- Stamp with `commit=none` when the folder is not a git repository or has no commit yet.

## Not a git repository

Continue without git. Recommend `git init`, and do not run it.

## Non-interactive run

Stop and say that answers are needed, because an empty repository has no other information source. If the prompt supplies answers, treat them as the interview and continue.

## Final report

Recommend running an update once code exists, so that commands and evidence reach the documents.
