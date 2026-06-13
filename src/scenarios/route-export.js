// src/scenarios/route-export.js
export default {
  id: "route-export",
  category: "route",
  title: "GET /api/export — CSV stream",
  route: "GET /api/export",
  description:
    "Query rows from the DB, then stream them out as a CSV in chunks. The query is one I/O; " +
    "the CSV is written incrementally so a huge result set never sits fully in memory.",
  tags: ["DB", "file", "streaming", "CSV"],
  watchFor: "One DB query, then several incremental CSV writes — output streams out as it's produced.",
  code: [
    "app.get('/api/export', (req, res) => {",                 // 0
    "  db.query('SELECT * FROM orders', (rows) => {",         // 1
    "    streamCsv(rows, res); // write in chunks",           // 2
    "  });",                                                    // 3
    "});",                                                      // 4
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "GET /api/export", label: "GET /api/export", line: 0,
      explanation: "Incoming export request" });
    api.call("exportHandler", { line: 0, type: "async", explanation: "Handler runs" });
    api.setRequestStage(req, "querying", { line: 1 });
    api.startIO({ ioType: "db", label: "SELECT orders", line: 1, turns: 2,
      explanation: "Query the rows to export",
      onComplete: () => {
        api.setRequestStage(req, "streaming CSV", { line: 2 });
        const chunks = 3;
        function writeCsv(i) {
          if (i >= chunks) {
            api.setRequestStage(req, "completed", { line: 2 });
            return;
          }
          api.startIO({ ioType: "file", label: `CSV chunk ${i + 1}/${chunks}`, line: 2, turns: 1,
            explanation: `Writing CSV chunk ${i + 1}`,
            onComplete: () => writeCsv(i + 1) });
        }
        writeCsv(0);
      } });
    api.setRequestStage(req, "waiting on query", { line: 1, explanation: "Handler returns" });
    api.return({ line: 4, explanation: "Handler returns" });
    api.mark("event loop start");
    api.runLoop();
  },
};
