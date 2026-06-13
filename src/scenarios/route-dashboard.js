// src/scenarios/route-dashboard.js
export default {
  id: "route-dashboard",
  category: "route",
  title: "GET /api/dashboard — parallel queries",
  route: "GET /api/dashboard",
  description:
    "The handler fires three independent data sources at once (Promise.all). They run " +
    "concurrently on the libuv thread pool and complete out of order; the response is sent " +
    "once all three finish.",
  tags: ["DB", "cache", "parallel", "Promise.all"],
  watchFor: "Three tasks occupy thread-pool slots simultaneously and finish out of order.",
  code: [
    "app.get('/api/dashboard', async (req, res) => {",        // 0
    "  const [a, b, c] = await Promise.all([",                // 1
    "    db.query('stats'), db.query('sales'), cache.get('widgets')", // 2
    "  ]);",                                                    // 3
    "  res.json({ a, b, c });",                                // 4
    "});",                                                      // 5
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "GET /api/dashboard", label: "GET /api/dashboard", line: 0,
      explanation: "Incoming dashboard request" });
    api.call("dashboardHandler", { line: 0, type: "async", explanation: "Handler runs" });
    api.setRequestStage(req, "fan-out (3 parallel)", { line: 1 });
    let done = 0;
    const total = 3;
    function finish(name) {
      done += 1;
      if (done === total) {
        api.setRequestStage(req, "responding", { line: 4 });
        api.call("res.json", { line: 4, type: "completed", explanation: "All three done — send response" });
        api.return({ line: 4 });
        api.setRequestStage(req, "completed", { line: 4 });
      }
    }
    api.startIO({ ioType: "db", label: "query: stats", line: 2, turns: 1,
      explanation: "Parallel query 1 dispatched", onComplete: () => finish("stats") });
    api.startIO({ ioType: "db", label: "query: sales", line: 2, turns: 2,
      explanation: "Parallel query 2 dispatched", onComplete: () => finish("sales") });
    api.startIO({ ioType: "cache", label: "cache: widgets", line: 2, turns: 1,
      explanation: "Parallel cache lookup dispatched", onComplete: () => finish("widgets") });
    api.setRequestStage(req, "awaiting 3 parallel tasks", { line: 1,
      explanation: "Handler returns; three tasks run on the thread pool at once" });
    api.return({ line: 5, explanation: "Handler returns" });
    api.mark("event loop start");
    api.runLoop();
  },
};
