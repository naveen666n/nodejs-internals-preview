// src/scenarios/http-users-db.js
export default {
  id: "http-users-db",
  title: "HTTP GET /api/users + DB query",
  route: "/api/users",
  description:
    "The full request lifecycle: a request arrives, the handler runs synchronously, " +
    "issues a non-blocking DB query (thread pool), and returns. When the DB query " +
    "completes, its callback runs in the poll phase and the response is sent.",
  code: [
    "app.get('/api/users', (req, res) => {",        // 0
    "  db.query('SELECT * FROM users', (rows) => {", // 1
    "    res.json(rows);",                            // 2
    "  });",                                           // 3
    "});",                                             // 4
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "/api/users", label: "GET /api/users", line: 0,
      explanation: "Incoming HTTP request received by the server" });
    api.call("usersHandler", { line: 0, type: "async", explanation: "Route handler runs on the call stack" });
    api.setRequestStage(req, "handling", { line: 0, explanation: "Request is now being handled by the route" });
    api.startIO({ ioType: "db", label: "SELECT * FROM users", line: 1,
      explanation: "DB query dispatched (non-blocking) — handler does not wait",
      onComplete: () => {
        api.setRequestStage(req, "responding", { line: 2, explanation: "DB results are back; building the response" });
        api.call("res.json", { line: 2, type: "completed", explanation: "DB callback runs: send the response" });
        api.return({ line: 2 });
        api.setRequestStage(req, "completed", { line: 2, explanation: "Response sent; request lifecycle complete" });
      } });
    api.setRequestStage(req, "waiting for DB", { line: 1, explanation: "Handler returns; request waits for the DB query while the loop is free" });
    api.return({ line: 4, explanation: "Handler returns; event loop is free to handle other work while the DB query runs" });
    api.mark("event loop start");
    api.runLoop();
  },
};
