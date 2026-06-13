// tests/scheduler.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../src/engine/scheduler.js";

function frames(run) {
  return simulate({ id: "x", title: "x", route: "/", description: "", code: "", run }).frames;
}

test("call pushes a frame onto the stack; return pops it", () => {
  const fs = frames((api) => {
    api.call("main", { line: 0, explanation: "start" });
    api.call("doWork", { line: 1 });
    api.return();
    api.return();
  });
  // last frame after both returns: empty stack
  const last = fs[fs.length - 1];
  assert.deepEqual(last.callStack.map((t) => t.label), []);
  // a mid frame should show both frames on the stack
  const deepest = fs.find((f) => f.callStack.length === 2);
  assert.deepEqual(deepest.callStack.map((t) => t.label), ["main", "doWork"]);
});

test("each emitted frame carries activeLine and explanation metadata", () => {
  const fs = frames((api) => {
    api.call("main", { line: 3, explanation: "calling main" });
  });
  const f = fs.find((x) => x.callStack.some((t) => t.label === "main"));
  assert.equal(f.activeLine, 3);
  assert.equal(f.explanation, "calling main");
});

test("mark() records a keyFrame pointing at the next emitted frame index", () => {
  const result = simulate({
    id: "x", title: "x", route: "/", description: "", code: "",
    run: (api) => {
      api.call("main", { line: 0 });
      api.mark("inside main");
      api.return();
    },
  });
  assert.equal(result.keyFrames.length, 1);
  assert.equal(result.keyFrames[0].label, "inside main");
  const idx = result.keyFrames[0].index;
  assert.ok(idx >= 0 && idx < result.frames.length);
});

test("nextTick callbacks run before promise microtasks", () => {
  const order = [];
  const fs = frames((api) => {
    api.call("main", { line: 0 });
    api.promiseThen(() => order.push("promise"), { label: "promise.then" });
    api.nextTick(() => order.push("nextTick"), { label: "nextTick cb" });
    api.return();
    api.drainMicrotasks(); // explicit drain after top-level script
  });
  assert.deepEqual(order, ["nextTick", "promise"]);
  // and the final frame must have empty microtask queues
  const last = fs[fs.length - 1];
  assert.deepEqual(last.microtasks.nextTick, []);
  assert.deepEqual(last.microtasks.promises, []);
});

test("a nextTick scheduled inside a microtask drains before remaining promises", () => {
  const order = [];
  frames((api) => {
    api.promiseThen(() => {
      order.push("p1");
      api.nextTick(() => order.push("nt-from-p1"), { label: "nt" });
    }, { label: "p1" });
    api.promiseThen(() => order.push("p2"), { label: "p2" });
    api.drainMicrotasks();
  });
  // After p1 runs and schedules a nextTick, that nextTick must run before p2
  assert.deepEqual(order, ["p1", "nt-from-p1", "p2"]);
});

test("queueMicrotask runs as a promise-queue microtask, after nextTick", () => {
  const order = [];
  const fs = frames((api) => {
    api.queueMicrotask(() => order.push("qmt"), { label: "queueMicrotask cb" });
    api.nextTick(() => order.push("nextTick"), { label: "nextTick cb" });
    api.drainMicrotasks();
  });
  // nextTick has priority over the promise microtask queue (where queueMicrotask lands)
  assert.deepEqual(order, ["nextTick", "qmt"]);
  // the queueMicrotask callback is tracked in the promise microtask queue
  const queued = fs.find((f) => f.microtasks.promises.some((t) => t.label === "queueMicrotask cb"));
  assert.ok(queued, "queueMicrotask should enqueue into the promise microtask queue");
  const last = fs[fs.length - 1];
  assert.deepEqual(last.microtasks.promises, []);
});

test("setImmediate (check) runs after setTimeout(0) (timers) within a loop", () => {
  const order = [];
  frames((api) => {
    api.setImmediate(() => order.push("immediate"), { label: "immediate" });
    api.setTimeout(() => order.push("timeout"), 0, { label: "timeout" });
    api.runLoop();
  });
  assert.deepEqual(order, ["timeout", "immediate"]);
});

test("microtasks drain between two macrotasks", () => {
  const order = [];
  frames((api) => {
    api.setTimeout(() => {
      order.push("timer1");
      api.promiseThen(() => order.push("micro-after-timer1"), { label: "m1" });
    }, 0, { label: "timer1" });
    api.setTimeout(() => order.push("timer2"), 0, { label: "timer2" });
    api.runLoop();
  });
  // the microtask queued in timer1 must run before timer2 executes
  assert.deepEqual(order, ["timer1", "micro-after-timer1", "timer2"]);
});

test("startIO consumes a thread-pool slot then completes via poll-phase callback", () => {
  const order = [];
  const fs = frames((api) => {
    api.call("main", { line: 0 });
    api.startIO({ ioType: "file", label: "readFile", onComplete: () => order.push("io-done") });
    api.return();
    api.runLoop();
  });
  assert.deepEqual(order, ["io-done"]);
  // at some frame, a thread-pool slot must be occupied
  const busy = fs.find((f) => f.threadPool.some((slot) => slot !== null));
  assert.ok(busy, "thread pool should be used during I/O");
  // final frame: pool idle again, io drained
  const last = fs[fs.length - 1];
  assert.ok(last.threadPool.every((slot) => slot === null));
  assert.deepEqual(last.io, []);
});

test("httpRequest registers an active request with a route", () => {
  const fs = frames((api) => {
    api.httpRequest({ route: "/api/users", label: "GET /api/users" });
    api.runLoop();
  });
  const withReq = fs.find((f) => f.requests.length === 1);
  assert.equal(withReq.requests[0].route, "/api/users");
});
