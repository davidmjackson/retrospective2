async function injectSession(context, sessionId = "s-e2e") {
  await context.addCookies([
    {
      name: "retro_session",
      value: sessionId,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax"
    }
  ]);
}

module.exports = { injectSession };
