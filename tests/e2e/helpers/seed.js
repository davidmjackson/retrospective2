const path = require("path");
const fs = require("fs");
const { createSessionsStore } = require("@suite/auth-client/lib/sessions-db.js");

const DB = path.join(__dirname, "..", ".data", "retro-sessions.db");

function seedSession({
  id = "s-e2e",
  userId = "u-e2e",
  entitled = true,
  teams = [{ id: "t1", name: "Alpha", role: "lead" }],
  company = { id: "co1", name: "Acme" }
} = {}) {
  fs.mkdirSync(path.dirname(DB), { recursive: true });
  const store = createSessionsStore(DB);
  store.delete(id);
  store.create({
    id,
    userId,
    centralSessionId: `c-${id}`,
    expiresAt: Date.now() + 60 * 60 * 1000,
    entitled,
    teams,
    company
  });
  return { id, userId, teams, company };
}

module.exports = { seedSession, DB };
