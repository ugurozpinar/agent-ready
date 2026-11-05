# agent-ready

Short, sourced context files for AI coding agents. agent-ready analyzes a repository and creates or updates `AGENTS.md`, a one-line `CLAUDE.md` bridge, shared project memory and product docs. Every statement traces to code, documentation or your answer, and each file stays within a line budget.

## Install

Inside a Claude Code session (2.1.275 or later):

```
/plugin install agent-ready --marketplace ugurozpinar/agent-ready
```

## Usage

Run `/agent-ready:agent-ready` in Claude Code, or ask in plain language, for example "make this repository ready for agents" or "update the agent docs".

Every change to an existing file is shown as a diff and needs your approval. The skill never commits, pushes or deletes files.

## What it runs

The skill tells Claude to run two local Node scripts, which need Node 22.20 or later. If Node is missing, Claude does the same checks by hand and says so in its report.

- `scripts/detect.mjs` reads the repository's file list and manifests to find its state and workspaces.
- `scripts/validate.mjs` checks the generated files for size, broken links, missing commands, leftover markers and secrets.

Both scripts run local `git` commands that only read the repository, such as `git ls-files`, `git log` and `git diff`.

## What it reads and sends

The scripts make no network calls, read no environment variables, install nothing and write nothing. They send no data anywhere. `.env*` and key files are never read.

## More

Full documentation, the Codex install and the tests are in the [repository](https://github.com/ugurozpinar/agent-ready). MIT licensed.
