# Agent instructions — SC4NNER by TAKATAK

SC4NNER is TAKATAK's label studio (product, barcode, print-ready label, scan test). It came out of
`takatakca/takatak-v1` PR #218 on the owner's order of 2026-11-12. Map of what came from where: `docs/ORIGINE.md`.

## Agent board: read FIRST

All agents coordinate on one pinned public issue: https://github.com/takatakca/foodhubca/issues/105
Read its latest comments before any job. Post `CLAIM`, then `UPDATE`, then `PAUSED` or `DONE`.
One line per comment: `STATUS | agent: <name> @ <where it runs> | repo · branch → PR | job | next step`.
The board is public: no secrets, codes, personal or tax data.

## Work log rule (every agent: Claude, Codex, Cursor, people)

1. **Before you start:** read the top of `WORKLOG.md` and the open pull requests. If a line for the same work is
   `active` or has an open PR, do not redo it: continue that branch or pick other work.
2. **Claim it:** add one line at the top of the log with status `active`.
3. **Before you stop:** update your line (`done`, `PR #n`, `blocked: reason`) and the next step. Commit and push it.
4. One line per piece of work, newest first. Format: `YYYY-MM-DD | agent | branch → PR | status | what | next step`

## Git

- Only the owner (Matt) merges to `main`. Work on a branch, open a pull request.
  The first import (2026-11-12) went straight to `main` on the owner's direct order; that was the exception.
- Never force-push, never rewrite pushed history, never discard someone else's uncommitted work.

## Hard rules

- **Public repository:** never commit secrets, tokens, `.env` values, passwords or their hashes, customer data.
- **Nothing invented on a label.** No made-up nutrition values, recipe, origin, harvest proof, GS1 / UPC / EAN number,
  grade, certification or exemption. Missing facts stay empty and the label stays a draft.
- **No compliance claim.** The app records checks the user declares. It never certifies a label, and no agent writes
  that it does. The draft banner stays until the owner's checklist is complete.
- **Not verified means say so.** No printer, scanner or finished jar has been tested until the owner reports it.
  A green build is not a deployment; a deployment is not a print test.
- **The label engine in `src/` is the same code as `takatak-v1/src/lib/inventory`** (only import paths differ).
  Change both in the same pass, or note the difference in `WORKLOG.md` and `docs/ORIGINE.md`.
- **Identity:** TAKATAK V1 stays the identity and customer authority. The single account here belongs to one
  deployment. Do not build a second user directory or CRM in this repo.
- **Deployment:** Coolify on the Contabo server, owner only (`DEPLOY.md`). Agents have no Coolify access. No DNS
  change without the owner. The saved labels live in `/app/data`: never ship a change that drops that volume.
- Brand: `BRAND.md` (electric blue on deep navy; green/amber/red for status only). French first, English alongside.
  The label's own palette (ivory, charcoal, honey) belongs to the client's label, not to the app.

## Checks before every push

`npm run typecheck` · `npm run build` · `npm test`

## Handoff

Keep `WORKLOG.md` current, and `DEPLOY.md` for what the owner must do (Coolify, account, domain, print tests).
