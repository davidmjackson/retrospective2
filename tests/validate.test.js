// tests/validate.test.js — unit tests for lib/validate.js. CommonJS.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const { validate } = require("../lib/validate");

// Minimal Express-style req/res/next helpers
function makeReq(body) {
  return { body };
}

function makeRes() {
  const res = {
    _status: null,
    _json: null,
    status(s) { this._status = s; return this; },
    json(body) { this._json = body; return this; }
  };
  return res;
}

test("validate — success: replaces req.body with parsed output and calls next()", (t, done) => {
  const schema = z.object({ name: z.string().trim().min(1) });
  const mw = validate(schema);
  const req = makeReq({ name: "  alice  " });
  mw(req, makeRes(), (err) => {
    assert.ok(!err, "next should be called without error");
    assert.equal(req.body.name, "alice", "body should be coerced");
    done();
  });
});

test("validate — failure without onInvalid: calls next(err) with status 400 and err.fields", (t, done) => {
  const schema = z.object({ name: z.string().min(1) });
  const mw = validate(schema);
  const req = makeReq({ name: "" });
  mw(req, makeRes(), (err) => {
    assert.ok(err, "next should be called with an error");
    assert.equal(err.status, 400);
    assert.ok(err.fields, "err.fields should be present");
    assert.ok(Array.isArray(err.fields.name), "err.fields.name should be an array");
    done();
  });
});

test("validate — failure with onInvalid: calls onInvalid instead of next(err)", (t, done) => {
  const schema = z.object({ title: z.string().min(1) });
  let onInvalidCalled = false;
  const onInvalid = (req, res, _zodErr) => { onInvalidCalled = true; done(); };
  const mw = validate(schema, { onInvalid });
  const req = makeReq({ title: "" });
  mw(req, makeRes(), (err) => {
    // next should NOT be called when onInvalid is present
    assert.fail("next() should not be called when onInvalid is provided");
  });
  // onInvalid is synchronous; done() called inside it
});

test("validate — source: validates req.query when source='query'", (t, done) => {
  const schema = z.object({ q: z.string().min(1) });
  const mw = validate(schema, { source: "query" });
  const req = { body: {}, query: { q: "hello" } };
  mw(req, makeRes(), (err) => {
    assert.ok(!err);
    assert.equal(req.query.q, "hello");
    done();
  });
});

test("validate — strips unknown keys from the parsed body", (t, done) => {
  const schema = z.object({ a: z.string() });
  const mw = validate(schema);
  const req = makeReq({ a: "x", secret: "should be stripped" });
  mw(req, makeRes(), (err) => {
    assert.ok(!err);
    assert.equal(req.body.a, "x");
    assert.ok(!("secret" in req.body), "unknown key should be stripped");
    done();
  });
});
