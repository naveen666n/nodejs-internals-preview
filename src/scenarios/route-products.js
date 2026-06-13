// src/scenarios/route-products.js
export default {
  id: "route-products",
  category: "route",
  title: "GET /api/products — cache + DB fallback",
  route: "GET /api/products",
  description:
    "Check Redis first. On a cache miss, fall back to the database, then (in a real app) " +
    "warm the cache. Both the cache lookup and the DB query are non-blocking I/O.",
  tags: ["cache", "DB", "fallback"],
  watchFor: "A fast cache lookup runs first; on a miss it chains into a DB query.",
  code: [
    "app.get('/api/products', async (req, res) => {",         // 0
    "  let p = await cache.get('products');",                 // 1
    "  if (!p) p = await db.query('SELECT * FROM products');",// 2
    "  res.json(p);",                                          // 3
    "});",                                                      // 4
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "GET /api/products", label: "GET /api/products", line: 0,
      explanation: "Incoming products request" });
    api.call("productsHandler", { line: 0, type: "async", explanation: "Handler runs" });
    api.setRequestStage(req, "checking cache", { line: 1 });
    api.startIO({ ioType: "cache", label: "cache.get products", line: 1, turns: 1,
      explanation: "Redis lookup dispatched (fast non-blocking I/O)",
      onComplete: () => {
        api.setRequestStage(req, "cache miss — querying DB", { line: 2 });
        api.startIO({ ioType: "db", label: "SELECT products", line: 2, turns: 2,
          explanation: "Cache miss: fall back to the database",
          onComplete: () => {
            api.setRequestStage(req, "responding", { line: 3 });
            api.call("res.json", { line: 3, type: "completed", explanation: "Respond with products" });
            api.return({ line: 3 });
            api.setRequestStage(req, "completed", { line: 3 });
          } });
      } });
    api.setRequestStage(req, "waiting (cache then DB)", { line: 1, explanation: "Handler returns" });
    api.return({ line: 4, explanation: "Handler returns" });
    api.mark("event loop start");
    api.runLoop();
  },
};
