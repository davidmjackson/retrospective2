"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

test("retro's synced Instrument assets match the foundation source", async () => {
  const mod = await import("/var/www/suite/shared/theme/check-theme-drift.mjs");
  const r = mod.driftReport("/var/www/retrospective");
  assert.deepEqual(r.missing, [], "no missing synced assets");
  assert.deepEqual(r.mismatched, [], "no drifted synced assets");
  assert.equal(r.ok, true);
});
