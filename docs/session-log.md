# Session Log

Use this log to preserve project context between work sessions. Keep entries concise:
what changed, what was verified, decisions made, and the next useful options.

## 2026-05-20 Remove Dead Admin Lobby Button

### Changed
- Created `fix/admin-lobby-button` from `main`.
- Removed the "Lobby" link from the `/admin` page. `lobby.js` redirects any
  admin straight back to `/admin`, so the button bounced back instead of
  opening the lobby - admins have no lobby workflow.

### Verified
- `git diff --check`; `npm run test:e2e` (5 passed).

### Deployed
- Deployed to production at sprintretro.uk on 2026-05-20 (`main` 5d6c6da);
  smoke-tested that the admin "Lobby" button is gone.

## 2026-05-20 Key Warning and Confirm Modal Deploy

### Changed
- Merged `feature/key-reveal-warning` and `feature/rotate-confirm-modal` into
  `main` (merge commit `e798360`) and deployed it to production at
  sprintretro.uk.
- Front-end-only release: `git pull` plus a service restart - no database
  backup or migration needed.

### Verified
- Merged `main`: `node --check`, `git diff --check`, `npm test`,
  `npm run test:e2e` (5 passed), `npm audit --omit=dev` (0 vulnerabilities).
- `/health` returned `{"status":"ok"}` after the restart.
- Smoke-tested live: the lobby team-key advisory shows and the key is
  one-time, and the admin rotate confirmation uses the styled modal.

### Next
- Delete the merged feature branches on GitHub when convenient.

## 2026-05-20 Admin Confirm Modal

### Changed
- Created `feature/rotate-confirm-modal` from `main`.
- Replaced the browser `window.confirm()` alert used for the admin
  "Rotate key" and "Delete team" actions with a styled in-page confirmation
  modal, consistent with the app's other dialogs.
- Added a reusable promise-based `confirmAction()` helper (title, message,
  confirm-button label); accept, cancel, close, backdrop, and Escape all
  resolve it.
- Updated the admin e2e test to drive the new confirm dialog.

### Verified
- `node --check` on `public/admin.js` and the e2e spec; `git diff --check`.
- `npm test`, `npm run test:e2e` (5 passed), `npm audit --omit=dev`
  (0 vulnerabilities).
- Browser check of the rotate confirmation modal.

### Next
- Deploy with the next release - front-end only, no schema or server change.

## 2026-05-20 One-Time Team Key Reveal

### Changed
- Created `feature/key-reveal-warning` from `main`.
- The lobby "Share This Team Key" panel now carries an advisory: copy and
  share the key now, because it cannot be shown again and a lost key can only
  be replaced by an admin rotating the team.
- Made the generated key one-time - it is no longer written to `localStorage`.
  The panel shows the key only right after creation; reloading or leaving the
  lobby clears it. This also removes the plaintext key from browser storage
  (an exposure flagged in the 2026-05-11 security scan).
- Removed the now-dead `retroTeamKey` localStorage handling from `login.js`;
  the lobby also clears any stale value left by older builds.

### Verified
- `node --check` on `public/lobby.js` and `public/login.js`; `git diff --check`.
- `npm test`, `npm run test:e2e` (5 passed), `npm audit --omit=dev`
  (0 vulnerabilities).
- Browser check: the warning shows on key creation, and the key and panel are
  gone after a reload with nothing left in `localStorage`.

### Next
- Deploy with the next release - this is front-end only, no schema or server
  change.

## 2026-05-20 Key Rotation Production Deploy

### Changed
- Deployed `main` (commit `0d11c9f`) to production at sprintretro.uk.
- On the production host: backed up the live database to
  `/var/www/retros-pre-rotation.db`, fast-forwarded the checkout to `main`,
  reinstalled dependencies, and restarted the `retrospective` service.
- The teams-table migration ran on restart - existing plaintext keys were
  hashed in place, so current keys keep working.

### Verified
- `/health` returned `{"status":"ok"}` after the restart.
- Smoke-tested the live site: an existing team key still logs in, `/admin`
  shows hashed-key status, and rotating a team key works through the reveal
  dialog.

### Next
- Rotate any team still shown as "Weak key" in `/admin` and hand out the new
  keys (old 5-character keys keep working until rotated).
- Consider lengthening `RETRO_ADMIN_KEY` to 12+ characters.

## 2026-05-20 Team Access Key Rotation

### Changed
- Created `feature/team-key-rotation` from `main`.
- Ported Scrum Poker's access-key hardening and rotation to Retrospective
  (see `docs/scrumpoker-key-rotation.md`):
  - Team keys are stored only as salted SHA-256 hashes (`key_hash`,
    `key_salt`) instead of a plaintext `join_key`; logins verify with a
    timing-safe compare.
  - Generated keys are now 12 characters; a `weak` flag marks any key shorter
    than 12 (all migrated 5-character keys, and the admin key if short).
  - Added `POST /api/admin/teams/:id/rotate` and a "Rotate key" admin action:
    a confirm step, then a one-time reveal dialog with a Copy button. Only the
    hash is stored, so the key cannot be retrieved after the dialog closes.
  - The `/admin` team list no longer shows plaintext keys; it shows a key
    status (OK / Weak key).
  - `RETRO_ADMIN_KEY` now accepts 5-64 characters (was exactly 5) and logs a
    warning if shorter than 12. The Admin team cannot be rotated from the
    UI/API - its key is managed through `RETRO_ADMIN_KEY`.
- Added a `teams` table migration that rebuilds the table and hashes each
  existing plaintext key in place, so current keys keep working after deploy.
- Updated the login key field, both e2e specs, and the WebSocket integration
  test (now covers rotation: the old key stops working, the new key works).

### Verified
- `node --check` on all touched JS files; `git diff --check`.
- Standalone migration check: a legacy plaintext-key database migrates to
  hashed storage, old keys still verify, the weak flag is set correctly, and
  rotation invalidates the old key while preserving the team's createdAt.
- `npm test`, `npm run test:e2e` (5 passed), `npm audit --omit=dev`
  (0 vulnerabilities), `db:migrate` / `db:vacuum` on a temp database.
- Visual check of the admin rotation flow and the reveal dialog.

### Decisions
- Rotation blocks future logins with the old key. Existing signed-in sessions
  keep their `retro_auth` cookie until it expires (24h default); forced
  session invalidation was out of scope.
- No rotation audit log was added (deferred by choice).

### Next
- Deploy to production: back up `retros.db`, deploy `main`, restart the app
  (the migration runs automatically on startup). Then rotate any team shown
  as weak in `/admin`.
- Consider lengthening `RETRO_ADMIN_KEY` to 12+ characters in production.

## 2026-05-20 Production Deploy

### Changed
- Deployed `main` (commit `4f01e63`) to production at sprintretro.uk.
- On the production host: backed up the live SQLite database, fast-forwarded
  the checkout to `main`, reinstalled production dependencies with
  `npm ci --omit=dev`, and restarted the `retrospective` service.

### Verified
- `npm ci` reported 0 vulnerabilities; patched `ws@8.20.1` is in place.
- `/health` returned `{"status":"ok"}` after the restart.
- Smoke-tested the live site (login, board, Create Note modal).

### Notes
- The production database is `retros.db` in the app directory; it was copied
  up to `/var/www/` before the deploy.
- `npm run db:migrate` was skipped - this release has no schema change and the
  app re-checks the schema on startup.

### Next
- Delete the merged feature branches on GitHub when convenient.
- Gather user feedback on the lighter board layout after a live retro.

## 2026-05-20 Release Merge to main

### Changed
- Merged `fix/ws-security-advisory` and the `feature/retro-design-refresh`
  chain (design refresh, note composer modal, retrospective instructions
  modal, and earlier unmerged work) into `main`.
- Resolved the `docs/session-log.md` merge conflict by keeping both same-day
  entries; `package-lock.json` resolved to `ws@8.20.1`.

### Verified (on merged `main`)
- `node --check` on all tracked JS files.
- `git diff --check`
- `npm test`
- `npm run test:e2e` (5 passed)
- `npm audit --omit=dev` - 0 vulnerabilities.

### Next
- Deploy `main` to production (sprintretro.uk) with the Release Updates steps
  in `docs/deployment.md`; back up the live SQLite database first, then
  restart the app so the patched `ws` runtime and new features go live.
- After deploy, smoke-test login, the Create Note modal, voting, and timer.

## 2026-05-20 Retrospective Design Refresh

### Changed
- Created `feature/retro-design-refresh` from `feature/note-composer-modal`.
- Removed the decorative card "..." menu icon, which implied an action that
  did nothing.
- De-duplicated metrics: dropped the Retro Health breakdown rows (per-column
  note counts and total votes) that duplicated the column badges and the top
  health strip. The Retro Health panel now shows only the readiness signal
  and latest activity.
- Lightened the sidebar: removed the Actions panel (its links duplicate the
  header) and moved the "Show instructions" button into the header.
- Reduced column and card-list min-heights and added an empty-column
  placeholder so a fresh board is no longer mostly whitespace.
- Made the instruction banner and footer tips bar dismissible (persisted in
  localStorage). Added a global `[hidden]` rule so the attribute reliably
  hides elements that carry a `display` rule - this also fixes participant
  timer controls, which previously stayed visible.
- Added an accessible label to the card vote button.
- Updated `retro-smoke` and `page-shell` e2e specs for the new structure.

### Verified
- `node --check` on `public/client.js` and both e2e specs.
- `git diff --check`
- `npm test`
- `npm run test:e2e` (5 passed)
- Visual check of the refreshed board, empty state, and dismissible chrome.
- `npm audit --omit=dev` still reports the moderate `ws` advisory on this
  branch; the fix lives on `fix/ws-security-advisory` and is not merged here.

### Decisions
- Kept the card "..." menu removed rather than building a real menu; edit and
  delete would need new server-side support and are a separate feature.

### Next
- Gather user feedback on the lighter layout after a live session.

## 2026-05-20 ws Security Advisory Fix

### Changed
- Created `fix/ws-security-advisory` from `main`.
- Ran `npm audit fix`, bumping `ws` 8.18.3 -> 8.20.1 in `package-lock.json`
  to clear advisory GHSA-58qx-3vcg-4xpx (moderate). The `package.json` range
  `^8.17.1` already covered the patched version, so it was not changed.

### Verified
- `npm audit --omit=dev` — 0 vulnerabilities.
- `node --check server.js`
- `npm test`
- `npm run test:e2e` (5 passed)

### Next
- Deploy to production and restart the app so the patched `ws` runtime
  is in use.

## 2026-05-20 Note Composer Modal

### Changed
- Created `feature/note-composer-modal` from `feature/retrospective-instructions-modal`.
- Replaced the inline card composer (note/details/column-select row) with a
  per-column "Create Note" button at the bottom of Start, Stop, and Continue.
- Each button opens a small modal with a single-line note field and a
  resizable multiline details field; the modal header shows the target column.
- Modal uses save (✓) and close (×) icon buttons; the destination column is
  fixed by which column's button was used.
- Updated `retro-smoke` and `page-shell` e2e specs for the new add-note flow.

### Verified
- `node --check` on `public/client.js`, `tests/e2e/retro-smoke.spec.js`,
  `tests/e2e/page-shell.spec.js`.
- `git diff --check`
- `npm test`
- `npm run test:e2e` (5 passed)
- `npm audit --omit=dev` — one pre-existing moderate `ws` advisory
  (GHSA-58qx-3vcg-4xpx, fix available), unrelated to this change.
- Visual check of the column buttons and open modal against the running dev server.

### Decisions
- The "Choose a column" field was dropped: opening the modal from a specific
  column's button already determines the destination, so a chooser is redundant.

### Next
- Decide whether to clear the moderate `ws` advisory with `npm audit fix`.
- Review the modal copy and save/close icon affordance with users after a live session.

## 2026-05-20 Codebase Review

### Changed
- Reviewed the application end to end (server, database layer, browser
  scripts, tests, deployment config). No application code was changed.

### Findings - open punch-list
Dead / leftover code:
- `server.js` `/api/login` builds its response with `createdKey` and
  `createdTeam`, which are declared but never assigned, so the endpoint
  always returns `teamKey: null, createdTeam: false`. The matching branch in
  `login.js` is unreachable. Leftover from before team creation moved to
  `/api/teams`.
- `server.js` `saveState()` is defined but never called.
- `lobby.js` posts a `team` field to `/api/retros` that the endpoint
  ignores (the team is taken from the auth token).

Security (new this review):
- WebSocket messages have no per-connection rate limiting; a client can
  flood `voteCard`/`addCard`, and per-card votes are uncapped to 100,000.
- WebSocket auth is captured once at connect and never re-checked, so an
  expired token keeps a live socket usable (low severity given the 24h TTL).

Security (already tracked in the 2026-05-11 scans, still open):
- Login rate limiting trusts the first `X-Forwarded-For` value.
- 5-character team/admin keys are weak shared secrets.
- Authenticated API responses lack `Cache-Control: no-store`.

Housekeeping:
- README "TODOs" are stale: the `index.html` consolidation is done,
  API/WebSocket tests now exist, and card length limits are implemented.
- `.vscode/extensions.json` is untracked - decide commit vs. gitignore.

### Next
- Triage the punch-list; the dead-code items are low-risk quick wins.
- Trim the resolved entries out of the README "TODOs" section.

## 2026-05-15 Retrospective Instructions Modal

### Changed
- Created `feature/retrospective-instructions-modal` from `feature/live-retro-close-updates`.
- Linked the Retrospective page `Show instructions` button to an in-page modal.
- Added guidance for the suggested retro flow, Start/Stop/Continue columns, voting, timer, participants, retro health, and actions report.
- Added browser coverage that opens and closes the instructions modal from the core retrospective workflow.

### Verified
- Reviewed README/session context, current branch/status, recent commits, and server process state.
- Confirmed no `node server.js` process was running before work began.
- `node --check public/client.js`
- `node --check tests/e2e/retro-smoke.spec.js`
- `git diff --check`
- `npm test`
- `npm run test:e2e`
- `npm audit --omit=dev`

### Next
- Review the modal copy with users after a live session and tune wording if the team wants a more facilitation-led or participant-led guide.

## 2026-05-12 WebSocket Race Fix Checkout Verification

### Changed
- Confirmed `/var/www/retrospective` is on `feature/live-retro-close-updates` at `3765e7c`.
- No application code was changed.

### Verified
- Reviewed README/session context, current branch/status, recent commits, and server process state.
- Confirmed no `node server.js` process was running.
- `npm test`

### Next
- If this checkout represents production deployment, restart the app under its normal process manager and smoke test the lobby close update with two logged-in browser sessions.
- If this is still pre-merge, merge `feature/live-retro-close-updates` to `main` after review and deploy from `main`.

## 2026-05-11 WebSocket Test Race Fix

### Changed
- Fixed the WebSocket/API integration test to buffer early WebSocket messages before the socket `open` promise resolves.
- This prevents the initial retro state message from being missed on faster production hosts.

### Verified
- `node --check tests/ws-operations.test.js`
- `git diff --check`
- `npm test`
- `npm run test:e2e`
- `npm audit --omit=dev`

### Next
- Pull the updated branch on production and re-run `npm test`.

## 2026-05-11 Local Codebase Security Scan

### Changed
- Performed a non-destructive local security review of the Node/Express, WebSocket, SQLite, and browser code paths.
- No application code was changed.

### Verified
- Reviewed README/session context, current branch/status, recent commits, and server process state.
- Reviewed authentication, authorization, WebSocket origin/auth checks, SQLite persistence, DOM rendering, and deployment examples.
- `node --check` on all tracked JavaScript files.
- `git diff --check`
- `npm test`
- `npm run test:e2e`
- `npm audit --omit=dev`
- `npm audit`

### Findings
- Login rate limiting trusts the first `X-Forwarded-For` value, while the example Nginx config appends client-supplied values, allowing spoofed headers to bypass per-IP login throttling.
- Team and admin join keys are limited to 5 lowercase alphanumeric characters, which is too small for a shared secret.
- Local `.env`, `retros.db`, and `state.json` files are present in the web root checkout with broad read permissions; production docs already recommend tighter `.env` permissions and moving the live database outside the repo.
- Authenticated API responses do not set `Cache-Control: no-store`, including responses that contain retro data and team keys.
- Newly generated team keys are stored in browser `localStorage`, increasing impact if a browser/session is compromised.

### Next
- Fix proxy-aware rate limiting by using a trusted proxy source for the real client IP or overwriting `X-Forwarded-For` at the reverse proxy.
- Increase team/admin key length and allow stronger admin key formats before relying on keys as shared secrets.
- Tighten local/production secret and database file permissions and keep live SQLite data outside `/var/www/retrospective`.
- Add no-store cache headers for authenticated API responses.

## 2026-05-11 Live Security Scan

### Changed
- Performed a non-destructive external security baseline against `https://sprintretro.uk/`.
- No application code was changed.

### Verified
- `http://sprintretro.uk/` redirects to HTTPS.
- `https://sprintretro.uk/` serves CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, and `Permissions-Policy` headers.
- `/api/session` and `/api/admin/teams` return `401` without authentication.
- One targeted default admin-key login check returned `403 Invalid admin key`.
- Common accidental exposures returned `404`: `.env`, `retros.db`, `state.json`, `.git/config`, `package.json`, `package-lock.json`, `server.js`, `db.js`, `AGENTS.md`, and `docs/session-log.md`.
- WebSocket checks rejected a foreign Origin and rejected an unauthenticated same-host connection.
- TLS certificate is valid for `sprintretro.uk` and `www.sprintretro.uk`, issued by Let's Encrypt E7, valid from 2026-05-07 to 2026-08-05.
- TLS 1.2 and TLS 1.3 handshakes succeeded with modern ciphers.
- Port check found 80, 443, and SSH port 22 reachable; app port 3001 was not reachable directly.
- `npm audit --omit=dev`
- `npm audit`

### Findings
- HTTPS responses are missing `Strict-Transport-Security`.
- Apache exposes a `Server: Apache` banner on public responses.
- Both apex and `www` hostnames serve the app directly instead of redirecting to one canonical host.
- SSH is reachable publicly and advertises its OpenSSH/Ubuntu banner.

### Next
- Add HSTS at the reverse proxy after confirming all desired subdomains are HTTPS-ready.
- Reduce Apache server token exposure.
- Choose a canonical host and redirect the other hostname.
- Confirm SSH is restricted to trusted source IPs or otherwise hardened with keys-only auth, no password login, and rate limiting.
- Consider `Cache-Control: no-store` for authenticated API responses.

## 2026-05-10 Live Retro Close Updates

### Changed
- Created `feature/live-retro-close-updates` from `main`.
- Added authenticated team-level lobby WebSocket subscriptions.
- Broadcast refreshed lobby retro lists when a retro is created or closed.
- Updated the retrospective page close handler to keep its local state and closed date in sync with the server event.
- Added integration and browser coverage for other logged-in users seeing a retro close without refreshing.

### Verified
- `node --check server.js`
- `node --check public/lobby.js`
- `node --check public/client.js`
- `node --check tests/ws-operations.test.js`
- `git diff --check`
- `npm test`
- `npm run test:e2e`
- `npm audit --omit=dev`

### Decisions
- Lobby clients now subscribe by authenticated team rather than polling or relying on manual refresh.
- The existing board-level `retroClosed` event remains the source of truth for users inside a retrospective.

### Next
- Deploy this fix to production after review/merge.
- Smoke test with two browsers logged into the same team: one facilitator closes from the lobby and another user sees the lobby status become closed immediately.

## 2026-05-10 Project Instructions File

### Changed
- Added root `AGENTS.md` with the standing Retrospective project instructions.
- Added a communication rule to append `; echo` to shell commands that may print output without a trailing newline.
- Added a communication rule to condense production pull/deploy commands where practical.

### Verified
- Documentation-only change.

### Next
- Future sessions should pick up the command-output newline preference from `AGENTS.md`.

## 2026-05-07 Restricted Team Creation

### Changed
- Created `feature/restrict-team-creation`.
- Removed public team-key generation from the login page.
- Public facilitator login can no longer create teams.
- Added authenticated `/api/teams` team creation for facilitators and admins.
- Added a facilitator-only lobby panel for creating new team keys.
- Updated integration and browser tests to cover the restricted team creation flow.

### Verified
- `node --check`
- `git diff --check`
- `npm test`
- `npm run test:e2e`
- `npm audit --omit=dev`
- DB migrate/vacuum check with a temporary SQLite database

### Decisions
- Team keys must only be generated after authentication.
- Admin can create teams for bootstrap and operations; facilitators can create teams from the lobby.

### Next
- Commit, push, merge to `main`, and deploy urgently to production.

## 2026-05-07 Timer Complete Sound

### Changed
- Created `feature/timer-complete-sound`.
- Added generated `public/sounds/timer-complete.wav`.
- Added a preloaded timer-complete audio element to the retro page.
- Replaced the previous generated browser beep with playback of the WAV asset.
- Added browser coverage that the timer sound asset is wired into the page.

### Verified
- `node --check`
- `git diff --check`
- WAV header validation
- `npm test`
- `npm run test:e2e`
- `npm audit --omit=dev`
- DB migrate/vacuum check with a temporary SQLite database

### Decisions
- Timer completion should use a short local WAV file so it works without external assets.
- Audio is unlocked from the user's first page interaction or the facilitator's Start click.

### Next
- Commit, push, merge to `main`, and deploy the update.

## 2026-05-07 Card Creator Initials

### Changed
- Created `feature/card-creator-initials`.
- Cards now store the name of the person who created them.
- Card avatars now use creator initials instead of falling back to card title initials.
- Added a SQLite migration for `cards.created_by`.
- Added integration and browser checks for card creator initials and persistence.

### Verified
- `node --check`
- `git diff --check`
- `npm test`
- `npm run test:e2e`
- `npm audit --omit=dev`
- Fresh DB migrate/vacuum check with a temporary SQLite database
- Schema version `4` to `5` migration check for `cards.created_by`

### Decisions
- Existing cards without creator metadata will show anonymous initials rather than title initials.

### Next
- Commit, push, merge to `main`, and deploy the fix to production.

## 2026-05-07 Proprietary Licence

### Changed
- Created `feature/proprietary-licence`.
- Added a proprietary free-use `LICENSE` naming David Jackson as developer and owner.
- Added a public licence page at `/license`.
- Added a Licence link to the login page footer.
- Added integration and browser checks for the licence page/link.

### Verified
- `node --check`
- `git diff --check`
- `npm test`
- `npm run test:e2e`
- `npm audit --omit=dev`
- DB migrate/vacuum check with a temporary SQLite database

### Decisions
- The app is free to use through an authorised hosted instance.
- The source code remains proprietary and is not open source.

### Next
- Review the licence wording with a legal professional if formal legal assurance is needed.

## 2026-05-07 Deployment Readiness

### Changed
- Created `feature/deployment-readiness`.
- Added unauthenticated `/health` endpoint for uptime and reverse-proxy checks.
- Added `.env.example` for production configuration.
- Added `docs/deployment.md` with go-live, migration, HTTPS, backup, and smoke-test guidance.
- Added example `systemd` and Nginx deployment configs.

### Verified
- `node --check`
- `git diff --check`
- `npm test`
- `npm run test:e2e`
- `npm audit --omit=dev`
- DB migrate/vacuum check with a temporary SQLite database

### Decisions
- Production should run behind a reverse proxy and process manager, not from a manual shell.
- The live SQLite database should be stored outside the Git working tree.

### Next
- Merge the accepted feature branches into `main` before publishing the live repo.
- Confirm final domain and GitHub repository target before live deployment.

## 2026-05-07

### Changed
- Added save feedback to editable Actions Report cards.
- Save button now shows `Saving...`, then `Saved` or `Save failed`.
- Added browser coverage for the successful save message.

### Verified
- `node --check`
- `git diff --check`
- `npm test`
- `npm run test:e2e`
- `npm audit --omit=dev`
- DB migrate/vacuum check with a temporary SQLite database

### Decisions
- Actions Report edits should give immediate visible confirmation after save.

### Next
- Visually review the save feedback in the running app.
- Consider adding timed fade-out or dirty-state indicators later.

## 2026-05-07 Editable Action Report

### Changed
- Created `feature/edit-action-report-details`.
- Made Actions Report cards editable for:
  - owner
  - due date
  - notes
- Extended `/api/actions` updates to persist owner and due date.
- Preserved drag-and-drop status updates while saving the editable fields.
- Expanded integration and browser tests for editing action details after creation.

### Verified
- `node --check`
- `git diff --check`
- `npm test`
- `npm run test:e2e`
- `npm audit --omit=dev`
- DB migrate/vacuum check with a temporary SQLite database

### Decisions
- The Actions Report is now the place to maintain committed follow-up details after creation.
- Status movement and field editing use the same `/api/actions` update endpoint.

### Next
- Visually review the editable Actions Report layout in the running app.
- Consider adding clearer save feedback after changes are saved.
- Consider merging the action branches once reviewed.

## 2026-05-07 Action Details Form

### Changed
- Created `feature/action-details-form`.
- Replaced one-click action creation with a dialog that captures:
  - action title
  - owner
  - due date
  - notes
- Added server-side validation for action owner and due date.
- Displayed action due dates in the Actions Report.
- Expanded integration and browser coverage for owner/due date action creation.

### Verified
- `node --check`
- `git diff --check`
- `npm test`
- `npm run test:e2e`
- `npm audit --omit=dev`
- DB migrate/vacuum check with a temporary SQLite database

### Decisions
- Creating an action should remain deliberate, but now includes enough detail to be useful outside the retro.
- Owner defaults to the current user and can be edited before creation.

### Next
- Review the modal and card layout visually in the running app.
- Consider allowing action owner/due date edits from the Actions Report.
- Merge `feature/action-details-form` after review.

## 2026-05-07 Session Log Setup

### Changed
- Added this session log as the durable project diary.
- Added a README pointer so future sessions start by checking this file.

### Verified
- Documentation-only change; no app runtime tests required.
- Previous session baseline was already healthy:
  - `npm test`
  - `npm run test:e2e`
  - `npm audit --omit=dev`

### Decisions
- Git history remains the technical source of truth.
- This file records session-level context: decisions, verification, and likely next work.

### Next
- Continue updating this file after each meaningful development session.
- Choose the next product improvement before coding.

## 2026-05-07 Baseline Review

### State
- Active branch: `feature/separate-action-items`.
- Working tree was clean at review start.
- No `node server.js` process was running.
- Latest pushed commit: `ce53a75 Separate continue notes from action items`.

### Verified
- `npm test`
- `npm run test:e2e`
- `npm audit --omit=dev`

### Notes
- Removed generated Playwright `test-results/` after the baseline run.
- The app is ready for the next feature branch or continuation of the current feature branch.

## 2026-05-06

### Changed
- Modernized the retrospective UI on `feature/design-polish`.
- Made the timer value prominent and visible above the controls.
- Replaced static retro steps and session timeline with live Retro Health signals.
- Made right-sidebar Actions links look like clear button controls.
- Created `feature/separate-action-items`.
- Separated Start/Stop/Continue notes from committed action items:
  - Continue is now a normal board column.
  - Actions are created deliberately from cards with `Create action`.
  - Actions are stored separately in a new `actions` table.
  - Actions Report only shows deliberate follow-up items.

### Verified
- `node --check`
- `git diff --check`
- SQLite migration to schema version `4`
- `npm test`
- `npm run test:e2e`
- `npm audit --omit=dev`
- DB vacuum

### Decisions
- Start/Stop/Continue is the primary retro board structure.
- Continue notes are feedback or working agreements, not action items by default.
- Actions should represent explicit follow-up commitments.
- The server process should be stopped at the end of a work session unless needed.

### Next
- Improve the `Create action` flow with owner and due date fields.
- Polish the Actions Report UI now that actions are real records.
- Review card layout after adding the `Create action` button.
- Merge `feature/separate-action-items` to `main` when accepted.

## 2026-05-24 — forest-reskin-retro branch

Re-skinned Retrospective to the forest accent (`#2E6F4E`) per
`/var/www/signal/docs/forestbuild-spec.md`. Signal is already live on the
forest palette at https://sprintsignal.uk; this brings Retrospective into
the same colour family.

### What changed
- Palette: `--accent #2E6F4E`, `--bg-warm` cream `#F4ECE0` (the A11Y fix
  for the past-retros list rows that were failing AA on the dark-tan
  background), `--bg` cream `#FDF8EB`, `--surface #FFFFFF`. Added
  `--accent-soft #DEEBE2` and `--accent-deep #245C40`. Shifted `--ok` to
  `#1E5A3A` and `--ok-bg` to `#D7E8DC` per spec §1.3 so success green
  stays visibly distinct from the forest accent. Dropped `--accent-2`
  (was purple) and the four `--pin-*` colour tokens.
- Pinboard layer **neutralised, not deleted**: per the user's directive,
  the `.cork-bg / .washi / .polaroid / .pin / .cork-hero` class names stay
  defined in `theme-retro.css` so `client.js` (which still constructs
  `<li class="card polaroid">` + `<div class="pin pin-*">`) and the HTML
  (which still has `body class="… cork-bg"` and `.cork-hero` on the login
  shell) continue working without edits. But the rule contents are
  rewritten so nothing renders as a corkboard / washi tape / pushpin /
  paper-polaroid — `.cork-bg` is plain cream, `.washi` and `.pin` are
  `display: none`, `.polaroid` is a spec §2.5 card, `.polaroid.fresh`
  switches from the `pin-up` bounce to the cleaner `drift-in` entry.
- Component upgrades in `theme-core.css` per spec §2: `.btn-primary` gets
  the canonical 1px/2px shadow at rest and the `brightness(1.08) +
  translateY(-1px) + 4px shadow` hover lift; input vs button focus rings
  split per §2.1 / §2.4; `.card:hover` halo per §2.5; reduced-motion
  opt-out extended to cover the new lifts on `.btn-primary` / `.card` /
  `.polaroid`.
- `app.css` purple cleanup: rewrote `.primary-btn / #timer-start` and
  `.icon-btn-save` from purple gradients to solid forest with the spec
  §2.1 hover lift; repainted ten decorative purple tints (lobby radial,
  instruction banner, timer readout, avatar, key badge, kanban col 1,
  retro-item hover, etc.) to `accent-soft / accent-deep / forest rgba`
  equivalents; aligned `.status.online / .pill.open / .retro-status.open`
  with spec §2.6 (`accent-soft` bg, `accent-deep` text).

### Verified
- `npm test` — ws-operations integration test + 8 theme-contrast tests
  all pass.
- `npm run test:e2e` — all 5 Playwright specs pass (no visual screenshot
  assertions in this suite, so the colour change required no snapshot
  refresh).
- `npm audit --omit=dev` — 3 moderate pre-existing advisories in the
  qs/body-parser/express dependency chain (not introduced by this branch).
- Dev server smoke: `/` returns 200, `/lobby` returns 200, served CSS
  contains the new forest tokens.

### Branch / commits
- Branch: `forest-reskin-retro`
- `c3cef4e` test: update theme-contrast fixture to forest palette
- `6528e99` Retrospective: re-skin to forest accent per forestbuild-spec.md

### Next
- User does the visual sweep (login, lobby, open retro, actions, admin)
  on return to confirm the pinboard look is gone and the forest accent
  reads correctly.
- Merge PR, then prod-pull on the IONOS box per `docs/deployment.md`.
- Plan: `docs/superpowers/plans/2026-05-24-retrospective-forest-reskin.md`.

## 2026-05-25 — feat-breathing-waves-header branch

Rolled the breathing-waves header band (already shipped on Signal at
https://sprintsignal.uk) into Retrospective using the `retro` palette
baked into `breathing-waves.js`. Handover doc:
`breathing-waves-handover.md` (root); source spec lives in
`/var/www/signal/docs/done/breathing-waves-header-background.md`.

### What changed
- New assets, copied verbatim from Signal so the palettes file stays
  aligned across all three apps:
  - `public/css/breathing-waves.css`
  - `public/breathing-waves.js` (flat path to match Retro's existing
    `public/*.js` convention, not Signal's `public/js/` subdir)
- Six pages wrapped. Each picks up a slim `.topbar` (brand + actions)
  plus a `<header class="header-band">` (eyebrow + title + subtitle)
  carrying the animated canvas:
  - `lobby.html`     — eyebrow "Workspace", `role="none"`
  - `admin.html`     — eyebrow "Workspace", `role="none"`
  - `actions.html`   — eyebrow "Report",    `role="none"`
  - `retrospective.html` — eyebrow "Session", `role="none"`,
    `id="retro-title"` preserved on the new `.header-title` (client.js
    reads it via `document.getElementById`)
  - `license.html`   — eyebrow "Legal", no `role="none"` (no topbar →
    implicit `banner` is the correct landmark)
  - `login.html`     — band nested in `.login-hero` as a hero variant
    (`.login-band` overrides keep the existing oversized hero typography
    and drop the cream background so the band blends with the hero card)
- `app.css`: added `.topbar-lead` (left-side cluster for back-link +
  brand on `actions` / `retrospective`) and `.login-band` overrides.
  Reused the existing `.topbar` from `theme-core.css` and `.title-row`
  already in `app.css`.
- New Playwright spec `tests/e2e/header-waves.spec.js` covers the
  public (`/`, `/license`), admin, and facilitator (lobby + actions)
  paths. Filters the expected `/api/me` 401 emitted by `login.js` on
  the unauthenticated home page so it doesn't pollute the error budget.

### Verified
- `node --check public/breathing-waves.js tests/e2e/header-waves.spec.js`
  — both clean.
- `git diff --check` — no whitespace issues.
- `npm test` — 8 theme-contrast + ws-operations pass.
- `npm run test:e2e` — all 8 specs pass (3 new + 5 existing). Existing
  `page-shell.spec.js` still green, confirming the header restructure
  didn't break the lobby/admin/actions/retrospective interaction tests.
- `npm audit --omit=dev` — same 3 moderate pre-existing qs/body-parser/
  express advisories as the prior session; nothing new from this branch.
- Dev server smoke: `/`, `/license`, `/lobby`, `/admin`, `/actions` all
  return 200; `/css/breathing-waves.css` and `/breathing-waves.js`
  served from the running `node server.js` on port 3001.

### Branch / commits
- Branch: `feat-breathing-waves-header`
- (commit hash filled at commit time)

### Next
- User does the visual sweep on the dev URL: confirm waves drift behind
  each page title, the title remains AA-legible, and the login hero
  doesn't feel shrunk by the new band typography.
- Open PR per AGENTS.md (feature branch + PR, not direct-to-main).
- After merge, prod-pull on the IONOS box per `docs/deployment.md`.
- Scrum Poker rollout (the third app in the breathing-waves trio) is
  still outstanding — same handover doc, palette `poker`.
