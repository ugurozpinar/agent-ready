# Rules for `docs/ai/design-system.md`

Template: `assets/templates/design-system.md`.

## Purpose
Where the visual truth lives and which patterns to reuse, so agents do not invent colors or rebuild components. Agents read it before changing the interface.

## Generate when
`signals.ui` is true, or an interface is planned.

## Evidence
Tailwind or theme config, token files, component folders, Storybook.

- Point, don't copy: write "tokens live in `tailwind.config.ts`". Copied values go stale.
- A pattern needs a real use in the code, or a user answer if it is only planned.
- Unconfirmed statements make the document `draft`, and they are listed under `## Open questions`. `Status:` and `## Open questions` stay in English in every language.
- When everything is confirmed, set `Status: confirmed` and delete `## Open questions`.

## Questions
Where is the visual source of truth?

## Leave out
- Copies of token values
- Component lists that repeat the component folder or Storybook

## Good example
```markdown
# Design system

Status: draft

## Sources of truth
- Tokens live in `tailwind.config.ts`.
- Components live in `src/components/ui/`, with stories in Storybook.

## Patterns
- Forms use `FormField` for labels and errors.
- Destructive actions confirm through `ConfirmDialog`.

## Rules
- Use a component from `src/components/ui/` before writing a new one.
- Do not write raw hex colors. Add a token instead.

## Open questions
- Figma and Storybook disagree on button sizes. Which one wins?
```
