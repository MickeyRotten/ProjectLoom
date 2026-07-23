# caveman-commit

Terse Conventional Commits. Why over what.

## What it does

Generates commit messages in Conventional Commits format. Subject ≤50 chars, hard cap 72. Imperative mood. Body only when the *why* is non-obvious or there are breaking changes. No AI attribution, no "this commit does X", no emoji unless the project uses them. Body always required for breaking changes, security fixes, data migrations, and reverts — future debuggers need the context.

Outputs only the message. Does not stage, commit, or amend.

## How to invoke

```
/caveman-commit
```

Also triggers on phrases like "write a commit", "commit message", "generate commit".

## See also

- [`SKILL.md`](./SKILL.md) — full LLM-facing instructions
- [Caveman source repo](https://github.com/JuliusBrussee/caveman) — overview
