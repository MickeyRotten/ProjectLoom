# caveman-review

One-line PR comments. Location, problem, fix. No throat-clearing.

## What it does

Generates code review comments in `L<line>: <severity> <problem>. <fix>.` format. One line per finding. Severity emoji: 🔴 bug, 🟡 risk, 🔵 nit, ❓ question. Drops "I noticed that...", hedging, and restating what the diff already shows. Keeps exact line numbers, backticked symbols, and concrete fixes.

Auto-clarity: drops terse mode for CVE-class security findings, architectural disagreements, and onboarding contexts where the author needs the *why*. Resumes terse for the rest.

Output only — does not approve, request changes, or run linters.

## How to invoke

```
/caveman-review
```

Also triggers on "review this PR", "code review", "review the diff".

## See also

- [`SKILL.md`](./SKILL.md) — full LLM-facing instructions
- [Caveman source repo](https://github.com/JuliusBrussee/caveman) — overview
