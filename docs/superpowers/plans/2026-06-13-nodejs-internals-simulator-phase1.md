# Node.js Internals Simulator — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core simulation engine, foundational UI, and 5 starter scenarios for a web-based Node.js internals simulator that lets a developer step frame-by-frame through call stack, event-loop phases, microtask/macrotask queues, and libuv thread-pool I/O.

**Architecture:** A pure-logic scheduler runs each scenario deterministically up front and emits an immutable array of `frames` (full state snapshots + presentation metadata). The DOM renderer is a pure function of `frames[index]` and uses FLIP animation to move stable-id tokens between panels. Playback controls just mutate the frame index. No build step, no backend.

**Tech Stack:** Vanilla HTML/CSS/JavaScript (ES modules), `node:test` for engine unit tests, CSS custom properties for theming. No bundler, no dependencies.

---

## File Structure

```
nodejs-different-situations/
├── index.html                    # SPA shell, loads app.js as module
├── styles/
│   ├── theme.css                 # CSS custom properties: dark + light themes
│   └── layout.css                # grid layout + panel/token styling
├── src/
│   ├── app.js                    # wires picker → simulate → renderer → controls
│   ├── engine/
│   │   ├── state.js              # state shape, snapshot/clone, id allocation, token types
│   │   └── scheduler.js          # hybrid event-loop scheduler → frames[]
│   ├── scenarios/
│   │   ├── index.js              # scenario registry
│   │   ├── sync-vs-async-fs.js
│   │   ├── timeout-vs-immediate.js
│   │   ├── nexttick-vs-promise.js
│   │   ├── promise-vs-callback.js
│   │   └── http-users-db.js
│   └── ui/
│       ├── theme.js              # theme toggle + localStorage persistence
│       ├── layout.js             # builds the panel grid scaffold
│       ├── codePanel.js          # source + active-line highlight
│       ├── callStack.js          # animated stack frames
│       ├── eventLoop.js          # six phases, highlights active phase
│       ├── queues.js             # microtask + macro queues + tokens (FLIP)
│       ├── threadPool.js         # libuv worker slots + in-flight I/O
│       ├── requestLane.js        # clients → server → request queue
│       ├── explainPanel.js       # per-frame explanation + blocking badge
│       └── controls.js           # play/pause/next/prev/speed/restart/scrub/jump
└── tests/
    ├── state.test.mjs
    ├── scheduler.test.mjs
    └── scenarios.test.mjs
```

**Module boundaries:**
- `engine/*` is pure logic — no DOM, no `window`. Imports cleanly under `node --test`.
- `scenarios/*` depend only on the authoring API surface (they call methods on the `api` object passed to `run`).
- `ui/*` are pure functions of frame data — they read frames and emit DOM, never mutate engine state.
- `app.js` is the only module that holds mutable playback state (the frame index + clock).

**Key data contracts (defined once, used everywhere):**

A **token** is `{ id: string, type: TokenType, label: string }`.
`TokenType` ∈ `"sync" | "async" | "blocking" | "db" | "file" | "network" | "timer" | "promise" | "nexttick" | "completed" | "waiting"`.

A **frame** is:
```js
{
  callStack: Token[],                 // top of stack = last element
  microtasks: { nextTick: Token[], promises: Token[] },
  macro: { timers: Token[], pending: Token[], poll: Token[], check: Token[], close: Token[] },
  threadPool: (Token | null)[],       // fixed length = THREAD_POOL_SIZE
  io: Token[],                          // in-flight I/O not yet completed
  requests: { id: string, route: string, stage: string }[],
  activePhase: Phase | null,           // "timers"|"pending"|"poll"|"check"|"close" | null
  activeLine: number | null,           // 0-based index into scenario.code lines
  explanation: string,
  blocking: boolean,                   // for the blocking/non-blocking badge
  changed: string[]                    // container ids that changed (renderer hint)
}
```

A **scenario** is:
```js
{
  id: string, title: string, route: string, description: string,
  code: string,                        // displayed source; lines referenced by index
  run(api): void                       // authors call api.* to describe execution intent
}
```

`simulate(scenario)` returns `{ frames: Frame[], keyFrames: { label: string, index: number }[] }`.

---

## Task 1: Project shell + engine state module

**Files:**
- Create: `tests/state.test.mjs`
- Create: `src/engine/state.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/state.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeToken, initialState, snapshot, THREAD_POOL_SIZE } from "../src/engine/state.js";

test("makeToken creates a token with unique id, type, label", () => {
  const a = makeToken("timer", "setTimeout cb");
  const b = makeToken("timer", "setTimeout cb");
  assert.equal(a.type, "timer");
  assert.equal(a.label, "setTimeout cb");
  assert.notEqual(a.id, b.id, "ids must be unique");
});

test("initialState has empty queues and a sized thread pool", () => {
  const s = initialState();
  assert.deepEqual(s.callStack, []);
  assert.deepEqual(s.microtasks, { nextTick: [], promises: [] });
  assert.deepEqual(s.macro, { timers: [], pending: [], poll: [], check: [], close: [] });
  assert.equal(s.threadPool.length, THREAD_POOL_SIZE);
  assert.ok(s.threadPool.every((slot) => slot === null));
  assert.deepEqual(s.io, []);
  assert.deepEqual(s.requests, []);
  assert.equal(s.activePhase, null);
});

test("snapshot deep-clones so later mutations do not leak into prior snapshots", () => {
  const s = initialState();
  s.callStack.push(makeToken("sync", "main"));
  const snap = snapshot(s, { activeLine: 1, explanation: "x", blocking: false, changed: [] });
  s.callStack.push(makeToken("sync", "other"));
  assert.equal(snap.callStack.length, 1, "snapshot must not see later pushes");
  assert.equal(snap.activeLine, 1);
  assert.equal(snap.explanation, "x");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/state.test.mjs`
Expected: FAIL — cannot find module `../src/engine/state.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/engine/state.js
export const THREAD_POOL_SIZE = 4;

let _id = 0;
export function makeToken(type, label) {
  _id += 1;
  return { id: `t${_id}`, type, label };
}

export function initialState() {
  return {
    callStack: [],
    microtasks: { nextTick: [], promises: [] },
    macro: { timers: [], pending: [], poll: [], check: [], close: [] },
    threadPool: Array(THREAD_POOL_SIZE).fill(null),
    io: [],
    requests: [],
    activePhase: null,
  };
}

// Deep clone of mutable state + merge presentation metadata into a frame.
export function snapshot(state, meta) {
  const clone = (arr) => arr.map((t) => (t ? { ...t } : null));
  return {
    callStack: clone(state.callStack),
    microtasks: {
      nextTick: clone(state.microtasks.nextTick),
      promises: clone(state.microtasks.promises),
    },
    macro: {
      timers: clone(state.macro.timers),
      pending: clone(state.macro.pending),
      poll: clone(state.macro.poll),
      check: clone(state.macro.check),
      close: clone(state.macro.close),
    },
    threadPool: clone(state.threadPool),
    io: clone(state.io),
    requests: state.requests.map((r) => ({ ...r })),
    activePhase: state.activePhase,
    activeLine: meta.activeLine ?? null,
    explanation: meta.explanation ?? "",
    blocking: meta.blocking ?? false,
    changed: meta.changed ?? [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/state.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/state.test.mjs src/engine/state.js
git commit -m "feat: add engine state module with tokens and snapshots"
```

---

## Task 2: Scheduler — authoring API, call stack, and frame emission

This task builds the scheduler skeleton: it records authoring intents into a queue of
"intents", then executes them, emitting a frame after each atomic state change. This task
covers only **synchronous** call/return and frame emission. Async ordering comes in Tasks 3–4.

**Files:**
- Create: `tests/scheduler.test.mjs`
- Create: `src/engine/scheduler.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scheduler.test.mjs`
Expected: FAIL — cannot find module `../src/engine/scheduler.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/engine/scheduler.js
import { initialState, snapshot, makeToken } from "./state.js";

// The scheduler runs a scenario's run(api) function. Authoring calls mutate `state`
// and emit frames. Async scheduling (timers/micro/macro/io) is added in later tasks.
export function simulate(scenario) {
  const state = initialState();
  const frames = [];
  const keyFrames = [];

  // emit a frame after a state change
  function emit(meta) {
    frames.push(snapshot(state, meta));
  }

  const api = {
    call(label, meta = {}) {
      state.callStack.push(makeToken(meta.type || "sync", label));
      emit({ activeLine: meta.line, explanation: meta.explanation || `Call ${label}()`,
             blocking: !!meta.blocking, changed: ["callStack"] });
    },
    return(meta = {}) {
      state.callStack.pop();
      emit({ activeLine: meta.line, explanation: meta.explanation || "Function returns",
             changed: ["callStack"] });
    },
    mark(label) {
      // points at the NEXT frame to be emitted
      keyFrames.push({ label, index: frames.length });
    },
  };

  // initial frame (empty state) so playback has a clean starting point
  emit({ explanation: "Program start", changed: [] });

  scenario.run(api);

  return { frames, keyFrames };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scheduler.test.mjs`
Expected: PASS (3 tests).

Note: `mark` points at `frames.length` (the index the *next* emit will occupy). In the
test, after `api.call("main")` one frame exists at index 1 (index 0 is "Program start"),
so `mark` records index 2, and `api.return()` emits the frame at index 2. Valid.

- [ ] **Step 5: Commit**

```bash
git add tests/scheduler.test.mjs src/engine/scheduler.js
git commit -m "feat: scheduler skeleton with call/return and frame emission"
```

---

## Task 3: Scheduler — microtasks (nextTick + promises) and the drain rule

Add `nextTick`, `queueMicrotask`/`promiseThen`, and the microtask drain that runs after
the top-level script and (later) between macrotasks. nextTick drains fully before promises.

**Files:**
- Modify: `src/engine/scheduler.js`
- Modify: `tests/scheduler.test.mjs` (append tests)

- [ ] **Step 1: Write the failing test (append to tests/scheduler.test.mjs)**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scheduler.test.mjs`
Expected: FAIL — `api.promiseThen is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to the `api` object in `src/engine/scheduler.js`. Each microtask stores both a display
token and the JS callback. Replace the `api` object construction and add a drain helper:

```js
  // --- inside simulate(), add these stores near the top ---
  // microtask callbacks paired with their display tokens
  const nextTickCbs = [];   // { token, cb }
  const promiseCbs = [];    // { token, cb }

  // --- add these methods to the api object ---
    nextTick(cb, meta = {}) {
      const token = makeToken("nexttick", meta.label || "nextTick cb");
      state.microtasks.nextTick.push(token);
      nextTickCbs.push({ token, cb });
      emit({ activeLine: meta.line, explanation: meta.explanation || "process.nextTick() queued",
             changed: ["microtasks"] });
    },
    promiseThen(cb, meta = {}) {
      const token = makeToken("promise", meta.label || "promise.then");
      state.microtasks.promises.push(token);
      promiseCbs.push({ token, cb });
      emit({ activeLine: meta.line, explanation: meta.explanation || "Promise callback queued (microtask)",
             changed: ["microtasks"] });
    },
    queueMicrotask(cb, meta = {}) {
      return api.promiseThen(cb, { ...meta, label: meta.label || "queueMicrotask cb" });
    },
    drainMicrotasks(meta = {}) {
      drainMicrotasks(meta);
    },

  // --- add this function inside simulate(), after the api object ---
  function drainMicrotasks() {
    // nextTick queue has priority and is fully drained (including newly added)
    // before moving to the promise queue. After each promise callback, nextTick
    // is re-checked. Loop until both are empty.
    while (state.microtasks.nextTick.length || state.microtasks.promises.length) {
      while (state.microtasks.nextTick.length) {
        const token = state.microtasks.nextTick.shift();
        const entry = nextTickCbs.shift();
        state.callStack.push(token);
        emit({ explanation: `Run nextTick: ${token.label}`, changed: ["microtasks", "callStack"] });
        if (entry && entry.cb) entry.cb();
        state.callStack.pop();
        emit({ explanation: `${token.label} returns`, changed: ["callStack"] });
      }
      if (state.microtasks.promises.length) {
        const token = state.microtasks.promises.shift();
        const entry = promiseCbs.shift();
        state.callStack.push(token);
        emit({ explanation: `Run promise microtask: ${token.label}`, changed: ["microtasks", "callStack"] });
        if (entry && entry.cb) entry.cb();
        state.callStack.pop();
        emit({ explanation: `${token.label} returns`, changed: ["callStack"] });
      }
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scheduler.test.mjs`
Expected: PASS (all tests, including Task 2's).

- [ ] **Step 5: Commit**

```bash
git add src/engine/scheduler.js tests/scheduler.test.mjs
git commit -m "feat: scheduler microtasks with nextTick-before-promise drain"
```

---

## Task 4: Scheduler — event-loop phases, timers, setImmediate, and I/O via thread pool

Add `setTimeout`, `setImmediate`, `startIO`, `httpRequest`, and the `runLoop()` driver that
cycles through phases (timers → pending → poll → check → close), draining microtasks
between every macrotask callback. I/O consumes a thread-pool slot, then completes by
queuing its callback into the poll phase on a later turn.

**Files:**
- Modify: `src/engine/scheduler.js`
- Modify: `tests/scheduler.test.mjs` (append tests)

- [ ] **Step 1: Write the failing test (append)**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scheduler.test.mjs`
Expected: FAIL — `api.setImmediate is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add macrotask stores, the new api methods, and the loop driver to `src/engine/scheduler.js`:

```js
  // --- add stores near the other stores ---
  const PHASES = ["timers", "pending", "poll", "check", "close"];
  // macrotask callbacks paired with tokens, keyed per phase
  const macroCbs = { timers: [], pending: [], poll: [], check: [], close: [] }; // {token, cb}
  // I/O in flight: each has a token + onComplete; completes after one loop turn
  const ioCbs = []; // { token, onComplete, slotIndex, turnsRemaining }

  // --- add api methods ---
    setTimeout(cb, _delay, meta = {}) {
      const token = makeToken("timer", meta.label || "setTimeout cb");
      state.macro.timers.push(token);
      macroCbs.timers.push({ token, cb });
      emit({ activeLine: meta.line, explanation: meta.explanation || "setTimeout() registered (timers phase)",
             changed: ["macro"] });
    },
    setImmediate(cb, meta = {}) {
      const token = makeToken("timer", meta.label || "setImmediate cb");
      state.macro.check.push(token);
      macroCbs.check.push({ token, cb });
      emit({ activeLine: meta.line, explanation: meta.explanation || "setImmediate() registered (check phase)",
             changed: ["macro"] });
    },
    startIO(meta = {}) {
      const type = meta.ioType || "file";
      const token = makeToken(type, meta.label || `${type} I/O`);
      // occupy first free thread-pool slot (libuv); if none, queue in io as waiting
      const slotIndex = state.threadPool.indexOf(null);
      if (slotIndex >= 0) state.threadPool[slotIndex] = token;
      state.io.push(token);
      ioCbs.push({ token, onComplete: meta.onComplete, slotIndex, turnsRemaining: meta.turns || 1 });
      emit({ activeLine: meta.line,
             explanation: meta.explanation || `${type} I/O dispatched to libuv thread pool (non-blocking)`,
             changed: ["threadPool", "io"] });
    },
    httpRequest(meta = {}) {
      const req = { id: makeToken("network", meta.label || "request").id, route: meta.route || "/", stage: "received" };
      state.requests.push(req);
      emit({ activeLine: meta.line, explanation: meta.explanation || `Incoming HTTP request ${meta.route || ""}`,
             changed: ["requests"] });
    },
    runLoop(meta = {}) {
      runLoop();
    },

  // --- add the loop driver inside simulate() ---
  function ioPending() { return ioCbs.length > 0; }
  function macroPending() { return PHASES.some((p) => state.macro[p].length > 0); }

  function completeReadyIO() {
    // advance I/O; those that finish move their callback into the poll phase
    for (let i = ioCbs.length - 1; i >= 0; i--) {
      ioCbs[i].turnsRemaining -= 1;
      if (ioCbs[i].turnsRemaining <= 0) {
        const done = ioCbs.splice(i, 1)[0];
        // free the thread-pool slot
        if (done.slotIndex >= 0) state.threadPool[done.slotIndex] = null;
        // remove from in-flight io
        const ioIdx = state.io.findIndex((t) => t.id === done.token.id);
        if (ioIdx >= 0) state.io.splice(ioIdx, 1);
        // queue its completion callback into poll
        const cbToken = makeToken("completed", `${done.token.label} callback`);
        state.macro.poll.push(cbToken);
        macroCbs.poll.push({ token: cbToken, cb: done.onComplete });
        emit({ explanation: `${done.token.label} completed in thread pool → callback queued in poll phase`,
               changed: ["threadPool", "io", "macro"] });
      }
    }
  }

  function runPhase(phase) {
    state.activePhase = phase;
    while (state.macro[phase].length) {
      const token = state.macro[phase].shift();
      const entry = macroCbs[phase].shift();
      state.callStack.push(token);
      emit({ explanation: `${phase} phase: run ${token.label}`, changed: ["macro", "callStack"] });
      if (entry && entry.cb) entry.cb();
      state.callStack.pop();
      emit({ explanation: `${token.label} returns`, changed: ["callStack"] });
      drainMicrotasks(); // microtasks drain between every macrotask
    }
    state.activePhase = null;
  }

  function runLoop() {
    // drain microtasks left from top-level script first
    drainMicrotasks();
    let guard = 0;
    while ((macroPending() || ioPending()) && guard < 1000) {
      guard += 1;
      for (const phase of PHASES) {
        if (phase === "poll") completeReadyIO(); // I/O completions surface in poll
        runPhase(phase);
      }
      // if only I/O remains in flight, advance it on the next turn
      if (!macroPending() && ioPending()) completeReadyIO();
    }
  }
```

Note: `drainMicrotasks` from Task 3 is reused. The `runLoop` guard prevents infinite loops.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scheduler.test.mjs`
Expected: PASS (all scheduler tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/scheduler.js tests/scheduler.test.mjs
git commit -m "feat: scheduler event-loop phases, timers, setImmediate, and thread-pool I/O"
```

---

## Task 5: Scenario registry + first scenario (nextTick vs Promise)

**Files:**
- Create: `tests/scenarios.test.mjs`
- Create: `src/scenarios/nexttick-vs-promise.js`
- Create: `src/scenarios/index.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/scenarios.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { scenarios } from "../src/scenarios/index.js";
import { simulate } from "../src/engine/scheduler.js";

test("every scenario has required fields and a runnable run()", () => {
  assert.ok(scenarios.length >= 1);
  for (const s of scenarios) {
    assert.equal(typeof s.id, "string");
    assert.ok(s.id.length > 0, "id required");
    assert.equal(typeof s.title, "string");
    assert.equal(typeof s.route, "string");
    assert.equal(typeof s.description, "string");
    assert.equal(typeof s.code, "string");
    assert.equal(typeof s.run, "function");
  }
});

test("scenario ids are unique", () => {
  const ids = scenarios.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every scenario simulates to a non-empty frame array without throwing", () => {
  for (const s of scenarios) {
    const { frames } = simulate(s);
    assert.ok(frames.length > 0, `${s.id} produced no frames`);
  }
});

test("nexttick-vs-promise scenario exists and runs nextTick before promise", () => {
  const s = scenarios.find((x) => x.id === "nexttick-vs-promise");
  assert.ok(s, "scenario missing");
  const { frames } = simulate(s);
  // find the frame index where a nexttick callback runs and where a promise runs
  const ntIdx = frames.findIndex((f) => f.explanation.includes("nextTick:"));
  const pIdx = frames.findIndex((f) => f.explanation.includes("promise microtask:"));
  assert.ok(ntIdx >= 0 && pIdx >= 0);
  assert.ok(ntIdx < pIdx, "nextTick must run before promise microtask");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scenarios.test.mjs`
Expected: FAIL — cannot find module `../src/scenarios/index.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/scenarios/nexttick-vs-promise.js
export default {
  id: "nexttick-vs-promise",
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
```

```js
// src/scenarios/index.js
import nextTickVsPromise from "./nexttick-vs-promise.js";

export const scenarios = [
  nextTickVsPromise,
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scenarios.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/scenarios.test.mjs src/scenarios/nexttick-vs-promise.js src/scenarios/index.js
git commit -m "feat: scenario registry and nextTick-vs-promise scenario"
```

---

## Task 6: Remaining four scenarios

Add the other four scenarios and register them. Each is data + a `run()`; tests in Task 5
already validate the shape of all registered scenarios, so we add targeted ordering tests.

**Files:**
- Create: `src/scenarios/promise-vs-callback.js`
- Create: `src/scenarios/timeout-vs-immediate.js`
- Create: `src/scenarios/sync-vs-async-fs.js`
- Create: `src/scenarios/http-users-db.js`
- Modify: `src/scenarios/index.js`
- Modify: `tests/scenarios.test.mjs` (append tests)

- [ ] **Step 1: Write the failing test (append to tests/scenarios.test.mjs)**

```js
test("timeout-vs-immediate: timer runs before immediate", () => {
  const s = scenarios.find((x) => x.id === "timeout-vs-immediate");
  assert.ok(s);
  const { frames } = simulate(s);
  const tIdx = frames.findIndex((f) => f.explanation.includes("setTimeout cb") && f.activePhase === "timers");
  const iIdx = frames.findIndex((f) => f.explanation.includes("setImmediate cb") && f.activePhase === "check");
  assert.ok(tIdx >= 0 && iIdx >= 0 && tIdx < iIdx);
});

test("sync-vs-async-fs: async read uses the thread pool", () => {
  const s = scenarios.find((x) => x.id === "sync-vs-async-fs");
  assert.ok(s);
  const { frames } = simulate(s);
  assert.ok(frames.some((f) => f.threadPool.some((slot) => slot !== null)));
});

test("http-users-db: registers a request on /api/users and completes a DB I/O", () => {
  const s = scenarios.find((x) => x.id === "http-users-db");
  assert.ok(s);
  const { frames } = simulate(s);
  assert.ok(frames.some((f) => f.requests.some((r) => r.route === "/api/users")));
  assert.ok(frames.some((f) => f.io.some((t) => t.type === "db")));
});

test("all five Phase-1 scenarios are registered", () => {
  const ids = scenarios.map((s) => s.id).sort();
  assert.deepEqual(ids, [
    "http-users-db",
    "nexttick-vs-promise",
    "promise-vs-callback",
    "sync-vs-async-fs",
    "timeout-vs-immediate",
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scenarios.test.mjs`
Expected: FAIL — `timeout-vs-immediate` not found.

- [ ] **Step 3: Write minimal implementation**

```js
// src/scenarios/promise-vs-callback.js
export default {
  id: "promise-vs-callback",
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
    api.setTimeout(() => {}, 0, { line: 1, label: "setTimeout cb", explanation: "setTimeout(0) → timers phase macrotask" });
    api.promiseThen(() => {}, { line: 4, label: "promise cb", explanation: "Promise.then → microtask" });
    api.return({ line: 7, explanation: "Script done; microtasks drain before the loop" });
    api.mark("microtask drain");
    api.runLoop();
  },
};
```

```js
// src/scenarios/timeout-vs-immediate.js
export default {
  id: "timeout-vs-immediate",
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
    api.setImmediate(() => {}, { line: 0, label: "setImmediate cb", explanation: "setImmediate → check phase macrotask" });
    api.setTimeout(() => {}, 0, { line: 3, label: "setTimeout cb", explanation: "setTimeout(0) → timers phase macrotask" });
    api.return({ line: 5, explanation: "Script done; event loop begins" });
    api.mark("event loop start");
    api.runLoop();
  },
};
```

```js
// src/scenarios/sync-vs-async-fs.js
export default {
  id: "sync-vs-async-fs",
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
```

```js
// src/scenarios/http-users-db.js
export default {
  id: "http-users-db",
  title: "HTTP GET /api/users + DB query",
  route: "/api/users",
  description:
    "The full request lifecycle: a request arrives, the handler runs synchronously, " +
    "issues a non-blocking DB query (thread pool), and returns. When the DB query " +
    "completes, its callback runs in the poll phase and the response is sent.",
  code: [
    "app.get('/api/users', (req, res) => {",        // 0
    "  db.query('SELECT * FROM users', (rows) => {", // 1
    "    res.json(rows);",                            // 2
    "  });",                                           // 3
    "});",                                             // 4
  ].join("\n"),
  run(api) {
    api.httpRequest({ route: "/api/users", label: "GET /api/users", line: 0,
      explanation: "Incoming HTTP request received by the server" });
    api.call("usersHandler", { line: 0, type: "async", explanation: "Route handler runs on the call stack" });
    api.startIO({ ioType: "db", label: "SELECT * FROM users", line: 1,
      explanation: "DB query dispatched (non-blocking) — handler does not wait",
      onComplete: () => {
        api.call("res.json", { line: 2, type: "completed", explanation: "DB callback runs: send the response" });
        api.return({ line: 2 });
      } });
    api.return({ line: 4, explanation: "Handler returns; event loop is free to handle other work while the DB query runs" });
    api.mark("event loop start");
    api.runLoop();
  },
};
```

```js
// src/scenarios/index.js
import nextTickVsPromise from "./nexttick-vs-promise.js";
import promiseVsCallback from "./promise-vs-callback.js";
import timeoutVsImmediate from "./timeout-vs-immediate.js";
import syncVsAsyncFs from "./sync-vs-async-fs.js";
import httpUsersDb from "./http-users-db.js";

export const scenarios = [
  nextTickVsPromise,
  promiseVsCallback,
  timeoutVsImmediate,
  syncVsAsyncFs,
  httpUsersDb,
];
```

Note: in `http-users-db`, the `onComplete` callback calls `api.call`/`api.return` — these
run during `completeReadyIO`'s poll-phase callback execution, which is exactly when a real
DB callback would fire. The scheduler's `runPhase` invokes `entry.cb()` while the callback
token is on the stack, so nested `api.call` frames stack correctly on top.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scenarios.test.mjs`
Expected: PASS (all scenario tests).

Also run the full engine suite to confirm nothing regressed:
Run: `node --test`
Expected: PASS (all test files).

- [ ] **Step 5: Commit**

```bash
git add src/scenarios/ tests/scenarios.test.mjs
git commit -m "feat: add remaining four Phase-1 scenarios"
```

---

## Task 7: HTML shell, theme CSS, and theme toggle

Now build the UI shell. From here, verification is by running a static server and viewing
the page (UI modules are not unit-tested per the spec).

**Files:**
- Create: `index.html`
- Create: `styles/theme.css`
- Create: `styles/layout.css`
- Create: `src/ui/theme.js`

- [ ] **Step 1: Create the HTML shell**

```html
<!-- index.html -->
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Node.js Internals Simulator</title>
  <link rel="stylesheet" href="styles/theme.css" />
  <link rel="stylesheet" href="styles/layout.css" />
</head>
<body>
  <header class="topbar">
    <h1>Node.js Internals Simulator</h1>
    <div class="topbar-controls">
      <select id="scenario-picker" aria-label="Choose scenario"></select>
      <button id="theme-toggle" aria-label="Toggle theme">🌓 Theme</button>
    </div>
  </header>

  <main id="app" class="app-grid">
    <section id="code-panel" class="panel"></section>
    <section id="callstack-panel" class="panel"></section>
    <section id="eventloop-panel" class="panel"></section>
    <section id="queues-panel" class="panel"></section>
    <section id="threadpool-panel" class="panel"></section>
    <section id="request-panel" class="panel"></section>
    <section id="explain-panel" class="panel"></section>
  </main>

  <footer id="controls" class="controls"></footer>

  <script type="module" src="src/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create theme.css (CSS custom properties)**

```css
/* styles/theme.css */
:root[data-theme="dark"] {
  --bg: #0d1117;
  --panel-bg: #161b22;
  --panel-border: #30363d;
  --text: #e6edf3;
  --text-dim: #8b949e;
  --accent: #58a6ff;
  --active-line: #1f6feb33;
  /* token type colors */
  --c-sync: #58a6ff;
  --c-async: #3fb950;
  --c-blocking: #f85149;
  --c-db: #d2a8ff;
  --c-file: #ffa657;
  --c-network: #79c0ff;
  --c-timer: #e3b341;
  --c-promise: #56d364;
  --c-nexttick: #ff7b72;
  --c-completed: #2ea043;
  --c-waiting: #8b949e;
}

:root[data-theme="light"] {
  --bg: #ffffff;
  --panel-bg: #f6f8fa;
  --panel-border: #d0d7de;
  --text: #1f2328;
  --text-dim: #656d76;
  --accent: #0969da;
  --active-line: #ddf4ff;
  --c-sync: #0969da;
  --c-async: #1a7f37;
  --c-blocking: #cf222e;
  --c-db: #8250df;
  --c-file: #bc4c00;
  --c-network: #0550ae;
  --c-timer: #9a6700;
  --c-promise: #1a7f37;
  --c-nexttick: #cf222e;
  --c-completed: #1a7f37;
  --c-waiting: #656d76;
}
```

- [ ] **Step 3: Create layout.css**

```css
/* styles/layout.css */
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
}
.topbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 20px; border-bottom: 1px solid var(--panel-border);
}
.topbar h1 { font-size: 18px; margin: 0; }
.topbar-controls { display: flex; gap: 10px; }
select, button {
  background: var(--panel-bg); color: var(--text);
  border: 1px solid var(--panel-border); border-radius: 6px;
  padding: 6px 10px; cursor: pointer; font-size: 13px;
}
.app-grid {
  display: grid; gap: 12px; padding: 16px;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-areas:
    "code   callstack eventloop"
    "code   queues    eventloop"
    "request threadpool explain";
}
#code-panel { grid-area: code; }
#callstack-panel { grid-area: callstack; }
#eventloop-panel { grid-area: eventloop; }
#queues-panel { grid-area: queues; }
#threadpool-panel { grid-area: threadpool; }
#request-panel { grid-area: request; }
#explain-panel { grid-area: explain; }
.panel {
  background: var(--panel-bg); border: 1px solid var(--panel-border);
  border-radius: 8px; padding: 12px; min-height: 120px; overflow: auto;
}
.panel h2 { font-size: 13px; margin: 0 0 10px; color: var(--text-dim);
  text-transform: uppercase; letter-spacing: 0.5px; }
/* code panel */
.code-line { font-family: ui-monospace, monospace; font-size: 13px;
  white-space: pre; padding: 1px 6px; border-radius: 3px; }
.code-line.active { background: var(--active-line); }
/* token */
.token {
  display: inline-block; padding: 3px 8px; margin: 3px; border-radius: 5px;
  font-size: 12px; font-family: ui-monospace, monospace; color: #fff;
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.token[data-type="sync"] { background: var(--c-sync); }
.token[data-type="async"] { background: var(--c-async); }
.token[data-type="blocking"] { background: var(--c-blocking); }
.token[data-type="db"] { background: var(--c-db); }
.token[data-type="file"] { background: var(--c-file); }
.token[data-type="network"] { background: var(--c-network); }
.token[data-type="timer"] { background: var(--c-timer); }
.token[data-type="promise"] { background: var(--c-promise); }
.token[data-type="nexttick"] { background: var(--c-nexttick); }
.token[data-type="completed"] { background: var(--c-completed); }
.token[data-type="waiting"] { background: var(--c-waiting); }
/* event loop phases */
.phase { padding: 8px; margin: 4px 0; border-radius: 6px;
  border: 1px solid var(--panel-border); font-size: 13px; }
.phase.active { border-color: var(--accent); background: var(--active-line);
  font-weight: 600; }
/* thread pool slots */
.slot { display: inline-flex; align-items: center; justify-content: center;
  width: 90px; height: 36px; margin: 4px; border-radius: 6px;
  border: 1px dashed var(--panel-border); font-size: 11px; }
.slot.busy { border-style: solid; }
/* controls */
.controls { display: flex; align-items: center; gap: 10px;
  padding: 12px 20px; border-top: 1px solid var(--panel-border); flex-wrap: wrap; }
.controls input[type="range"] { flex: 1; min-width: 150px; }
.queue-group { margin-bottom: 10px; }
.queue-group .queue-label { font-size: 11px; color: var(--text-dim); }
.badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
.badge.blocking { background: var(--c-blocking); color: #fff; }
.badge.nonblocking { background: var(--c-async); color: #fff; }

@media (max-width: 900px) {
  .app-grid {
    grid-template-columns: 1fr;
    grid-template-areas:
      "code" "callstack" "eventloop" "queues" "threadpool" "request" "explain";
  }
}
```

- [ ] **Step 4: Create theme.js**

```js
// src/ui/theme.js
const KEY = "nodesim-theme";

export function initTheme(toggleButton) {
  const saved = localStorage.getItem(KEY) || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  toggleButton.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(KEY, next);
  });
}
```

- [ ] **Step 5: Verify in browser, then commit**

Run a static server and open the page:
```bash
python3 -m http.server 8000
```
Open `http://localhost:8000/` — expect the topbar, an empty panel grid, and a theme toggle.
Clicking 🌓 Theme should switch dark/light and persist across reload. (app.js does not exist
yet, so the console will show a 404/module error for app.js — that is expected until Task 11.)

```bash
git add index.html styles/ src/ui/theme.js
git commit -m "feat: HTML shell, dark/light theme CSS, and theme toggle"
```

---

## Task 8: Renderer — code panel, call stack, explain panel

**Files:**
- Create: `src/ui/codePanel.js`
- Create: `src/ui/callStack.js`
- Create: `src/ui/explainPanel.js`

- [ ] **Step 1: Create codePanel.js**

```js
// src/ui/codePanel.js
// Renders the scenario source with the active line highlighted.
export function renderCodePanel(el, scenario, frame) {
  const lines = scenario.code.split("\n");
  el.innerHTML = "<h2>Source</h2>";
  lines.forEach((line, i) => {
    const div = document.createElement("div");
    div.className = "code-line" + (frame.activeLine === i ? " active" : "");
    div.textContent = line === "" ? " " : line;
    el.appendChild(div);
  });
}
```

- [ ] **Step 2: Create callStack.js**

```js
// src/ui/callStack.js
// Renders the call stack, top frame last. Tokens carry data-id for FLIP.
export function renderCallStack(el, frame) {
  el.innerHTML = "<h2>Call Stack</h2>";
  // render top-of-stack first (visually on top)
  [...frame.callStack].reverse().forEach((t) => {
    const div = document.createElement("div");
    div.className = "token";
    div.dataset.type = t.type;
    div.dataset.id = t.id;
    div.textContent = t.label;
    el.appendChild(div);
  });
  if (frame.callStack.length === 0) {
    const empty = document.createElement("div");
    empty.style.color = "var(--text-dim)";
    empty.style.fontSize = "12px";
    empty.textContent = "(empty — nothing executing)";
    el.appendChild(empty);
  }
}
```

- [ ] **Step 3: Create explainPanel.js**

```js
// src/ui/explainPanel.js
// Renders the per-frame explanation + blocking/non-blocking badge + active phase.
export function renderExplainPanel(el, frame) {
  el.innerHTML = "<h2>What's happening</h2>";
  const badge = document.createElement("span");
  badge.className = "badge " + (frame.blocking ? "blocking" : "nonblocking");
  badge.textContent = frame.blocking ? "BLOCKING" : "non-blocking";
  el.appendChild(badge);

  if (frame.activePhase) {
    const phase = document.createElement("span");
    phase.className = "badge";
    phase.style.marginLeft = "8px";
    phase.style.background = "var(--accent)";
    phase.style.color = "#fff";
    phase.textContent = "phase: " + frame.activePhase;
    el.appendChild(phase);
  }

  const p = document.createElement("p");
  p.style.marginTop = "10px";
  p.style.fontSize = "14px";
  p.style.lineHeight = "1.5";
  p.textContent = frame.explanation;
  el.appendChild(p);
}
```

- [ ] **Step 4: Verify by temporary import (no commit yet) — skip, covered in Task 11**

These are pure functions wired up in Task 11. No standalone run step here.

- [ ] **Step 5: Commit**

```bash
git add src/ui/codePanel.js src/ui/callStack.js src/ui/explainPanel.js
git commit -m "feat: code panel, call stack, and explanation renderers"
```

---

## Task 9: Renderer — event loop, queues, thread pool, request lane

**Files:**
- Create: `src/ui/eventLoop.js`
- Create: `src/ui/queues.js`
- Create: `src/ui/threadPool.js`
- Create: `src/ui/requestLane.js`

- [ ] **Step 1: Create eventLoop.js**

```js
// src/ui/eventLoop.js
const PHASES = [
  ["timers", "setTimeout / setInterval callbacks whose time has elapsed"],
  ["pending", "I/O callbacks deferred from a previous loop iteration"],
  ["poll", "Retrieve new I/O events; execute I/O-related callbacks"],
  ["check", "setImmediate() callbacks run here"],
  ["close", "close event callbacks, e.g. socket.on('close')"],
];

export function renderEventLoop(el, frame) {
  el.innerHTML = "<h2>Event Loop Phases</h2>";
  PHASES.forEach(([name, purpose]) => {
    const div = document.createElement("div");
    div.className = "phase" + (frame.activePhase === name ? " active" : "");
    const count = frame.macro[name] ? frame.macro[name].length : 0;
    div.innerHTML = `<strong>${name}</strong> <span style="color:var(--text-dim)">(${count})</span>` +
      `<div style="font-size:11px;color:var(--text-dim);margin-top:2px">${purpose}</div>`;
    el.appendChild(div);
  });
}
```

- [ ] **Step 2: Create queues.js**

```js
// src/ui/queues.js
// Renders microtask queues (nextTick + promises) and macrotask queues.
function renderGroup(parent, label, tokens) {
  const group = document.createElement("div");
  group.className = "queue-group";
  const lbl = document.createElement("div");
  lbl.className = "queue-label";
  lbl.textContent = `${label} (${tokens.length})`;
  group.appendChild(lbl);
  tokens.forEach((t) => {
    const div = document.createElement("div");
    div.className = "token";
    div.dataset.type = t.type;
    div.dataset.id = t.id;
    div.textContent = t.label;
    group.appendChild(div);
  });
  parent.appendChild(group);
}

export function renderQueues(el, frame) {
  el.innerHTML = "<h2>Queues</h2>";
  renderGroup(el, "nextTick queue", frame.microtasks.nextTick);
  renderGroup(el, "promise microtasks", frame.microtasks.promises);
  renderGroup(el, "timers", frame.macro.timers);
  renderGroup(el, "pending", frame.macro.pending);
  renderGroup(el, "poll", frame.macro.poll);
  renderGroup(el, "check", frame.macro.check);
  renderGroup(el, "close", frame.macro.close);
}
```

- [ ] **Step 3: Create threadPool.js**

```js
// src/ui/threadPool.js
// Renders libuv thread-pool slots and the list of in-flight I/O.
export function renderThreadPool(el, frame) {
  el.innerHTML = "<h2>libuv Thread Pool</h2>";
  const slots = document.createElement("div");
  frame.threadPool.forEach((slot, i) => {
    const div = document.createElement("div");
    div.className = "slot" + (slot ? " busy" : "");
    if (slot) {
      div.dataset.type = slot.type;
      div.dataset.id = slot.id;
      div.style.color = "#fff";
      div.style.background = `var(--c-${slot.type})`;
      div.textContent = slot.label;
    } else {
      div.style.color = "var(--text-dim)";
      div.textContent = `slot ${i + 1}`;
    }
    slots.appendChild(div);
  });
  el.appendChild(slots);

  const io = document.createElement("div");
  io.className = "queue-group";
  const lbl = document.createElement("div");
  lbl.className = "queue-label";
  lbl.textContent = `in-flight I/O (${frame.io.length})`;
  io.appendChild(lbl);
  frame.io.forEach((t) => {
    const d = document.createElement("div");
    d.className = "token";
    d.dataset.type = t.type;
    d.dataset.id = t.id;
    d.textContent = t.label;
    io.appendChild(d);
  });
  el.appendChild(io);
}
```

- [ ] **Step 4: Create requestLane.js**

```js
// src/ui/requestLane.js
// Renders incoming HTTP requests and their lifecycle stage.
export function renderRequestLane(el, frame) {
  el.innerHTML = "<h2>HTTP Requests</h2>";
  if (frame.requests.length === 0) {
    const empty = document.createElement("div");
    empty.style.color = "var(--text-dim)";
    empty.style.fontSize = "12px";
    empty.textContent = "(no active requests)";
    el.appendChild(empty);
    return;
  }
  frame.requests.forEach((r) => {
    const div = document.createElement("div");
    div.className = "token";
    div.dataset.type = "network";
    div.textContent = `${r.route} — ${r.stage}`;
    el.appendChild(div);
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/ui/eventLoop.js src/ui/queues.js src/ui/threadPool.js src/ui/requestLane.js
git commit -m "feat: event loop, queues, thread pool, and request lane renderers"
```

---

## Task 10: Controls renderer (play/pause/step/speed/scrub/jump)

**Files:**
- Create: `src/ui/controls.js`

- [ ] **Step 1: Create controls.js**

```js
// src/ui/controls.js
// Builds playback controls. Callbacks are supplied by app.js; this module owns no state.
export function renderControls(el, { frameCount, keyFrames, handlers }) {
  el.innerHTML = "";

  const mk = (label, onClick) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  };

  el.appendChild(mk("⏮ Prev", handlers.prev));
  const playBtn = mk("▶ Play", handlers.togglePlay);
  playBtn.id = "play-btn";
  el.appendChild(playBtn);
  el.appendChild(mk("⏭ Next", handlers.next));
  el.appendChild(mk("🔄 Restart", handlers.restart));

  const speed = document.createElement("select");
  [0.25, 0.5, 1, 2, 4].forEach((s) => {
    const o = document.createElement("option");
    o.value = String(s);
    o.textContent = `${s}x`;
    if (s === 1) o.selected = true;
    speed.appendChild(o);
  });
  speed.addEventListener("change", () => handlers.setSpeed(parseFloat(speed.value)));
  el.appendChild(speed);

  if (keyFrames.length) {
    const jump = document.createElement("select");
    const def = document.createElement("option");
    def.textContent = "🎯 Jump to…";
    def.value = "";
    jump.appendChild(def);
    keyFrames.forEach((kf) => {
      const o = document.createElement("option");
      o.value = String(kf.index);
      o.textContent = kf.label;
      jump.appendChild(o);
    });
    jump.addEventListener("change", () => {
      if (jump.value !== "") handlers.jump(parseInt(jump.value, 10));
    });
    el.appendChild(jump);
  }

  const scrubber = document.createElement("input");
  scrubber.type = "range";
  scrubber.min = "0";
  scrubber.max = String(frameCount - 1);
  scrubber.value = "0";
  scrubber.id = "scrubber";
  scrubber.addEventListener("input", () => handlers.scrub(parseInt(scrubber.value, 10)));
  el.appendChild(scrubber);

  const counter = document.createElement("span");
  counter.id = "frame-counter";
  counter.style.fontSize = "12px";
  counter.style.color = "var(--text-dim)";
  el.appendChild(counter);
}

// Called by app.js on every frame change to sync scrubber + counter + play button label.
export function updateControls({ index, frameCount, playing }) {
  const scrubber = document.getElementById("scrubber");
  if (scrubber) scrubber.value = String(index);
  const counter = document.getElementById("frame-counter");
  if (counter) counter.textContent = `${index + 1} / ${frameCount}`;
  const playBtn = document.getElementById("play-btn");
  if (playBtn) playBtn.textContent = playing ? "⏸ Pause" : "▶ Play";
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/controls.js
git commit -m "feat: playback controls renderer"
```

---

## Task 11: app.js — wire everything together + FLIP animation

**Files:**
- Create: `src/app.js`

- [ ] **Step 1: Create app.js**

```js
// src/app.js
import { scenarios } from "./scenarios/index.js";
import { simulate } from "./engine/scheduler.js";
import { initTheme } from "./ui/theme.js";
import { renderCodePanel } from "./ui/codePanel.js";
import { renderCallStack } from "./ui/callStack.js";
import { renderExplainPanel } from "./ui/explainPanel.js";
import { renderEventLoop } from "./ui/eventLoop.js";
import { renderQueues } from "./ui/queues.js";
import { renderThreadPool } from "./ui/threadPool.js";
import { renderRequestLane } from "./ui/requestLane.js";
import { renderControls, updateControls } from "./ui/controls.js";

const els = {
  picker: document.getElementById("scenario-picker"),
  themeToggle: document.getElementById("theme-toggle"),
  code: document.getElementById("code-panel"),
  callstack: document.getElementById("callstack-panel"),
  eventloop: document.getElementById("eventloop-panel"),
  queues: document.getElementById("queues-panel"),
  threadpool: document.getElementById("threadpool-panel"),
  request: document.getElementById("request-panel"),
  explain: document.getElementById("explain-panel"),
  controls: document.getElementById("controls"),
};

initTheme(els.themeToggle);

let state = { scenario: null, frames: [], keyFrames: [], index: 0, playing: false, speed: 1, timer: null };

// Populate scenario picker
scenarios.forEach((s) => {
  const o = document.createElement("option");
  o.value = s.id;
  o.textContent = `${s.title}`;
  els.picker.appendChild(o);
});
els.picker.addEventListener("change", () => loadScenario(els.picker.value));

// --- FLIP animation: record token positions before re-render, animate after ---
function recordPositions() {
  const map = new Map();
  document.querySelectorAll(".token[data-id]").forEach((el) => {
    map.set(el.dataset.id, el.getBoundingClientRect());
  });
  return map;
}
function playFlip(prevPositions) {
  document.querySelectorAll(".token[data-id]").forEach((el) => {
    const prev = prevPositions.get(el.dataset.id);
    if (!prev) return;
    const next = el.getBoundingClientRect();
    const dx = prev.left - next.left;
    const dy = prev.top - next.top;
    if (dx === 0 && dy === 0) return;
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    el.style.transition = "none";
    requestAnimationFrame(() => {
      el.style.transition = "transform 0.25s ease";
      el.style.transform = "";
    });
  });
}

function render() {
  const frame = state.frames[state.index];
  const prev = recordPositions();
  renderCodePanel(els.code, state.scenario, frame);
  renderCallStack(els.callstack, frame);
  renderEventLoop(els.eventloop, frame);
  renderQueues(els.queues, frame);
  renderThreadPool(els.threadpool, frame);
  renderRequestLane(els.request, frame);
  renderExplainPanel(els.explain, frame);
  playFlip(prev);
  updateControls({ index: state.index, frameCount: state.frames.length, playing: state.playing });
}

function goto(i) {
  state.index = Math.max(0, Math.min(state.frames.length - 1, i));
  render();
}

function stopTimer() {
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
}
function play() {
  if (state.index >= state.frames.length - 1) goto(0);
  state.playing = true;
  stopTimer();
  state.timer = setInterval(() => {
    if (state.index >= state.frames.length - 1) { pause(); return; }
    goto(state.index + 1);
  }, 700 / state.speed);
  updateControls({ index: state.index, frameCount: state.frames.length, playing: true });
}
function pause() {
  state.playing = false;
  stopTimer();
  updateControls({ index: state.index, frameCount: state.frames.length, playing: false });
}

const handlers = {
  prev: () => { pause(); goto(state.index - 1); },
  next: () => { pause(); goto(state.index + 1); },
  togglePlay: () => (state.playing ? pause() : play()),
  restart: () => { pause(); goto(0); },
  setSpeed: (s) => { state.speed = s; if (state.playing) play(); },
  jump: (i) => { pause(); goto(i); },
  scrub: (i) => { pause(); goto(i); },
};

function loadScenario(id) {
  pause();
  const scenario = scenarios.find((s) => s.id === id) || scenarios[0];
  let result;
  try {
    result = simulate(scenario);
  } catch (err) {
    els.explain.innerHTML = `<h2>Error</h2><p style="color:var(--c-blocking)">Failed to simulate: ${err.message}</p>`;
    return;
  }
  state.scenario = scenario;
  state.frames = result.frames;
  state.keyFrames = result.keyFrames;
  state.index = 0;
  renderControls(els.controls, {
    frameCount: state.frames.length,
    keyFrames: state.keyFrames,
    handlers,
  });
  render();
}

// boot
loadScenario(scenarios[0].id);
```

- [ ] **Step 2: Verify in browser**

```bash
python3 -m http.server 8000
```
Open `http://localhost:8000/`. Verify:
- Scenario picker lists all 5 scenarios; switching loads the new code + resets to frame 0.
- ▶ Play steps through frames automatically; ⏸ Pause stops; ⏭/⏮ step one frame; 🔄 restarts.
- Speed selector changes playback rate; scrubber scrubs; 🎯 Jump moves to key frames.
- Tokens appear in the call stack, queues, and thread pool, and animate (slide) between
  panels as frames advance.
- The explain panel shows per-frame text + a blocking/non-blocking badge + active phase.
- For `http-users-db`: a request appears, a DB token occupies a thread-pool slot, then a
  completion callback runs in the poll phase.
- For `sync-vs-async-fs`: the blocking read shows a red BLOCKING badge; the async read uses
  the thread pool.

- [ ] **Step 3: Commit**

```bash
git add src/app.js
git commit -m "feat: wire app together with FLIP token animation"
```

---

## Task 12: Final verification pass + README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Run the full test suite**

Run: `node --test`
Expected: PASS — all of `state.test.mjs`, `scheduler.test.mjs`, `scenarios.test.mjs`.

- [ ] **Step 2: Manual UI checklist (browser)**

Walk every scenario end-to-end with Play, then step backward with ⏮ to confirm backward
stepping and scrubbing reproduce identical state (deterministic frames). Toggle the theme
and reload to confirm persistence. Resize below 900px to confirm the grid stacks vertically.

- [ ] **Step 3: Write README.md**

```markdown
# Node.js Internals Simulator

An interactive, frame-by-frame visualizer of how Node.js executes code: the call stack,
the event loop's six phases, microtask queues (nextTick + promises), macrotask queues,
and libuv thread-pool I/O.

## Run

No build step. Serve the folder with any static server:

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

## Test the engine

```bash
node --test
```

## Scenarios (Phase 1)

- process.nextTick() vs Promise
- Promise (microtask) vs setTimeout (macrotask)
- setTimeout(0) vs setImmediate()
- fs.readFileSync (blocking) vs fs.readFile (non-blocking)
- HTTP GET /api/users + DB query

## Architecture

`scenario.run(api)` → `simulate()` produces an immutable array of `frames` (full state
snapshots). The UI is a pure function of `frames[index]`; playback just moves the index.
Adding a scenario = drop a file in `src/scenarios/` and register it in `index.js`.

See `docs/superpowers/specs/` and `docs/superpowers/plans/` for design and plan docs.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README with run, test, and architecture notes"
```

---

## Notes for the implementing engineer

- **Git:** This directory is not yet a git repo. Before Task 1's first commit, run
  `git init` and make an initial commit of the existing `docs/` folder, or the commit
  steps will fail.
- **TDD discipline:** Tasks 1–6 are strict TDD (test first, watch it fail, implement, watch
  it pass). Tasks 7–12 are UI and verified by running the page, since the spec specifies the
  engine is the unit-tested surface.
- **Determinism is the contract:** the renderer must never mutate engine state. If a UI
  module needs derived data, compute it locally from the frame — do not write back.
- **Adding scenarios later (Phase 2):** the authoring API (`call`, `return`, `nextTick`,
  `promiseThen`, `queueMicrotask`, `setTimeout`, `setImmediate`, `startIO`, `httpRequest`,
  `runLoop`, `drainMicrotasks`, `mark`) is the stable contract. Phase 2 should not need to
  change the scheduler or renderer.
```
