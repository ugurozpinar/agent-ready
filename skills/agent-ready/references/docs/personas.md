# Rules for `docs/ai/personas.md`

Template: `assets/templates/personas.md`.

## Purpose
Who uses the product, what they are trying to do, and what gets in their way. Agents read it before designing features or flows for users.

## Generate when
The product has identifiable end users. Skip it when it has none, such as a library or internal script, and give the reason in the plan.

## Evidence
Product docs, support notes, interview. Never code alone: routes and roles show what exists, not who uses it or why.

- Personas are fictional archetypes. Name them by role.
- Add a persona only when its goals differ enough to change a design decision.
- Unconfirmed statements make the document `draft`, and they are listed under `## Open questions`. `Status:` and `## Open questions` stay in English in every language.
- When everything is confirmed, set `Status: confirmed` and delete `## Open questions`.

## Questions
- Who uses it?
- What are they trying to achieve?
- What gets in their way today?

## Leave out
- Real names, emails, and customer data
- Demographic filler: age, hobbies, invented biographies

## Good example
```markdown
# Personas

Status: draft

## Personas

### Freelance accountant
Goals: send correct invoices to 10 to 30 clients at month end, with little rework.
Obstacles: client data arrives late and incomplete; tax rules differ per country.

### Client's bookkeeper
Goals: find and download an invoice without creating an account.
Obstacles: rarely logs in, so any extra step ends in an email to the accountant.

## Open questions
- Do bookkeepers ever edit invoices, or only download them?
```
