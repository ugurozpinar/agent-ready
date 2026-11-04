# Rules for `docs/ai/product-overview.md`

Template: `assets/templates/product-overview.md`.

## Purpose
What the product is, who it is for, and where its scope ends. Agents read it before product or scope decisions.

## Generate when
`signals.product` is true, or the user describes a product to be built.

## Evidence
README, landing pages, routes.

- Code rarely reveals `## What it is not`, so ask for it.
- Describe each core flow in one line, from the user's point of view.
- Unconfirmed statements make the document `draft`, and they are listed under `## Open questions`. `Status:` and `## Open questions` stay in English in every language.
- When everything is confirmed, set `Status: confirmed` and delete `## Open questions`.

## Questions
- What is it?
- Who is it for?
- What is it not, even if users ask for it?

## Leave out
- Roadmap speculation
- Feature lists that duplicate routes

## Good example
This example shows shape only. Its facts are invented, and nothing from it may be reused.

```markdown
# Product overview

Status: draft

## What it is
Invoicing for freelance accountants who bill clients in the EU.

## Who it is for
Solo accountants and small practices.

## What it is not
Not a general ledger and not a tax filing tool. Exports go to the client's existing system.

## Core flows
- Create an invoice from a client record, then send it by email.
- Export a month of invoices for the client's bookkeeper.

## Open questions
- Are practices above five people in scope?
```
