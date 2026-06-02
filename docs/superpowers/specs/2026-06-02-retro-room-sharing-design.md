# Retro Room Sharing (slice 3 part 2) — Design

Date: 2026-06-02
Repo: retrospective2 (`/var/www/retrospective`, github.com/davidmjackson/retrospective2, branch `main`)
Status: approved, pre-plan

## Goal

Bring the slice-3 sharing model (already shipped for Poker) to Retro:

1. Collapse the tenant boundary from team to company. Boards become company-scoped; the
   team picker is removed. Every authed member of a company sees every board owned by that
   company.
2. Add an anonymous per-board share link so a person with no account can join one specific
   board (add cards and vote only) via an unguessable link.

This is app-only work. Phase A (the `company {id,name}` contract on the shared
`@suite/auth-client` session, hub exchange) is already built, merged, and deployed to prod
(suite main @f64c295). Retro consumes it through the auth-client symlink; no hub or
auth-client change is required.

## Background / current architecture

- Monolithic `server.js`; persistence in `db.js` (sqlite, schema v6, `retros.team_id NOT NULL`).
- `lib/upgradeAuth.js` (`authenticateUpgrade`) gates the WS upgrade: requires a valid,
  entitled session via the auth-client `verifySession`.
- `lib/teamAccess.js` (`teamIdInTeams`, `boardTeamAllowed`) enforces team tenancy.
- WS connection (`noServer` + `server.on("upgrade")`) sets `ws.hubUserId` and `ws.teams`.
- Lobby lists boards for a chosen team (team-picker via `/api/me`); board view is
  `public/retrospective.html` + `public/client.js`.
- Roles are self-declared (Approach B): the WS `role` query param is clamped to
  `participant` | `facilitator`. The only facilitator-gated action today is the timer.
  `addCard` / `voteCard` / `moveCard` / `createAction` are open to any participant.
  `close` is an authed HTTP route (`POST /api/retros/:id/close`).
- Deploy: svc `retrospective.service`, `User=retrospective`,
  `EnvironmentFile=/var/www/retrospective/.env`, RW path `/var/lib/retrospective`
  (board DB `retros.db` + auth-client `retro-sessions.db`). Port 3001. Grant
  retro -> company sprint-suite already exists.

The deployed auth-client surface (confirmed): `verifySession(cookie)` returns
`{ userId, entitled, teams, company }` and middleware sets
`req.user = { id, entitled, teams, company }`, where `company` is `{ id, name }` or `null`.

## Decisions (from brainstorm 2026-06-02)

1. **Scoping**: collapse team -> company, matching poker. Drop the team picker. `retros.team_id`
   becomes `retros.company_id`.
2. **Existing boards**: clean cut. The schema migration wipes existing board rows and recreates
   the schema with `company_id`. Acceptable because retro boards are disposable / retention-pruned
   and only one pilot company uses retro today.
3. **Anonymous abilities**: add cards + vote ONLY. `moveCard`, `createAction`, `timer`, and
   `close` all require an authed company member. (`moveCard` / `createAction` move from
   "any participant" to "authed only".)
4. **Share token**: auto-minted at board creation; stored on the board row. A "Copy invite link"
   button is always available to any authed member. Token is valid only while the board is open;
   once closed, the link stops working.

## Design

### Schema migration (v7, clean cut)

Bump `schema_version` to 7 in `db.js`. On boot, when stored version < 7:

- Drop existing board data (reuse the `dropLegacyBoardData` pattern: drop `retros`, `cards`,
  `actions`).
- Recreate via `createNormalizedSchema` with the `retros` table changed:
  - `team_id TEXT NOT NULL` -> `company_id TEXT NOT NULL`
  - add `share_token TEXT`
  - add a unique index on `share_token` (`CREATE UNIQUE INDEX ... WHERE share_token IS NOT NULL`).
- Set `schema_version = 7`.

When stored version >= 7, just ensure the schema (idempotent create) as today.

All `db.js` functions that reference team switch to company: `normalizeRetro`
(`teamId` -> `companyId`), `createNormalizedSchema`, `runRetroUpsert`, `loadRetros`,
`createRetroRow`, `getRetrosForTeamId` -> `getRetrosForCompanyId`. Add
`getRetroByShareToken(db, token)`. Carry `share_token` through upsert/load.

### Company contract wiring

- WS upgrade: set `ws.company = context.company` (replace `ws.teams` for access decisions).
- HTTP routes: read `req.user.company`.
- New `lib/companyAccess.js` replacing `lib/teamAccess.js`:
  - `boardCompanyAllowed(retro, company)` = `!!company && (retro.company_id || retro.companyId) === company.id`.

### Share token

- `createRetro` generates a random unguessable token (e.g. crypto random hex) into `share_token`.
- `getRetroByShareToken` resolves a token to a board row.
- Lifecycle gate: a board is joinable by token only while `closed` is false. Closing the board
  does not delete the token; join attempts simply check `retro.closed`. Retention prunes the
  board (and token) later as today.

### WS upgrade: dual-path gate

Generalize `lib/upgradeAuth.js` to `decideUpgrade(verifySession, cookieHeader, shareToken, lookupBoardByToken)`:

- Valid entitled session -> `{ ok: true, anonymous: false, context }`.
- Else, if `shareToken` resolves via `lookupBoardByToken` to an OPEN board ->
  `{ ok: true, anonymous: true, boardId }`.
- Else -> `{ ok: false, status: 401 }`.

In `server.on("upgrade")`: parse the `token` query param, call `decideUpgrade`. On the authed
path set `ws.company = context.company`, `ws.hubUserId = context.userId`, `ws.anonymous = false`.
On the anon path set `ws.anonymous = true`, `ws.company = null`, `ws.anonRetroId = boardId`.

### Authorization matrix

| Action | Anonymous | Authed member |
|---|---|---|
| addCard | yes | yes |
| voteCard | yes | yes |
| moveCard | no | yes |
| createAction | no | yes |
| timer (set/start/stop/reset) | no | yes, `facilitator` role only |
| close board (HTTP) | no (no session) | yes |

- Anon sockets are clamped to `participant` regardless of the `role` param, and bound to their
  one board: the connect `retroId` must equal `ws.anonRetroId`, else reject. Anon cannot join the
  lobby view or any other board.
- `facilitator` remains self-declared but only honored when `ws.anonymous === false`.
- Authed access to a board requires `boardCompanyAllowed(retro, ws.company)`.

### Anonymous join page

New public route `GET /join?token=...` serving `public/join.html` + `public/join.js`
(mirrors poker's `join.html`/`join.js`). The page:

- Asks for a display name (capped 80 chars).
- Opens the WS to `/ws?retroId=<board>&token=<token>&name=<name>&role=participant`.
- Reuses the board view. Facilitator-only controls (timer) and authed-only controls (move card,
  create action) are hidden/disabled for anon.
- If the token does not resolve or the board is closed, shows a friendly "this retro has ended /
  invalid link" message.

The server resolves the token to its board id to render the page (or returns the friendly error).

### Lobby and listing (company-scoped)

- `/api/me` returns `company` (drop the team list from the picker usage; may keep `teams` in the
  payload but it is no longer used for scoping).
- `/api/retros` lists boards for `req.user.company` (no `teamId` param). `POST /api/retros`
  creates a board under `req.user.company.id`. `listRetrosForTeam` -> `listRetrosForCompany`.
- Lobby WS view scopes by company; the lobby room key becomes the company id.
- `/api/actions-report` groups by company instead of team.
- `public/lobby.js` drops the team picker and works against the single company.

### "Copy invite link" UI

On the board view, an always-available button for authed members copies
`${window.location.origin}/join?token=<share_token>`. The board init payload exposes the
share token to authed clients (anon clients do not need it). A `data-` attribute on the board
section carries the token for e2e/copy (mirrors poker's `#poker-room-section[data-share-token]`).

## Edge cases

- Authed user with no company (session predating Phase A, or a grant to a company-less user):
  treated as no access. Lobby shows nothing and prompts re-login. No crash. Existing logged-in
  retro users will have `company: null` until they re-log-in after deploy (same as poker saw).
- Anon connecting to a closed board: rejected at upgrade (token resolves but board closed) and on
  the `/join` page (friendly message).
- Closing a board broadcasts the existing `retroClosed` message; anon sockets are read-only after
  that (all WS mutations check `retro.closed`).
- Anon with a token for board A trying to connect with `retroId` of board B: rejected
  (`retroId !== ws.anonRetroId`).

## Testing (TDD)

Unit:
- `companyAccess.boardCompanyAllowed` (match / mismatch / null company).
- `decideUpgrade`: authed path, anon-token path, closed-board rejection, bad-token rejection.
- Share token: mint on create, resolve by token, no resolve for unknown token.
- Authorization gating per action for anon vs authed (move/createAction/timer denied to anon).
- Schema v7 migration: v6 -> v7 wipes boards and creates `company_id` + `share_token`.

Playwright e2e:
- Authed flow: log in, no team picker, company header visible, create board, Copy invite link
  produces a `/join?token=` URL.
- Anon flow: open the invite link in a fresh context, join by name, add a card and vote;
  confirm timer / move / create-action controls are absent.
- Closed-board link rejected: close the board, the invite link shows the ended message.

## Deploy

App-only, single phase (retrospective2 repo). Follow [[reference-ionos-deploy]] and the
step-by-step command conventions.

1. Tag baseline `pre-retro-room-sharing`.
2. On prod: `git fetch` + `git merge --ff-only origin/main` (or pull) on the retro checkout.
3. `npm install --omit=dev` only if deps changed (auth-client symlink already present).
4. Restart `retrospective.service`.
5. On boot: schema migrates to v7 (wipes existing boards); auth-client `company` column ALTERs
   into `retro-sessions.db` idempotently.
6. Smoke per the e2e flow (authed create + copy link; anon join add+vote; closed link rejected);
   confirm `/health` 200 and the other three apps still launch.

Rollback: `git checkout pre-retro-room-sharing` + restart. Note board data is already wiped by
the v7 migration, so rollback restores code but not pre-migration boards — acceptable given
disposability.

## Reuse references

- Poker spec: `/var/www/scrumpoker` `docs/superpowers/specs/2026-06-02-poker-room-sharing-design.md`
- Poker plan: `docs/superpowers/plans/2026-06-02-poker-room-sharing.md`
- Patterns to adapt: dual-path WS upgrade (`decideUpgrade`), anon clamped to non-facilitator,
  public `/join?token=` page reusing the board view, Copy-invite-link button from
  `window.location.origin`.
