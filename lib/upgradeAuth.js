// Decides whether a WebSocket upgrade is allowed. Dual-path and pure:
//   1. A valid, entitled session (via the auth-client verifySession), OR
//   2. A share token that resolves (via lookupBoardByToken) to an OPEN board.
// lookupBoardByToken(token) returns { id, closed } or null.
async function decideUpgrade(verifySession, cookieHeader, shareToken, lookupBoardByToken) {
  const ctx = await verifySession(cookieHeader);
  if (ctx && ctx.entitled) {
    return { ok: true, anonymous: false, context: ctx };
  }
  if (shareToken && typeof lookupBoardByToken === "function") {
    const board = lookupBoardByToken(shareToken);
    if (board && !board.closed) {
      return { ok: true, anonymous: true, boardId: board.id };
    }
  }
  return { ok: false, status: 401 };
}

module.exports = { decideUpgrade };
