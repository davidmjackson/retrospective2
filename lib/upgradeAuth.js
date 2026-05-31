// Decides whether a WebSocket upgrade is allowed. Pure: takes the auth-client's
// verifySession + the raw Cookie header, returns an allow/deny decision.
async function authenticateUpgrade(verifySession, cookieHeader) {
  const ctx = await verifySession(cookieHeader);
  if (!ctx) return { ok: false, status: 401 };
  if (!ctx.entitled) return { ok: false, status: 401 };
  return { ok: true, context: ctx };
}

module.exports = { authenticateUpgrade };
