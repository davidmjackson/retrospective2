const test = require("node:test");
const assert = require("node:assert");
const { authenticateUpgrade } = require("../lib/upgradeAuth");

test("denies when verifySession returns null", async () => {
  const r = await authenticateUpgrade(async () => null, "");
  assert.deepStrictEqual(r, { ok: false, status: 401 });
});

test("denies when not entitled", async () => {
  const r = await authenticateUpgrade(
    async () => ({ userId: "u1", entitled: false, teams: [] }),
    "c"
  );
  assert.deepStrictEqual(r, { ok: false, status: 401 });
});

test("allows and returns context when entitled", async () => {
  const ctx = { userId: "u1", entitled: true, teams: [{ id: "t1", name: "A", role: "lead" }] };
  const r = await authenticateUpgrade(async () => ctx, "c");
  assert.deepStrictEqual(r, { ok: true, context: ctx });
});
