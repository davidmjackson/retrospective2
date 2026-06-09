// schemas/api.js — JSON API body schemas. CommonJS.
// These routes keep their bespoke 400 bodies (asserted by existing tests);
// schemas coerce/trim only via inline safeParse.
const { z } = require("zod");

const trim = (v) => (typeof v === "string" ? v.trim() : v);

// POST /api/retros
const createRetroSchema = z.object({
  title: z.preprocess(trim, z.string().min(1).max(140))
});

// PUT /api/actions
const updateActionSchema = z.object({
  retroId: z.preprocess(trim, z.string().min(1).max(160).regex(/^[a-zA-Z0-9._:-]+$/)),
  actionId: z.preprocess(trim, z.string().min(1).max(160).regex(/^[a-zA-Z0-9._:-]+$/)),
  status: z.enum(["todo", "in_progress", "blocked", "done"]).optional(),
  notes: z.preprocess(trim, z.string().max(4000)).optional(),
  owner: z.preprocess(trim, z.string().max(80)).optional(),
  dueDate: z.union([
    z.literal(""),
    z.string().max(10).regex(/^\d{4}-\d{2}-\d{2}$/)
  ]).optional()
});

module.exports = { createRetroSchema, updateActionSchema };
