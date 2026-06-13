// src/scenarios/nexttick-vs-promise.js
export default {
  id: "nexttick-vs-promise",
  category: "concept",
  tags: ["microtasks", "nextTick", "promises"],
  watchFor: "The nextTick queue fully drains before any promise microtask runs.",
  title: "process.nextTick() vs Promise",
  route: "concept",
  description:
    "process.nextTick callbacks run before resolved Promise callbacks, even though both " +
    "are microtasks. The nextTick queue is fully drained before the promise queue.",
  code: [
    "console.log('start');",                       // 0
    "Promise.resolve().then(() => {",              // 1
    "  console.log('promise');",                   // 2
    "});",                                          // 3
    "process.nextTick(() => {",                     // 4
    "  console.log('nextTick');",                  // 5
    "});",                                          // 6
    "console.log('end');",                          // 7
  ].join("\n"),
  run(api) {
    api.call("main", { line: 0, explanation: "Top-level script begins" });
    api.promiseThen(() => {}, { line: 1, label: "promise cb", explanation: "Promise.then() schedules a microtask" });
    api.nextTick(() => {}, { line: 4, label: "nextTick cb", explanation: "process.nextTick() schedules a nextTick microtask" });
    api.return({ line: 7, explanation: "Top-level script finished; now microtasks drain" });
    api.mark("microtask drain");
    api.drainMicrotasks();
  },
};
