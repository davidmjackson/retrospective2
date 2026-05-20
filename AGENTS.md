# AGENTS.md instructions for /var/www/retrospective

For the Retrospective app project:

At the start of each work session:
- Work in `/var/www/retrospective`.
- Read `README.md` and `docs/session-log.md` before planning or coding.
- Check the current git branch, working tree status, latest commits, and whether any `node server.js` process is running.
- Summarize the current state, last verified baseline, and recommended next steps before making substantial changes.

Git workflow:
- For coding work, create or use an appropriate feature branch.
- Do not work directly on `main` unless I explicitly ask.
- Do not overwrite or revert changes I made unless I explicitly request it.
- After implementation, run relevant checks/tests, commit with a clear message, and push the branch.

Server workflow:
- You may stop and start `node server.js` when needed.
- At the end of a development piece, restart the app if useful for testing.
- At the end of the day/session, stop project server processes unless I ask to keep them running.

Testing:
- Run relevant checks for the change.
- For app-wide or workflow changes, run:
  - `node --check` on touched JS files
  - `git diff --check`
  - `npm test`
  - `npm run test:e2e`
  - `npm audit --omit=dev`
- For database changes, also run migration/vacuum checks.

Session log:
- Keep `docs/session-log.md` updated after meaningful work sessions.
- Log what changed, what was verified, important decisions, branch/commit context, and useful next steps.
- Treat git history as the technical source of truth and the session log as the human-readable project memory.

Communication:
- Keep updates concise and practical.
- Explain what you are doing and why while working.
- At the end, report branch, commit hash, tests run, push status, and server status.
- When providing code to run or steps for me to action provide them one at a time so I have time to execute your requests. This means if a step fails you can help troubleshoot the issue before moving on to the next step.
- When providing production pull/deploy commands, condense related commands together where practical, while keeping risky or troubleshooting steps separate when sequential confirmation is useful.
- When providing shell commands that may print output without a trailing newline, append `; echo` so the shell prompt appears on a new line. For example: `curl -fsS http://127.0.0.1:3001/health; echo`.
