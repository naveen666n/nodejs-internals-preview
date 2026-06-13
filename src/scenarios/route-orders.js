// src/scenarios/route-orders.js
export default {
  id: "route-orders",
  category: "route",
  title: "GET /api/orders — slow DB query",
  route: "GET /api/orders",
  description:
    "A slow database query takes many event-loop turns to complete. While it runs, the " +
    "event loop is NOT blocked — it keeps cycling through its phases, free to handle other work.",
  tags: ["DB", "slow-query", "non-blocking"],
  watchFor: "The event loop keeps cycling for many turns while the query is in flight — it never blocks.",
  code: [
    "app.get('/api/orders', (req, res) => {",                 // 0
    "  db.query('SELECT ... JOIN ... (slow)', (rows) => {",   // 1
    "    res.json(rows);",                                     // 2
    "  });",                                                    // 3
    "});",                                                      // 4
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "GET /api/orders", label: "GET /api/orders", line: 0,
      explanation: "Incoming request for orders" });
    api.call("ordersHandler", { line: 0, type: "async", explanation: "Handler runs" });
    api.setRequestStage(req, "querying (slow)", { line: 1 });
    api.startIO({ ioType: "db", label: "slow SELECT", line: 1, turns: 8,
      explanation: "Slow DB query dispatched — it will take several loop turns",
      onComplete: () => {
        api.setRequestStage(req, "responding", { line: 2 });
        api.call("res.json", { line: 2, type: "completed", explanation: "Query done — send response" });
        api.return({ line: 2 });
        api.setRequestStage(req, "completed", { line: 2 });
      } });
    api.setRequestStage(req, "waiting on slow query", { line: 1,
      explanation: "Handler returns; the loop is free while the slow query runs" });
    api.return({ line: 4, explanation: "Handler returns" });
    api.mark("event loop start");
    api.runLoop();
  },
};
