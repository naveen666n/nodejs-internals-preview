// src/scenarios/route-analytics.js
export default {
  id: "route-analytics",
  category: "route",
  title: "GET /api/analytics — external API",
  route: "GET /api/analytics",
  description:
    "The handler calls a third-party analytics API over the network. Network I/O is " +
    "non-blocking: the handler returns and the response is sent when the remote call resolves.",
  tags: ["network", "external-API", "non-blocking"],
  watchFor: "The network request sits in flight for several turns; the loop stays free.",
  code: [
    "app.get('/api/analytics', async (req, res) => {",        // 0
    "  const data = await fetch('https://metrics.api/v1');",  // 1
    "  res.json(await data.json());",                          // 2
    "});",                                                      // 3
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "GET /api/analytics", label: "GET /api/analytics", line: 0,
      explanation: "Incoming analytics request" });
    api.call("analyticsHandler", { line: 0, type: "async", explanation: "Handler runs" });
    api.setRequestStage(req, "calling external API", { line: 1 });
    api.startIO({ ioType: "network", label: "fetch metrics.api", line: 1, turns: 3,
      explanation: "External API call dispatched (network I/O)",
      onComplete: () => {
        api.setRequestStage(req, "responding", { line: 2 });
        api.call("res.json", { line: 2, type: "completed", explanation: "Remote responded — send result" });
        api.return({ line: 2 });
        api.setRequestStage(req, "completed", { line: 2 });
      } });
    api.setRequestStage(req, "waiting on external API", { line: 1, explanation: "Handler returns" });
    api.return({ line: 3, explanation: "Handler returns" });
    api.mark("event loop start");
    api.runLoop();
  },
};
