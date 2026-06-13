// src/scenarios/sync-vs-async-fs.js
export default {
  id: "sync-vs-async-fs",
  category: "concept",
  tags: ["file", "blocking", "non-blocking"],
  watchFor: "readFileSync freezes the call stack; readFile offloads to the thread pool.",
  title: "fs.readFileSync (blocking) vs fs.readFile (non-blocking)",
  route: "concept",
  description:
    "readFileSync blocks the call stack until the file is read — nothing else can run. " +
    "readFile hands the work to the libuv thread pool and continues; its callback runs " +
    "later in the poll phase.",
  code: [
    "// Blocking:",                                  // 0
    "const data = fs.readFileSync('a.txt');",       // 1
    "console.log('after sync read');",              // 2
    "",                                               // 3
    "// Non-blocking:",                              // 4
    "fs.readFile('b.txt', (err, data) => {",         // 5
    "  console.log('async read done');",            // 6
    "});",                                            // 7
    "console.log('after async call');",             // 8
  ].join("\n"),
  run(api) {
    api.call("main", { line: 0, explanation: "Top-level script begins" });
    // blocking read: occupies the stack, nothing else can happen
    api.call("fs.readFileSync", { line: 1, type: "blocking", blocking: true,
      explanation: "readFileSync BLOCKS the call stack — the event loop is frozen until it returns" });
    api.return({ line: 2, explanation: "Blocking read finished; stack frees up" });
    // non-blocking read: dispatched to thread pool
    api.startIO({ ioType: "file", label: "readFile b.txt", line: 5,
      explanation: "readFile hands work to the libuv thread pool and returns immediately",
      onComplete: () => {} });
    api.call("console.log", { line: 8, explanation: "Synchronous code keeps running while I/O is pending" });
    api.return({ line: 8 });
    api.return({ line: 8, explanation: "Top-level script done; event loop runs, I/O will complete in poll" });
    api.mark("event loop start");
    api.runLoop();
  },
};
