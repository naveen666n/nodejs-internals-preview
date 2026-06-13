// src/scenarios/route-search.js
export default {
  id: "route-search",
  category: "route",
  title: "GET /api/search — await in a loop",
  route: "GET /api/search",
  description:
    "Searching three indexes with `await` inside a for-loop runs them one after another, " +
    "even though they're independent. Each query waits for the previous one — a common " +
    "performance pitfall that Promise.all would fix (see /api/dashboard).",
  tags: ["DB", "sequential-await", "anti-pattern"],
  watchFor: "Only one query runs at a time — contrast with the parallel /api/dashboard.",
  code: [
    "app.get('/api/search', async (req, res) => {",           // 0
    "  const out = [];",                                       // 1
    "  for (const idx of ['users','orders','products'])",     // 2
    "    out.push(await db.search(idx, req.query.q));",        // 3
    "  res.json(out);",                                        // 4
    "});",                                                      // 5
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "GET /api/search", label: "GET /api/search", line: 0,
      explanation: "Incoming search request" });
    api.call("searchHandler", { line: 0, type: "async", explanation: "Handler runs" });
    api.setRequestStage(req, "searching (sequential)", { line: 2 });
    const indexes = ["users", "orders", "products"];
    function searchNext(i) {
      if (i >= indexes.length) {
        api.setRequestStage(req, "responding", { line: 4 });
        api.call("res.json", { line: 4, type: "completed", explanation: "All searches done — respond" });
        api.return({ line: 4 });
        api.setRequestStage(req, "completed", { line: 4 });
        return;
      }
      api.startIO({ ioType: "db", label: `search ${indexes[i]}`, line: 3, turns: 1,
        explanation: `Searching '${indexes[i]}' — the loop awaits this before the next`,
        onComplete: () => searchNext(i + 1) });
    }
    searchNext(0);
    api.setRequestStage(req, "awaiting query 1 of 3", { line: 3, explanation: "Handler returns" });
    api.return({ line: 5, explanation: "Handler returns" });
    api.mark("event loop start");
    api.runLoop();
  },
};
