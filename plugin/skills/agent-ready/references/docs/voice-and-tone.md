# Rules for `docs/ai/voice-and-tone.md`

Template: `assets/templates/voice-and-tone.md`.

## Purpose
How the product speaks to its users, so agent-written text matches the text that already exists. Agents read it before writing user-visible text.

## Generate when
`signals.userText` is true, or user-facing text is planned.

## Evidence
UI strings, locale files, marketing copy.

- Quote real copy under `## Do and don't`. Examples use the product's language, even when the rest of the document is in English.
- Take `## Terminology` from words the product actually uses. A preferred term the copy does not show needs a user answer.
- Unconfirmed statements make the document `draft`, and they are listed under `## Open questions`. `Status:` and `## Open questions` stay in English in every language.
- A tone inferred from copy alone is unconfirmed until the user agrees with it.
- When everything is confirmed, set `Status: confirmed` and delete `## Open questions`.

## Questions
- How formal is the product, and does it address users directly?
- Which languages does it ship in, and which is the source?
- Which terms are banned?

## Leave out
- Generic tone advice with no real example, such as "be clear and friendly"
- Grammar rules a style guide already covers
- Copies of strings that live in locale files, beyond the few quoted as examples

## Good example
This example shows shape only. Its facts are invented, and nothing from it may be reused.

```markdown
# Voice and tone

Status: draft

## Principles
- Say what happened and what to do next. Accountants read errors while working to a deadline.

## Terminology
- "client", never "customer". "invoice", never "bill".

## Do and don't
- Do: "Invoice 1042 was not sent. Add the client's email and try again."
- Don't: "Oops! Something went wrong."

## Languages
English is the source. German lives in `locales/de.json`.

## Open questions
- Should German copy use "du" or "Sie"? The app mixes both.
```
