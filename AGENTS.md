# Repository Rules

## Secret Handling
- Never print values from `.env`, `.env.local`, `.env.*`, or any other environment files.
- Never reveal secrets, API keys, passwords, tokens, cookies, service-role credentials, or private URLs in summaries, diffs, logs, command output, screenshots, or final answers.
- When verifying configuration, report only whether a value is `present`, `missing`, or masked.
- If a secret appeared earlier in the conversation or terminal output, do not repeat it.
- Prefer describing the file path and variable name over showing the value.

## Scope
- Apply these rules to every app and package in this repository unless a deeper `AGENTS.md` adds stricter constraints.
