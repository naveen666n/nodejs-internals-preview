// src/scenarios/route-payment.js
export default {
  id: "route-payment",
  category: "route",
  title: "POST /api/payment — sequential awaits",
  route: "POST /api/payment",
  description:
    "Charge the card via an external API, THEN record the payment in the database. These are " +
    "sequential awaits: the DB write cannot start until the card charge returns, so their " +
    "latencies add up.",
  tags: ["network", "DB", "sequential-await"],
  watchFor: "The DB write only begins after the network charge completes — latencies stack.",
  code: [
    "app.post('/api/payment', async (req, res) => {",         // 0
    "  const charge = await stripe.charge(req.body);",        // 1
    "  await db.query('INSERT INTO payments ...');",          // 2
    "  res.json({ id: charge.id });",                          // 3
    "});",                                                      // 4
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "POST /api/payment", label: "POST /api/payment", line: 0,
      explanation: "Incoming payment request" });
    api.call("paymentHandler", { line: 0, type: "async", explanation: "Handler runs" });
    api.setRequestStage(req, "charging card", { line: 1 });
    api.startIO({ ioType: "network", label: "stripe.charge", line: 1, turns: 2,
      explanation: "Charge the card via external API (network)",
      onComplete: () => {
        api.setRequestStage(req, "recording payment", { line: 2 });
        api.startIO({ ioType: "db", label: "INSERT payment", line: 2, turns: 1,
          explanation: "Only now does the DB write start (sequential await)",
          onComplete: () => {
            api.setRequestStage(req, "responding", { line: 3 });
            api.call("res.json", { line: 3, type: "completed", explanation: "Respond with charge id" });
            api.return({ line: 3 });
            api.setRequestStage(req, "completed", { line: 3 });
          } });
      } });
    api.setRequestStage(req, "waiting (charge then write)", { line: 1, explanation: "Handler returns" });
    api.return({ line: 4, explanation: "Handler returns" });
    api.mark("event loop start");
    api.runLoop();
  },
};
