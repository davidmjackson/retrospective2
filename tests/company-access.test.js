const test = require("node:test");
const assert = require("node:assert");
const { boardCompanyAllowed } = require("../lib/companyAccess");

const company = { id: "c1", name: "Acme" };

test("boardCompanyAllowed matches the board's company against the user's company", () => {
  // DB-row shape (company_id)
  assert.strictEqual(boardCompanyAllowed({ company_id: "c1" }, company), true);
  assert.strictEqual(boardCompanyAllowed({ company_id: "c9" }, company), false);
  // in-memory normalized shape (companyId)
  assert.strictEqual(boardCompanyAllowed({ companyId: "c1" }, company), true);
  assert.strictEqual(boardCompanyAllowed({ companyId: "c9" }, company), false);
});

test("boardCompanyAllowed denies when board or company is missing", () => {
  assert.strictEqual(boardCompanyAllowed(null, company), false);
  assert.strictEqual(boardCompanyAllowed({ company_id: "c1" }, null), false);
  assert.strictEqual(boardCompanyAllowed({ company_id: "c1" }, {}), false);
});
