// src/scenarios/route-reports.js
export default {
  id: "route-reports",
  category: "route",
  title: "GET /api/reports — CPU blocking",
  route: "GET /api/reports",
  description:
    "After fetching data, the handler builds a heavy report synchronously on the main thread. " +
    "This CPU-bound work BLOCKS the event loop: nothing else can run until it finishes — the " +
    "classic Node performance trap.",
  tags: ["CPU-bound", "blocking", "anti-pattern"],
  watchFor: "While the report is generated, the call stack is stuck and everything else waits.",
  code: [
    "app.get('/api/reports', (req, res) => {",                // 0
    "  db.query('SELECT ...', (rows) => {",                   // 1
    "    const report = buildHeavyReport(rows); // CPU!",      // 2
    "    res.send(report);",                                   // 3
    "  });",                                                    // 4
    "});",                                                      // 5
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "GET /api/reports", label: "GET /api/reports", line: 0,
      explanation: "Incoming reports request" });
    api.call("reportsHandler", { line: 0, type: "async", explanation: "Handler runs" });
    api.setRequestStage(req, "fetching data", { line: 1 });
    api.startIO({ ioType: "db", label: "SELECT report data", line: 1, turns: 1,
      explanation: "Fetch the data (non-blocking)",
      onComplete: () => {
        api.setRequestStage(req, "generating report (CPU)", { line: 2 });
        api.cpuWork({ label: "buildHeavyReport", line: 2, steps: 5,
          explanation: "Building the report on the main thread — the event loop is BLOCKED" });
        api.setRequestStage(req, "responding", { line: 3 });
        api.call("res.send", { line: 3, type: "completed", explanation: "Report built — respond" });
        api.return({ line: 3 });
        api.setRequestStage(req, "completed", { line: 3 });
      } });
    api.setRequestStage(req, "waiting on data", { line: 1, explanation: "Handler returns" });
    api.return({ line: 5, explanation: "Handler returns" });
    api.mark("event loop start");
    api.runLoop();
  },
};
