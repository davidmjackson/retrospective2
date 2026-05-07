# Retrospective Board

Simple realtime retrospective board with a lobby, live board, and actions report.

## Overview
- Login collects name, role, team, and a shared team key (stored in localStorage).
- Lobby lists retros, allows facilitators to create and close retros.
- Retrospective board supports Start/Stop/Continue notes, details, votes, drag/drop, and a shared timer.
- Actions are created deliberately from retro notes and aggregated across teams in a simple kanban view.

## Tech Stack
- Node.js + Express
- WebSocket (ws)
- Vanilla HTML/CSS/JS

## Run Locally
```bash
npm install
npm start
```
Open `http://localhost:3001` (or the configured host/port).

## Key Routes
- `/` login
- `/lobby` retro list and create
- `/retrospective` live board
- `/actions` actions report
- `/admin` admin dashboard
- `/api/login` create session cookie
- `/api/logout` clear session cookie
- `/api/session` return active session
- `/api/retros` list/create retros
- `/api/retros/:id` load retro
- `/api/retros/:id/close` close retro
- `/api/actions-report` list action items
- `/api/actions` update action status/notes
- `/api/admin/teams` list all teams (admin only)
- `/api/admin/teams/:id` delete a team (admin only)
- `/health` unauthenticated runtime health check
Authentication uses a signed `retro_auth` cookie issued by `POST /api/login`.
Set `RETRO_AUTH_SECRET` in production so sessions survive restarts.
Set `RETRO_ALLOWED_ORIGINS` to a comma-separated list of allowed browser origins
when serving the app behind a known domain.
Login rate limiting defaults to 20 failed attempts per 15 minutes per IP/role/team.
Tune with `RETRO_LOGIN_RATE_LIMIT_MAX` and `RETRO_LOGIN_RATE_LIMIT_WINDOW_MS`.

## Deployment
- Use `.env.example` as the starting point for production configuration.
- See `docs/deployment.md` for the go-live checklist, `systemd` service example,
  Nginx reverse proxy example, database migration, and backup guidance.

## Team Access Keys
- Team names are case-insensitive and unique.
- Facilitators can create a new team; the system generates a 5-character key (lowercase letters + digits).
- Participants and facilitators joining an existing team must provide the team key.
- The generated key is displayed once in the lobby for facilitators (copy/share with the team).
- Admin role uses the `Admin` team with a fixed key set via `RETRO_ADMIN_KEY` (default `admin`).

## Data Notes
- State is persisted in `retros.db` (SQLite) and loaded on server start.
- If the database is empty and `state.json` exists, the server seeds SQLite from it once.
- `state.json` is ignored; `state.sample.json` provides a seed for reference.
- Configure the database path with `RETRO_DB_PATH` (defaults to `./retros.db`).
- Configure retention with `RETRO_RETENTION_DAYS` to delete closed retros older than the cutoff.

## Database Maintenance
- Run migrations: `npm run db:migrate`
- Apply retention cleanup: `RETRO_RETENTION_DAYS=30 npm run db:retention`
- Vacuum database: `npm run db:vacuum`

## Session Log
- Review `docs/session-log.md` at the start of each session for recent decisions,
  verification, and next-step options.

## TODOs
- Decide whether `state.json` should be committed or replaced with a seed file.
- Remove or consolidate duplicate board markup (`public/index.html` vs `public/retrospective.html`).
- Add tests for API endpoints and WebSocket updates.
- Add basic validation/limits for card text/details length.
- Consider adding analytics views over the normalized schema.

## Change Log
- 2026-01-13: Reviewed current diffs and noted uncommitted changes in lobby UI, routing, styles, and state persistence.
- 2026-01-13: Documented guidance on README tracking and `index.html` vs `retrospective.html` consolidation decision.
- 2026-01-13: Removed unused `public/index.html` to keep a single board template at `public/retrospective.html`.
- 2026-01-13: Ignored `state.json` and added `state.sample.json` seed data.
