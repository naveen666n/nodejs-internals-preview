// src/scenarios/promise-vs-callback.js
export default {
  id: "promise-vs-callback",
  category: "concept",
  tags: ["microtask", "macrotask", "timers"],
  watchFor: "The promise microtask runs before the setTimeout callback, even at 0ms.",
  title: "Promise (microtask) vs setTimeout (macrotask)",
  route: "concept",
  description:
    "A resolved Promise callback is a microtask and runs before a setTimeout(0) callback, " +
    "which is a macrotask handled in the timers phase on the next loop turn.",
  code: [
    "console.log('start');",                 // 0
    "setTimeout(() => {",                    // 1
    "  console.log('timeout');",            // 2
    "}, 0);",                                // 3
    "Promise.resolve().then(() => {",        // 4
    "  console.log('promise');",            // 5
    "});",                                    // 6
    "console.log('end');",                    // 7
  ].join("\n"),
  run(api) {
    api.call("main", { line: 0, explanation: "Top-level script begins" });
    api.setTimeout(() => {}, 0, { line: 1, label: "setTimeout cb", explanation: "setTimeout(0) -> timers phase macrotask" });
    api.promiseThen(() => {}, { line: 4, label: "promise cb", explanation: "Promise.then -> microtask" });
    api.return({ line: 7, explanation: "Script done; microtasks drain before the loop" });
    api.mark("microtask drain");
    api.runLoop();
  },
};
