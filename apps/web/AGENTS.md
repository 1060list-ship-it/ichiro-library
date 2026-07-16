<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Secret Handling
- Never print values from `.env`, `.env.local`, `.env.*`, or any other environment files.
- Never reveal secrets, API keys, passwords, tokens, cookies, service-role credentials, or private URLs in summaries, diffs, logs, command output, screenshots, or final answers.
- When verifying configuration, report only whether a value is `present`, `missing`, or masked.
- If a secret appeared earlier in the conversation or terminal output, do not repeat it.
- Prefer describing the file path and variable name over showing the value.

## Playwright / E2E execution constraint
- Codex sandbox environments (`run_agent.sh` 経由の Codex agent 実行) cannot launch Chromium: `MachPortRendezvousServer ... Permission denied (1100)` occurs even with `--workers=1`. This is a sandbox-level macOS entitlement restriction, not a code or test bug.
- Run `npx playwright test` (UI/E2E specs that need a real browser) from the maintainer's own Terminal, not via a Codex agent.
- Codex agents may still be used to run `npm run build`, `npm run db:reset`, and `npm run seed:test-users`. Only the actual browser launch step is blocked.
- For local E2E setup, never run raw `supabase db reset`. Run `npm run db:reset` from `apps/web`; it resets only the local database, restores `TEST_ADMIN_*` / `TEST_EDITOR_*`, assigns roles, and verifies both Auth logins. `seed:test-users` is only for repairing fixtures without a reset. See README.md.
