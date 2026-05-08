# Retrospective to Scrum Poker Handover

Date: 2026-05-08

This document captures the useful product, design, and technical context from the Retrospective app so it can guide the next phase of the Scrum Poker app.

## Executive Recommendation

Build the next Scrum Poker version as a fresh implementation inside the existing `/var/www/scrumpoker` repository, rather than trying to incrementally restyle the current files.

The current Scrum Poker codebase is small and working, so it is useful as a behavioral reference. However, the core app is concentrated in one large `server.js`, one large `public/js/app.js`, Tailwind-heavy markup, in-memory state, no visible automated tests, and a manually managed `keys.json` access model. The Retrospective project now has better patterns for maintainability: explicit auth/session handling, SQLite migrations, focused browser tests, CSP-friendly static assets, deployment docs, and a coherent design system.

Recommended approach:

1. Preserve Scrum Poker behavior: key-based room entry, voter/observer/facilitator roles, card voting, reveal/reset, participant list, and grouped results.
2. Rebuild the structure using Retrospective patterns: small Express app, WebSocket room isolation, tokenized CSS, browser smoke tests, production config, `/health`, and documented deployment.
3. Reuse only the current Scrum Poker assets or logic that still earns its place, especially `public/images/cardback.jpg` and the working WebSocket message concepts.
4. Do not copy Retrospective literally. Scrum Poker should feel like the same family of tools, but its main screen should be a planning session workspace, not a retro board.

## Source Project Baseline

Retrospective source:

- Path: `/var/www/retrospective`
- Source branch at handover creation: `feature/scrum-poker-handover`
- Main baseline commit: `a038aa1 Restrict team creation to signed-in users`
- Current main status before handover branch: synced with `origin/main`
- Existing untracked file left untouched: `.vscode/extensions.json`
- No `node server.js` process was running at session start.

Last verified Retrospective baseline from `docs/session-log.md`:

- `node --check`
- `git diff --check`
- `npm test`
- `npm run test:e2e`
- `npm audit --omit=dev`
- Temporary SQLite migration/vacuum checks

## What Changed In Retrospective

The main work completed in Retrospective that should influence Scrum Poker:

- Modern dashboard-style UI with restrained cards, panels, status pills, and responsive shells.
- Start/Stop/Continue board with realtime cards, voting, and participants.
- Dedicated action creation flow separate from normal board notes.
- Editable Actions Report with owner, due date, notes, status, drag/drop, and save feedback.
- Authenticated team access using signed cookies and generated team keys.
- Restricted team creation so public login cannot generate keys.
- Admin team/key management.
- SQLite persistence with schema migrations and maintenance scripts.
- Local vendor assets for CSP compatibility.
- Health endpoint and deployment guidance.
- Proprietary free-use licence page.
- Browser and WebSocket coverage that exercises real workflows.

## Retrospective Technology

Runtime stack:

- Node.js
- Express 4
- `ws` WebSocket server
- `better-sqlite3`
- `dotenv`
- Vanilla HTML/CSS/JS
- Local Dragula vendor files for drag/drop
- Playwright for browser tests

Important files:

- `server.js`: Express routes, auth token handling, WebSocket room handling, validation, persistence calls.
- `db.js`: schema creation, migrations, data normalization, persistence helpers.
- `public/styles.css`: full visual system and responsive layout.
- `public/login.html`, `public/lobby.html`, `public/retrospective.html`, `public/actions.html`, `public/admin.html`: static page shells.
- `public/login.js`, `public/lobby.js`, `public/client.js`, `public/actions.js`, `public/admin.js`: page behavior.
- `tests/ws-operations.test.js`: starts the app with a temp SQLite DB and tests HTTP/WebSocket flows.
- `tests/e2e/*.spec.js`: Playwright browser workflows.
- `docs/deployment.md`: production checklist.

Important runtime conventions:

- Production requires `RETRO_AUTH_SECRET`.
- Production requires non-default `RETRO_ADMIN_KEY`.
- SQLite path is controlled by `RETRO_DB_PATH`.
- Browser origins for WebSocket can be restricted with `RETRO_ALLOWED_ORIGINS`.
- Retention is optional with `RETRO_RETENTION_DAYS`.
- Static assets are local to support a stricter CSP.

## Retrospective Design Language

The design direction is quiet, operational, and work-focused. It avoids a marketing-style landing page. The first screen is usable app UI, with enough visual polish to feel deliberate.

Core principles:

- Use restrained full-page shells, not decorative hero sections.
- Keep cards and panels at `8px` radius.
- Use subtle borders and light shadows.
- Use status pills for state.
- Use dense but readable layouts for repeated work.
- Keep workflow controls visible and predictable.
- Use semantic accent colors sparingly: green, red, blue, warning, and purple primary.
- Use forms and dashboards that look like internal tools, not a public SaaS landing page.

Primary CSS tokens from `public/styles.css`:

```css
:root {
  color-scheme: light;
  --page: #f8fafc;
  --surface: #ffffff;
  --surface-soft: #f6f8fb;
  --line: #dce3ed;
  --line-strong: #cbd5e1;
  --ink: #101828;
  --muted: #667085;
  --muted-2: #94a3b8;
  --primary: #5b35d5;
  --primary-strong: #4b25c0;
  --primary-soft: #efeaff;
  --green: #1ca35c;
  --green-soft: #edf9f1;
  --green-line: #bfebce;
  --red: #e5484d;
  --red-soft: #fff0f0;
  --red-line: #ffd0d2;
  --blue: #2479d9;
  --blue-soft: #eef7ff;
  --blue-line: #c8e2ff;
  --warning: #f59e0b;
  --radius: 8px;
  --shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.05);
  --shadow-md: 0 14px 34px rgba(15, 23, 42, 0.08);
  --font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

Reusable component classes:

- `.app-header`: consistent page header with title, supporting copy, and right-aligned actions.
- `.page-content`: constrained dashboard content area.
- `.panel`, `.card`: white surfaces with border and light shadow.
- `.primary-btn`, `.secondary-btn`, `.link-btn`: command hierarchy.
- `.status`, `.status-pill`, `.pill`, `.retro-status`: compact state indicators.
- `.field`: form label/input layout.
- `.instruction-banner`: low-noise guidance row.
- `.health-strip`, `.health-card`: numeric session summary cards.
- `.session-sidebar`, `.sidebar-panel`: right-side operational context.
- `.action-dialog`: modal form pattern.

Scrum Poker should reuse the token system and component feel, but not the exact Retrospective board layout.

Suggested Scrum Poker screen mapping:

- Login: keep a two-column shell like Retrospective login, but use Scrum Poker as the brand signal. Show a compact planning-card preview instead of the retro column preview.
- Lobby or room entry: keep access key, room, name, and role, but style it with `.auth-card`, `.field`, and primary/secondary button conventions.
- Session room: use a full-width app header with room name, live status, role, and actions. Main workspace should feature the estimation deck prominently. A right sidebar should show participants, facilitator controls, reveal status, average, and grouped results.
- Voting deck: use physical card styling, but align colors with Retrospective tokens. The current `cardback.jpg` can stay if it looks good against the new palette.
- Results: use compact grouped result panels rather than generic Tailwind rows.
- Footer/legal: keep the licence link, but style it like Retrospective's quiet footer.

## Scrum Poker Current State

Local Scrum Poker source inspected:

- Path: `/var/www/scrumpoker`
- Branch: `master`
- Latest commit: `f4a0091 Reduce scanner noise in frontend comments`
- Working tree: clean
- No `node server.js` process was running during inspection.
- No local `AGENTS.md` found.

Live site inspected:

- URL: `https://www.scrum-poker.uk/`
- Root page returned `200 OK`.
- WebSocket `wss://www.scrum-poker.uk/ws` opened and returned a `yourId` message.
- Response headers include CSP, HSTS, X-Frame-Options, X-Content-Type-Options, and related hardening headers.
- Headers currently expose `Server: Apache`, so the live deployment appears to sit behind Apache or Apache is fronting the Node app.

Current Scrum Poker stack:

- Node.js
- Express 5
- `ws`
- `uuid`
- Local Tailwind CSS file
- Vanilla browser JS
- Access keys stored in local ignored `keys.json`
- `manageKeys.js` for key generation/list/remove

Current app behavior:

- User enters access key, room name, name, and role.
- Roles: `Voter`, `Observer`, `Facilitator`.
- Server combines room and access key internally.
- Access key is validated against values in `keys.json`.
- Rooms and participants are in memory.
- First facilitator generally keeps facilitator role; later facilitator attempts are downgraded unless role changes later.
- Votes are hidden until facilitator reveals them.
- Facilitator can reset votes.
- Facilitator can change other users' roles.
- Disconnect/logout removes user from the room and may reassign facilitator.

Useful current files:

- `server.js`: current realtime behavior and room logic.
- `public/index.html`: current single-page app shell.
- `public/js/app.js`: current client behavior and DOM rendering.
- `public/css/app.css`: card flip and modal styling.
- `public/images/cardback.jpg`: current visual asset worth evaluating for reuse.
- `manageKeys.js`: key management concept, though it should be redesigned.

## Scrum Poker Risks And Gaps

These are not criticisms of the live tool; they explain why a fresh structured build is safer than a restyle-only pass.

- No automated test script exists. `npm test` currently fails because there is no `test` script.
- `node --check server.js` and `node --check public/js/app.js` pass.
- `npm audit --omit=dev` currently reports 4 production dependency vulnerabilities: 3 moderate and 1 high.
- App state is in memory only. Node restart loses rooms, participants, votes, and reveal state.
- Access keys are file-based and manually managed. There is no signed session cookie, login rate limiting, team table, or admin UI.
- `server.js` and `public/js/app.js` are monolithic, which raises regression risk for major UI and behavior changes.
- Design currently lives mostly in Tailwind utility classes embedded in HTML/JS, making theme alignment harder.
- README notes about CSP `unsafe-eval` and `unsafe-inline` appear stale against the current server CSP.
- `animejs` is declared in `package.json` but was not referenced by source search.
- There are stale/unused frontend helpers such as `setHiddenValue`, `getHiddenValue`, `reloadPage`, and unused saved-session variables.
- Room expiry comments are inconsistent with code: comments mention 45 or 30 minutes, while `EXPIRY_MS` is 60 minutes.
- There is no `/health` endpoint visible in the current Scrum Poker app.
- There are no deployment docs at the same level as Retrospective's `docs/deployment.md`.

Do not copy `keys.json` values into documentation or commits. Treat them as secrets.

## Suggested Target Architecture For Scrum Poker

Keep the same lightweight philosophy as Retrospective.

Recommended stack:

- Node.js
- Express
- `ws`
- `better-sqlite3` if persistence/admin/team management is needed
- `dotenv`
- Vanilla HTML/CSS/JS
- Playwright for browser workflows
- A small Node integration test for WebSocket room behavior

Suggested files:

- `server.js`: app bootstrap, routes, WebSocket setup.
- `db.js`: optional SQLite schema and persistence helpers.
- `public/styles.css`: Retrospective-derived design tokens and Scrum Poker components.
- `public/login.html`: access/session entry.
- `public/room.html`: planning room.
- `public/admin.html`: optional key/team management.
- `public/login.js`: login/session behavior.
- `public/room.js`: room WebSocket client and rendering.
- `tests/ws-operations.test.js`: server/API/WebSocket coverage.
- `tests/e2e/scrum-poker-smoke.spec.js`: browser coverage for login, vote, reveal, reset, role behavior.
- `docs/deployment.md`: production runbook.

Potential SQLite model if persistence is needed:

```sql
teams(id, name, join_key, created_at)
rooms(id, team_id, name, created_at, closed, revealed, facilitator_session_id, updated_at)
participants(id, room_id, name, role, connected, vote, joined_at, last_seen_at)
room_events(id, room_id, type, payload_json, created_at)
```

If sessions should stay ephemeral, skip persisted participants/votes but still consider persisting teams/access keys and adding a health endpoint.

## Initial Build Plan For The New Scrum Poker Work

1. Create a feature branch in `/var/www/scrumpoker`.
2. Add baseline tests around the current behavior before changing the UI.
3. Fix or document dependency audit findings.
4. Add `/health`.
5. Split server-side room logic into small helpers before redesigning the screen.
6. Create a Retrospective-aligned CSS token file and remove reliance on Tailwind utility sprawl.
7. Rebuild login and room screens with the new design language.
8. Add browser tests for voter, observer, facilitator, reveal/reset, role change, reconnect/disconnect.
9. Add deployment documentation and production environment notes.
10. Smoke-test the live deployment after release.

## Practical Product Notes For Scrum Poker

The planning poker app should emphasize speed and shared clarity:

- The room name, connection state, role, and facilitator should always be visible.
- The voting deck should be the primary interaction, not a small row inside a generic card.
- Voted/not-voted state should be visible without revealing values.
- Reveal/reset should be visually anchored to the facilitator area.
- Average and grouped results should be easy to scan immediately after reveal.
- Observers should clearly see that they cannot vote but can follow the session.
- Reconnect behavior should be deliberate. If rooms stay in memory, make restart/disconnect expectations clear.

## Verification Notes From This Handover Session

Retrospective:

- Startup context read from `README.md` and `docs/session-log.md`.
- Branch/status/log/process checks completed.
- Screenshot generation was attempted but blocked by a missing local Playwright Chromium dependency (`libnspr4.so`). No screenshot files were produced.

Scrum Poker:

- Local branch/status/log/process checks completed.
- Live root page inspected at `https://www.scrum-poker.uk/`.
- Live WebSocket opened and returned a `yourId` message.
- `node --check server.js` passed.
- `node --check public/js/app.js` passed.
- `npm test` failed because no test script exists.
- `npm audit --omit=dev` reported 4 production vulnerabilities.
