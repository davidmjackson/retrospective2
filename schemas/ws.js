// schemas/ws.js — WebSocket inbound message validation. CommonJS.
// validateMessage(type, payload) -> { ok: true, data } | { ok: false, error }
const { z } = require("zod");

const COLUMN = z.enum(["well", "improve", "continue", "action"]);
const ID_RE = /^[a-zA-Z0-9._:-]+$/;
const idField = z.string().min(1).max(160).regex(ID_RE);
const trim = (v) => (typeof v === "string" ? v.trim() : v);

// All schemas use .passthrough() so that the `type` field (and any other
// fields read by downstream handlers) are preserved in the parsed output.
const SCHEMAS = {
  // hello — no payload fields required beyond type
  hello: z.object({}).passthrough(),

  // timer — action is mandatory; minutes is optional (required by set/start sub-actions but
  // checked at the business-logic layer after validation passes the shape check)
  timer: z.object({
    action: z.enum(["set", "start", "stop", "reset"]),
    minutes: z.number().finite().optional()
  }).passthrough(),

  // addCard — column + text required; details optional
  addCard: z.object({
    column: COLUMN,
    text: z.preprocess(trim, z.string().min(1).max(500)),
    details: z.preprocess(trim, z.string().max(2000)).optional().default("")
  }).passthrough(),

  // voteCard — cardId required
  voteCard: z.object({
    cardId: idField
  }).passthrough(),

  // moveCard — cardId + targetColumn required; beforeCardId optional (null allowed)
  moveCard: z.object({
    cardId: idField,
    targetColumn: COLUMN,
    beforeCardId: z.union([idField, z.null()]).optional().default(null)
  }).passthrough(),

  // createAction — cardId required; remaining fields are optional
  createAction: z.object({
    cardId: idField,
    title: z.preprocess(trim, z.string().max(500)).optional().default(""),
    owner: z.preprocess(trim, z.string().max(80)).optional().default(""),
    dueDate: z.preprocess(
      (v) => (v === undefined || v === null || v === "" ? "" : v),
      z.union([z.literal(""), z.string().max(10).regex(/^\d{4}-\d{2}-\d{2}$/)])
    ).optional().default(""),
    notes: z.preprocess(trim, z.string().max(4000)).optional().default("")
  }).passthrough()
};

function validateMessage(type, payload) {
  const schema = SCHEMAS[type];
  if (!schema) return { ok: false, error: new Error("unknown_message_type") };
  const r = schema.safeParse(payload);
  return r.success ? { ok: true, data: r.data } : { ok: false, error: r.error };
}

module.exports = { validateMessage, SCHEMAS };
