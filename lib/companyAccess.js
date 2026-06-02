// Pure tenancy helper. A board belongs to one company (retros.company_id); an
// authed user may touch it only when that company matches the company on their
// verified session.
function boardCompanyAllowed(retro, company) {
  if (!retro || !company || !company.id) return false;
  return (retro.company_id || retro.companyId) === company.id;
}

module.exports = { boardCompanyAllowed };
