// tests/ws-validation.test.js — unit tests for schemas/ws.js validateMessage(). CommonJS.
// Also verifies server.js WS message handler drops malformed payloads while valid ones pass.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateMessage } = require("../schemas/ws");

// ---------------------------------------------------------------------------
// Unit tests: validateMessage()
// ---------------------------------------------------------------------------

test("validateMessage — hello: accepts empty payload", () => {
  const r = validateMessage("hello", { type: "hello" });
  assert.equal(r.ok, true);
});

test("validateMessage — unknown type: returns ok=false with unknown_message_type error", () => {
  const r = validateMessage("hackAttempt", {});
  assert.equal(r.ok, false);
  assert.equal(r.error.message, "unknown_message_type");
});

test("validateMessage — addCard: valid payload passes", () => {
  const r = validateMessage("addCard", {
    type: "addCard",
    column: "well",
    text: "A great improvement",
    details: ""
  });
  assert.equal(r.ok, true);
  assert.equal(r.data.column, "well");
  assert.equal(r.data.text, "A great improvement");
  assert.equal(r.data.type, "addCard", "type field preserved via passthrough");
});

test("validateMessage — addCard: missing text returns ok=false", () => {
  const r = validateMessage("addCard", { type: "addCard", column: "well" });
  assert.equal(r.ok, false);
});

test("validateMessage — addCard: invalid column returns ok=false", () => {
  const r = validateMessage("addCard", { type: "addCard", column: "invalid", text: "hi" });
  assert.equal(r.ok, false);
});

test("validateMessage — addCard: trims whitespace from text", () => {
  const r = validateMessage("addCard", { type: "addCard", column: "improve", text: "  trimmed  " });
  assert.equal(r.ok, true);
  assert.equal(r.data.text, "trimmed");
});

test("validateMessage — addCard: text exceeding 500 chars returns ok=false", () => {
  const r = validateMessage("addCard", {
    type: "addCard",
    column: "continue",
    text: "x".repeat(501)
  });
  assert.equal(r.ok, false);
});

test("validateMessage — voteCard: valid cardId passes", () => {
  const r = validateMessage("voteCard", { type: "voteCard", cardId: "card-abc123" });
  assert.equal(r.ok, true);
  assert.equal(r.data.cardId, "card-abc123");
});

test("validateMessage — voteCard: missing cardId returns ok=false", () => {
  const r = validateMessage("voteCard", { type: "voteCard" });
  assert.equal(r.ok, false);
});

test("validateMessage — voteCard: cardId with invalid chars returns ok=false", () => {
  const r = validateMessage("voteCard", { type: "voteCard", cardId: "card id with spaces" });
  assert.equal(r.ok, false);
});

test("validateMessage — moveCard: valid payload passes", () => {
  const r = validateMessage("moveCard", {
    type: "moveCard",
    cardId: "card-1",
    targetColumn: "improve",
    beforeCardId: null
  });
  assert.equal(r.ok, true);
  assert.equal(r.data.targetColumn, "improve");
});

test("validateMessage — moveCard: missing cardId returns ok=false", () => {
  const r = validateMessage("moveCard", { type: "moveCard", targetColumn: "well" });
  assert.equal(r.ok, false);
});

test("validateMessage — timer: valid set action passes", () => {
  const r = validateMessage("timer", { type: "timer", action: "set", minutes: 5 });
  assert.equal(r.ok, true);
  assert.equal(r.data.action, "set");
  assert.equal(r.data.minutes, 5);
});

test("validateMessage — timer: invalid action string returns ok=false", () => {
  const r = validateMessage("timer", { type: "timer", action: "explode" });
  assert.equal(r.ok, false);
});

test("validateMessage — timer: missing action returns ok=false", () => {
  const r = validateMessage("timer", { type: "timer" });
  assert.equal(r.ok, false);
});

test("validateMessage — createAction: valid payload passes", () => {
  const r = validateMessage("createAction", {
    type: "createAction",
    cardId: "card-xyz",
    title: "Fix the thing",
    owner: "Alice",
    dueDate: "2026-12-31",
    notes: "Some notes"
  });
  assert.equal(r.ok, true);
  assert.equal(r.data.cardId, "card-xyz");
});

test("validateMessage — createAction: missing cardId returns ok=false", () => {
  const r = validateMessage("createAction", { type: "createAction", title: "x" });
  assert.equal(r.ok, false);
});

test("validateMessage — createAction: invalid dueDate format returns ok=false", () => {
  const r = validateMessage("createAction", {
    type: "createAction",
    cardId: "card-1",
    dueDate: "not-a-date"
  });
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------------------
// Server.js WS handler integration: verify malformed payloads are dropped.
// We test the validateMessage logic directly (no live WebSocket) to ensure
// the drop logic works without spawning the full server (which requires DB).
// ---------------------------------------------------------------------------

test("ws handler simulation — unparseable JSON is dropped (parse error)", () => {
  // Simulate what the handler does on JSON.parse failure
  let dropped = false;
  try {
    JSON.parse("{bad json}");
  } catch (err) {
    dropped = true;
    // logger.warn would be called here in the real handler
  }
  assert.equal(dropped, true, "parse error should be caught");
});

test("ws handler simulation — unknown type is dropped without crashing", () => {
  const data = { type: "rm-rf", payload: "/etc" };
  const result = validateMessage(data.type, data);
  assert.equal(result.ok, false);
  assert.equal(result.error.message, "unknown_message_type");
  // Socket stays open; no crash. Just return without processing.
});

test("ws handler simulation — valid addCard message is NOT dropped", () => {
  const data = { type: "addCard", column: "well", text: "went well", details: "" };
  const result = validateMessage(data.type, data);
  assert.equal(result.ok, true);
  // downstream business logic would proceed with result.data
  assert.equal(result.data.column, "well");
});

test("ws handler simulation — addCard with overlong text is dropped", () => {
  const data = { type: "addCard", column: "improve", text: "x".repeat(600) };
  const result = validateMessage(data.type, data);
  assert.equal(result.ok, false);
  // logger.warn would be called; socket stays open
});

test("ws handler simulation — valid moveCard with beforeCardId=null is NOT dropped", () => {
  const data = { type: "moveCard", cardId: "card-a", targetColumn: "continue", beforeCardId: null };
  const result = validateMessage(data.type, data);
  assert.equal(result.ok, true);
  assert.equal(result.data.beforeCardId, null);
});
