// src/scenarios/timeout-vs-immediate.js
export default {
  id: "timeout-vs-immediate",
  category: "concept",
  tags: ["timers", "check", "phases"],
  watchFor: "Within one loop turn, the timers phase runs before the check phase.",
  title: "setTimeout(0) vs setImmediate()",
  route: "concept",
  description:
    "Inside the event loop, the timers phase runs before the check phase, so a ready " +
    "setTimeout(0) callback runs before a setImmediate() callback on the same turn.",
  code: [
    "setImmediate(() => {",                  // 0
    "  console.log('immediate');",          // 1
    "});",                                    // 2
    "setTimeout(() => {",                    // 3
    "  console.log('timeout');",            // 4
    "}, 0);",                                // 5
  ].join("\n"),
  run(api) {
    api.call("main", { line: 0, explanation: "Top-level script begins" });
    api.setImmediate(() => {}, { line: 0, label: "setImmediate cb", explanation: "setImmediate -> check phase macrotask" });
    api.setTimeout(() => {}, 0, { line: 3, label: "setTimeout cb", explanation: "setTimeout(0) -> timers phase macrotask" });
    api.return({ line: 5, explanation: "Script done; event loop begins" });
    api.mark("event loop start");
    api.runLoop();
  },
};
