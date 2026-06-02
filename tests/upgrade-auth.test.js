const test = require("node:test");
const assert = require("node:assert");
const { decideUpgrade } = require("../lib/upgradeAuth");

const openBoard = { id: "r1", closed: false };
const lookup = (tok) => (tok === "good" ? openBoard : tok === "closed" ? { id: "r2", closed: true } : null);

test("authed: allows and returns context when session is entitled", async () => {
  const ctx = { userId: "u1", entitled: true, company: { id: "c1", name: "A" } };
  const r = await decideUpgrade(async () => ctx, "cookie", null, lookup);
  assert.deepStrictEqual(r, { ok: true, anonymous: false, context: ctx });
});

test("anon: allows when token resolves to an open board and no session", async () => {
  const r = await decideUpgrade(async () => null, "", "good", lookup);
  assert.deepStrictEqual(r, { ok: true, anonymous: true, boardId: "r1" });
});

test("anon: denies when token resolves to a closed board", async () => {
  const r = await decideUpgrade(async () => null, "", "closed", lookup);
  assert.deepStrictEqual(r, { ok: false, status: 401 });
});

test("denies when no session and no valid token", async () => {
  const r = await decideUpgrade(async () => null, "", "bad", lookup);
  assert.deepStrictEqual(r, { ok: false, status: 401 });
  const r2 = await decideUpgrade(async () => null, "", null, lookup);
  assert.deepStrictEqual(r2, { ok: false, status: 401 });
});

test("denies an un-entitled session even with no token", async () => {
  const r = await decideUpgrade(async () => ({ userId: "u1", entitled: false }), "c", null, lookup);
  assert.deepStrictEqual(r, { ok: false, status: 401 });
});

test("a valid session takes precedence over a token", async () => {
  const ctx = { userId: "u1", entitled: true, company: { id: "c1" } };
  const r = await decideUpgrade(async () => ctx, "c", "good", lookup);
  assert.strictEqual(r.anonymous, false);
});
