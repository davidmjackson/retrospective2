# Session Log

Use this log to preserve project context between work sessions. Keep entries concise:
what changed, what was verified, decisions made, and the next useful options.

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
