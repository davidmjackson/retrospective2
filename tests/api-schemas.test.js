// tests/api-schemas.test.js — unit tests for schemas/api.js. CommonJS.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { updateActionSchema } = require("../schemas/api.js");

const BASE = { retroId: "abc", actionId: "def" };

// updateActionSchema.dueDate — partial-update semantics
test("updateActionSchema: absent dueDate stays undefined (no silent overwrite)", () => {
  const result = updateActionSchema.safeParse({ ...BASE, status: "done" });
  assert.ok(result.success, "parse should succeed");
  assert.strictEqual(result.data.dueDate, undefined,
    "absent dueDate must be undefined, not injected as empty string");
});

test("updateActionSchema: explicit empty string dueDate is preserved (clear intent)", () => {
  const result = updateActionSchema.safeParse({ ...BASE, dueDate: "" });
  assert.ok(result.success, "parse should succeed");
  assert.strictEqual(result.data.dueDate, "",
    "explicit empty dueDate must be passed through as empty string");
});

test("updateActionSchema: valid date string is preserved", () => {
  const result = updateActionSchema.safeParse({ ...BASE, dueDate: "2026-07-01" });
  assert.ok(result.success, "parse should succeed");
  assert.strictEqual(result.data.dueDate, "2026-07-01",
    "valid date dueDate must pass through unchanged");
});

test("updateActionSchema: invalid date format is rejected", () => {
  const result = updateActionSchema.safeParse({ ...BASE, dueDate: "not-a-date" });
  assert.ok(!result.success, "invalid date format should fail validation");
});
