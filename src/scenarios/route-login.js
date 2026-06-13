// src/scenarios/route-login.js
export default {
  id: "route-login",
  category: "route",
  title: "POST /api/login — DB + bcrypt",
  route: "POST /api/login",
  description:
    "Look up the user (DB I/O), then verify the password with bcrypt. bcrypt is CPU-heavy " +
    "but Node runs it on the libuv thread pool, so the event loop stays responsive.",
  tags: ["DB", "crypto", "thread-pool"],
  watchFor: "bcrypt appears as a crypto task on the thread pool — not blocking the main thread.",
  code: [
    "app.post('/api/login', async (req, res) => {",          // 0
    "  const user = await db.query('SELECT ... WHERE email'); ", // 1
    "  const ok = await bcrypt.compare(pw, user.hash);",      // 2
    "  res.json({ ok });",                                     // 3
    "});",                                                      // 4
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "POST /api/login", label: "POST /api/login", line: 0,
      explanation: "Incoming login request" });
    api.call("loginHandler", { line: 0, type: "async", explanation: "Handler runs" });
    api.setRequestStage(req, "looking up user", { line: 1 });
    api.startIO({ ioType: "db", label: "SELECT user", line: 1, turns: 1,
      explanation: "DB lookup dispatched",
      onComplete: () => {
        api.setRequestStage(req, "verifying password", { line: 2 });
        api.startIO({ ioType: "crypto", label: "bcrypt.compare", line: 2, turns: 2,
          explanation: "bcrypt runs on the libuv thread pool (CPU-heavy, but off the main thread)",
          onComplete: () => {
            api.setRequestStage(req, "responding", { line: 3 });
            api.call("res.json", { line: 3, type: "completed", explanation: "Password verified — respond" });
            api.return({ line: 3 });
            api.setRequestStage(req, "completed", { line: 3 });
          } });
      } });
    api.setRequestStage(req, "waiting (DB then bcrypt)", { line: 1, explanation: "Handler returns" });
    api.return({ line: 4, explanation: "Handler returns" });
    api.mark("event loop start");
    api.runLoop();
  },
};
