# Node.js Internals Simulator — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the simulator with a realistic 12-route API scenario catalog (each showing one signature production workload), a small additive engine verb for CPU-blocking, and light UI structure (grouped picker + scenario-info panel) to keep the larger catalog navigable and instructive.

**Architecture:** Build on the Phase 1 engine unchanged except for one additive authoring verb (`cpuWork`) and three new I/O token-type strings (`cache`, `crypto`, `compress`) plus a `cpu` token type — all reusing existing mechanics. Scenarios remain plain data modules using the authoring API. A new pure renderer shows per-scenario context. The frame pipeline is untouched.

**Tech Stack:** Vanilla HTML/CSS/JavaScript (ES modules), `node:test`, CSS custom properties. No build step, no dependencies.

---

## Catalog correction (important context for the engineer)

The current catalog is **not** "5 concepts". It is **4 concept scenarios** (`nexttick-vs-promise`, `promise-vs-callback`, `timeout-vs-immediate`, `sync-vs-async-fs`) **plus `http-users-db`**, which already implements the `GET /api/users` route. Phase 2 therefore:

- Retrofits the 4 concept scenarios with `category: "concept"`.
- Recategorizes `http-users-db` as `category: "route"` (it IS the users route) and adds `tags`/`watchFor`.
- Adds **11 new** route scenarios.

Final catalog: **4 concept + 12 route = 16 scenarios**.

## File Structure

```
src/engine/scheduler.js     # MODIFY: add cpuWork verb
src/ui/scenarioInfo.js       # NEW: renders route/description/tags/watchFor (scenario-level)
src/scenarios/index.js       # MODIFY: register 11 new route scenarios
src/scenarios/<concept>.js    # MODIFY x4: add category/tags/watchFor
src/scenarios/http-users-db.js # MODIFY: add category/tags/watchFor
src/scenarios/route-orders.js       # NEW
src/scenarios/route-dashboard.js    # NEW
src/scenarios/route-login.js        # NEW
src/scenarios/route-upload.js       # NEW
src/scenarios/route-reports.js      # NEW
src/scenarios/route-export.js       # NEW
src/scenarios/route-analytics.js    # NEW
src/scenarios/route-products.js     # NEW
src/scenarios/route-payment.js      # NEW
src/scenarios/route-search.js       # NEW
src/scenarios/route-documents.js    # NEW
src/app.js                   # MODIFY: optgroup picker + wire scenario-info panel
index.html                   # MODIFY: add scenario-info panel element
styles/theme.css             # MODIFY: add --c-cache/crypto/compress/cpu (both themes)
styles/layout.css            # MODIFY: token colors, .tag chip, scenario-info styles, grid
tests/scheduler.test.mjs     # MODIFY: cpuWork test
tests/scenarios.test.mjs     # MODIFY: metadata + behavioral tests
```

## Authoring API reference (already implemented in Phase 1)

`call(label,{line,type,blocking,explanation})`, `return({line,explanation})`,
`nextTick(cb,{...})`, `promiseThen(cb,{...})`, `queueMicrotask(cb,{...})`,
`setTimeout(cb,delay,{...})`, `setImmediate(cb,{...})`,
`startIO({ioType,label,line,explanation,onComplete,turns})` (turns defaults 1; occupies a
thread-pool slot; completion callback runs in the poll phase),
`httpRequest({route,label,line,explanation})` → returns a request id,
`setRequestStage(id,stage,{line,explanation})`, `runLoop()`, `drainMicrotasks()`,
`mark(label)`. Phase 2 adds **`cpuWork({label,line,steps,explanation})`**.

Scenario shape: `{ id, title, route, description, code, run, category, tags, watchFor }`.

---

## Task 1: Engine — `cpuWork` verb and loop-waiting frames

Two additive scheduler changes: the `cpuWork` verb (CPU-blocking) and "poll waiting" frames
so slow I/O is visible as the loop cycles.

**Files:**
- Modify: `src/engine/scheduler.js`
- Modify: `tests/scheduler.test.mjs`

- [ ] **Step 1: Append the failing tests to `tests/scheduler.test.mjs`**

```js
test("cpuWork holds the stack for the configured steps with a blocking flag, then returns", () => {
  const fs = frames((api) => {
    api.call("main", { line: 0 });
    api.cpuWork({ label: "hashLoop", steps: 3 });
    api.return();
  });
  const blocking = fs.filter((f) => f.blocking && f.callStack.some((t) => t.type === "cpu"));
  assert.equal(blocking.length, 3, "should emit one blocking frame per step");
  const last = fs[fs.length - 1];
  assert.ok(!last.callStack.some((t) => t.type === "cpu"), "cpu token gone after return");
  assert.deepEqual(last.callStack.map((t) => t.label), [], "stack empty at end");
});

test("cpuWork defaults to 4 steps when steps is omitted", () => {
  const fs = frames((api) => { api.cpuWork({ label: "work" }); });
  const blocking = fs.filter((f) => f.blocking && f.callStack.some((t) => t.type === "cpu"));
  assert.equal(blocking.length, 4);
});

test("runLoop emits poll-waiting frames while slow I/O is still in flight", () => {
  const fs = frames((api) => {
    api.startIO({ ioType: "db", label: "slow", turns: 6, onComplete: () => {} });
    api.runLoop();
  });
  const waiting = fs.filter((f) => f.activePhase === "poll" && f.explanation.includes("waiting for I/O"));
  assert.ok(waiting.length >= 1, "should show the loop waiting in poll while I/O runs");
  assert.ok(waiting.every((f) => f.io.length >= 1), "I/O token still present during waits");
});

test("fast (1-turn) I/O does NOT produce a poll-waiting frame", () => {
  const fs = frames((api) => {
    api.startIO({ ioType: "db", label: "fast", turns: 1, onComplete: () => {} });
    api.runLoop();
  });
  const waiting = fs.filter((f) => f.explanation.includes("waiting for I/O"));
  assert.equal(waiting.length, 0, "fast I/O completes on the first poll, no waiting frame");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/scheduler.test.mjs`
Expected: FAIL — `api.cpuWork is not a function` and no waiting frames.

- [ ] **Step 3a: Add the `cpuWork` method to the `api` object in `src/engine/scheduler.js`**

Insert immediately after the `setImmediate` method (after its closing `},`):

```js
    cpuWork(meta = {}) {
      const steps = meta.steps || 4;
      const token = makeToken("cpu", meta.label || "CPU work");
      state.callStack.push(token);
      const base = meta.explanation || `${token.label}: CPU-bound work blocking the event loop`;
      for (let i = 1; i <= steps; i++) {
        emit({ activeLine: meta.line, blocking: true,
               explanation: `${base} (${i}/${steps})`, changed: ["callStack"] });
      }
      state.callStack.pop();
      emit({ activeLine: meta.line, explanation: `${token.label} finished — event loop free again`,
             changed: ["callStack"] });
    },
```

- [ ] **Step 3b: Add loop-waiting frames to `runLoop` in `src/engine/scheduler.js`**

Replace the existing `runLoop` function:

```js
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

with this version (tracks whether the turn produced any frame; if not and I/O is still in
flight, emit a single poll-waiting frame so slow I/O is visible):

```js
  function runLoop() {
    // drain microtasks left from top-level script first
    drainMicrotasks();
    let guard = 0;
    while ((macroPending() || ioPending()) && guard < 1000) {
      guard += 1;
      const before = frames.length;
      for (const phase of PHASES) {
        if (phase === "poll") completeReadyIO(); // I/O completions surface in poll
        runPhase(phase);
      }
      // if only I/O remains in flight, advance it on the next turn
      if (!macroPending() && ioPending()) completeReadyIO();
      // If this turn produced no frames but I/O is still pending, show the loop cycling in
      // the poll phase, waiting for I/O — otherwise slow I/O would be invisible.
      if (frames.length === before && ioPending()) {
        state.activePhase = "poll";
        emit({ explanation: "poll phase: waiting for I/O to complete (the event loop is free, not blocked)",
               changed: [] });
        state.activePhase = null;
      }
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/scheduler.test.mjs`
Expected: PASS — all scheduler tests, including the 4 new ones. (The existing Phase 1 I/O
test uses default 1-turn I/O and is unaffected.)

- [ ] **Step 5: Commit**

```bash
git add src/engine/scheduler.js tests/scheduler.test.mjs
git commit -m "feat: add cpuWork verb and loop-waiting frames for slow-I/O visibility"
```

---

## Task 2: Theme colors, token/tag/info CSS, and scenario-info panel element

Static UI scaffolding only (no JS behavior yet). Verified by serving the page.

**Files:**
- Modify: `styles/theme.css`
- Modify: `styles/layout.css`
- Modify: `index.html`

- [ ] **Step 1: Add new color variables to BOTH theme blocks in `styles/theme.css`**

In the `:root[data-theme="dark"]` block, after the `--c-waiting: ...;` line, add:

```css
  --c-cache: #f778ba;
  --c-crypto: #a371f7;
  --c-compress: #ffa657;
  --c-cpu: #f85149;
```

In the `:root[data-theme="light"]` block, after its `--c-waiting: ...;` line, add:

```css
  --c-cache: #bf3989;
  --c-crypto: #8250df;
  --c-compress: #bc4c00;
  --c-cpu: #cf222e;
```

- [ ] **Step 2: Add token type rules + tag chip + scenario-info styles to `styles/layout.css`**

After the existing `.token[data-type="waiting"] { ... }` rule, add:

```css
.token[data-type="cache"] { background: var(--c-cache); }
.token[data-type="crypto"] { background: var(--c-crypto); }
.token[data-type="compress"] { background: var(--c-compress); }
.token[data-type="cpu"] { background: var(--c-cpu); }
```

At the end of the file, add:

```css
/* scenario info panel */
.scenario-route { font-family: ui-monospace, monospace; font-size: 14px;
  font-weight: 600; color: var(--accent); margin-bottom: 6px; }
.scenario-desc { font-size: 13px; line-height: 1.5; margin: 0 0 10px; }
.scenario-watch { font-size: 12px; color: var(--text-dim); margin: 8px 0 0;
  border-left: 2px solid var(--accent); padding-left: 8px; }
.tag-row { display: flex; flex-wrap: wrap; gap: 6px; }
.tag { font-size: 11px; padding: 2px 8px; border-radius: 10px;
  background: var(--panel-border); color: var(--text); }
```

- [ ] **Step 3: Add the scenario-info panel to the grid in `styles/layout.css`**

Replace the existing `.app-grid { ... }` rule (the desktop one with `grid-template-areas`) with:

```css
.app-grid {
  display: grid; gap: 12px; padding: 16px;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-areas:
    "info    info      info"
    "code    callstack eventloop"
    "code    queues    eventloop"
    "request threadpool explain";
}
#scenario-info-panel { grid-area: info; }
```

And replace the existing `@media (max-width: 900px)` block's `grid-template-areas` with one that includes `info` first:

```css
@media (max-width: 900px) {
  .app-grid {
    grid-template-columns: 1fr;
    grid-template-areas:
      "info" "code" "callstack" "eventloop" "queues" "threadpool" "request" "explain";
  }
}
```

- [ ] **Step 4: Add the panel element to `index.html`**

Inside `<main id="app" class="app-grid">`, as the FIRST child (before `#code-panel`), add:

```html
    <section id="scenario-info-panel" class="panel"></section>
```

- [ ] **Step 5: Verify in browser, then commit**

```bash
python3 -m http.server 8000
```
Open `http://localhost:8000/` — the page still loads; an empty "scenario-info" panel now spans the top row. (It is populated in Task 5; expect it blank for now.) Toggle theme to confirm no CSS errors.

```bash
git add styles/theme.css styles/layout.css index.html
git commit -m "feat: add token/tag colors and scenario-info panel scaffolding"
```

---

## Task 3: `scenarioInfo` renderer

A pure, scenario-level renderer (not per-frame).

**Files:**
- Create: `src/ui/scenarioInfo.js`

- [ ] **Step 1: Create `src/ui/scenarioInfo.js`**

```js
// src/ui/scenarioInfo.js
// Renders scenario-level context: route, description, workload tags, and a watch-for hint.
// Pure function of the scenario object; called once on scenario load (not per frame).
export function renderScenarioInfo(el, scenario) {
  el.innerHTML = "<h2>Scenario</h2>";

  const route = document.createElement("div");
  route.className = "scenario-route";
  route.textContent = scenario.route;
  el.appendChild(route);

  const desc = document.createElement("p");
  desc.className = "scenario-desc";
  desc.textContent = scenario.description;
  el.appendChild(desc);

  if (scenario.tags && scenario.tags.length) {
    const row = document.createElement("div");
    row.className = "tag-row";
    scenario.tags.forEach((t) => {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.textContent = t;
      row.appendChild(chip);
    });
    el.appendChild(row);
  }

  if (scenario.watchFor) {
    const watch = document.createElement("p");
    watch.className = "scenario-watch";
    watch.textContent = "👀 " + scenario.watchFor;
    el.appendChild(watch);
  }
}
```

- [ ] **Step 2: Sanity-check syntax**

Run: `node --check src/ui/scenarioInfo.js`
Expected: no output (valid).

- [ ] **Step 3: Commit**

```bash
git add src/ui/scenarioInfo.js
git commit -m "feat: scenario-info renderer (route, description, tags, watch-for)"
```

---

## Task 4: Retrofit existing scenarios with metadata + metadata-validity test

**Files:**
- Modify: `src/scenarios/nexttick-vs-promise.js`
- Modify: `src/scenarios/promise-vs-callback.js`
- Modify: `src/scenarios/timeout-vs-immediate.js`
- Modify: `src/scenarios/sync-vs-async-fs.js`
- Modify: `src/scenarios/http-users-db.js`
- Modify: `tests/scenarios.test.mjs`

- [ ] **Step 1: Append the failing metadata test to `tests/scenarios.test.mjs`**

```js
test("every scenario has a valid category, tags array, and watchFor string", () => {
  for (const s of scenarios) {
    assert.ok(["concept", "route"].includes(s.category), `${s.id} category invalid: ${s.category}`);
    assert.ok(Array.isArray(s.tags) && s.tags.length > 0, `${s.id} must have non-empty tags`);
    assert.equal(typeof s.watchFor, "string", `${s.id} watchFor must be a string`);
    assert.ok(s.watchFor.length > 0, `${s.id} watchFor must be non-empty`);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/scenarios.test.mjs`
Expected: FAIL — existing scenarios have no `category`/`tags`/`watchFor`.

- [ ] **Step 3: Add metadata to each scenario file**

In `src/scenarios/nexttick-vs-promise.js`, add these three properties right after the `id:` line (i.e. as top-level object properties):

```js
  category: "concept",
  tags: ["microtasks", "nextTick", "promises"],
  watchFor: "The nextTick queue fully drains before any promise microtask runs.",
```

In `src/scenarios/promise-vs-callback.js`, after its `id:` line:

```js
  category: "concept",
  tags: ["microtask", "macrotask", "timers"],
  watchFor: "The promise microtask runs before the setTimeout callback, even at 0ms.",
```

In `src/scenarios/timeout-vs-immediate.js`, after its `id:` line:

```js
  category: "concept",
  tags: ["timers", "check", "phases"],
  watchFor: "Within one loop turn, the timers phase runs before the check phase.",
```

In `src/scenarios/sync-vs-async-fs.js`, after its `id:` line:

```js
  category: "concept",
  tags: ["file", "blocking", "non-blocking"],
  watchFor: "readFileSync freezes the call stack; readFile offloads to the thread pool.",
```

In `src/scenarios/http-users-db.js`, after its `id:` line:

```js
  category: "route",
  tags: ["DB", "non-blocking", "request-lifecycle"],
  watchFor: "The handler returns immediately; the DB callback runs later in the poll phase.",
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/scenarios.test.mjs`
Expected: PASS (the metadata test and all existing scenario tests).

- [ ] **Step 5: Commit**

```bash
git add src/scenarios/nexttick-vs-promise.js src/scenarios/promise-vs-callback.js src/scenarios/timeout-vs-immediate.js src/scenarios/sync-vs-async-fs.js src/scenarios/http-users-db.js tests/scenarios.test.mjs
git commit -m "feat: add category/tags/watchFor metadata to existing scenarios"
```

---

## Task 5: app.js — grouped picker + wire scenario-info panel

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Add the scenarioInfo import**

In `src/app.js`, after the line `import { renderControls, updateControls } from "./ui/controls.js";`, add:

```js
import { renderScenarioInfo } from "./ui/scenarioInfo.js";
```

- [ ] **Step 2: Add the panel element reference**

In the `els` object, add a `scenarioInfo` entry (after the `explain:` line):

```js
  scenarioInfo: document.getElementById("scenario-info-panel"),
```

- [ ] **Step 3: Replace the flat picker-population block with grouped optgroups**

Replace this existing block:

```js
// Populate scenario picker
scenarios.forEach((s) => {
  const o = document.createElement("option");
  o.value = s.id;
  o.textContent = `${s.title}`;
  els.picker.appendChild(o);
});
```

with:

```js
// Populate scenario picker, grouped by category
const GROUP_LABELS = { concept: "Concepts", route: "API Routes" };
const groupEls = {};
Object.entries(GROUP_LABELS).forEach(([key, label]) => {
  const og = document.createElement("optgroup");
  og.label = label;
  groupEls[key] = og;
  els.picker.appendChild(og);
});
const otherGroup = document.createElement("optgroup");
otherGroup.label = "Other";
scenarios.forEach((s) => {
  const o = document.createElement("option");
  o.value = s.id;
  o.textContent = `${s.title}`;
  (groupEls[s.category] || otherGroup).appendChild(o);
});
if (otherGroup.children.length) els.picker.appendChild(otherGroup);
```

- [ ] **Step 4: Render the scenario-info panel on load**

In `loadScenario`, immediately after the line `state.scenario = scenario;`, add:

```js
  renderScenarioInfo(els.scenarioInfo, scenario);
```

- [ ] **Step 5: Verify in browser**

```bash
python3 -m http.server 8000
```
Open `http://localhost:8000/`. Confirm:
- The picker now shows two groups: "Concepts" (4 entries) and "API Routes" (http-users-db).
- The scenario-info panel shows the route, description, tag chips, and a 👀 watch-for line.
- Switching scenarios updates the info panel.
Also confirm tests still pass: `node --test` → all green.

- [ ] **Step 6: Commit**

```bash
git add src/app.js
git commit -m "feat: grouped scenario picker and wired scenario-info panel"
```

---

## Task 6: Route scenarios batch A — orders, dashboard, login

**Files:**
- Create: `src/scenarios/route-orders.js`
- Create: `src/scenarios/route-dashboard.js`
- Create: `src/scenarios/route-login.js`
- Modify: `src/scenarios/index.js`
- Modify: `tests/scenarios.test.mjs`

- [ ] **Step 1: Append behavioral tests to `tests/scenarios.test.mjs`**

```js
test("route-orders: slow DB query keeps the loop spinning over multiple turns", () => {
  const s = scenarios.find((x) => x.id === "route-orders");
  assert.ok(s);
  const { frames } = simulate(s);
  // db I/O is in flight across several frames (slow query)
  const inflight = frames.filter((f) => f.io.some((t) => t.type === "db"));
  assert.ok(inflight.length >= 3, "slow query should be in flight for several frames");
});

test("route-dashboard: parallel queries occupy 2+ thread-pool slots at once", () => {
  const s = scenarios.find((x) => x.id === "route-dashboard");
  assert.ok(s);
  const { frames } = simulate(s);
  const parallel = frames.some((f) => f.threadPool.filter((slot) => slot !== null).length >= 2);
  assert.ok(parallel, "dashboard should run queries in parallel");
});

test("route-login: bcrypt runs as a crypto I/O on the thread pool", () => {
  const s = scenarios.find((x) => x.id === "route-login");
  assert.ok(s);
  const { frames } = simulate(s);
  assert.ok(frames.some((f) => f.io.some((t) => t.type === "crypto")));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/scenarios.test.mjs`
Expected: FAIL — `route-orders` not found (s is undefined).

- [ ] **Step 3: Create the three scenario files**

`src/scenarios/route-orders.js`:
```js
// src/scenarios/route-orders.js
export default {
  id: "route-orders",
  category: "route",
  title: "GET /api/orders — slow DB query",
  route: "GET /api/orders",
  description:
    "A slow database query takes many event-loop turns to complete. While it runs, the " +
    "event loop is NOT blocked — it keeps cycling through its phases, free to handle other work.",
  tags: ["DB", "slow-query", "non-blocking"],
  watchFor: "The event loop keeps cycling for many turns while the query is in flight — it never blocks.",
  code: [
    "app.get('/api/orders', (req, res) => {",                 // 0
    "  db.query('SELECT ... JOIN ... (slow)', (rows) => {",   // 1
    "    res.json(rows);",                                     // 2
    "  });",                                                    // 3
    "});",                                                      // 4
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "GET /api/orders", label: "GET /api/orders", line: 0,
      explanation: "Incoming request for orders" });
    api.call("ordersHandler", { line: 0, type: "async", explanation: "Handler runs" });
    api.setRequestStage(req, "querying (slow)", { line: 1 });
    api.startIO({ ioType: "db", label: "slow SELECT", line: 1, turns: 8,
      explanation: "Slow DB query dispatched — it will take several loop turns",
      onComplete: () => {
        api.setRequestStage(req, "responding", { line: 2 });
        api.call("res.json", { line: 2, type: "completed", explanation: "Query done — send response" });
        api.return({ line: 2 });
        api.setRequestStage(req, "completed", { line: 2 });
      } });
    api.setRequestStage(req, "waiting on slow query", { line: 1,
      explanation: "Handler returns; the loop is free while the slow query runs" });
    api.return({ line: 4, explanation: "Handler returns" });
    api.mark("event loop start");
    api.runLoop();
  },
};
```

`src/scenarios/route-dashboard.js`:
```js
// src/scenarios/route-dashboard.js
export default {
  id: "route-dashboard",
  category: "route",
  title: "GET /api/dashboard — parallel queries",
  route: "GET /api/dashboard",
  description:
    "The handler fires three independent data sources at once (Promise.all). They run " +
    "concurrently on the libuv thread pool and complete out of order; the response is sent " +
    "once all three finish.",
  tags: ["DB", "cache", "parallel", "Promise.all"],
  watchFor: "Three tasks occupy thread-pool slots simultaneously and finish out of order.",
  code: [
    "app.get('/api/dashboard', async (req, res) => {",        // 0
    "  const [a, b, c] = await Promise.all([",                // 1
    "    db.query('stats'), db.query('sales'), cache.get('widgets')", // 2
    "  ]);",                                                    // 3
    "  res.json({ a, b, c });",                                // 4
    "});",                                                      // 5
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "GET /api/dashboard", label: "GET /api/dashboard", line: 0,
      explanation: "Incoming dashboard request" });
    api.call("dashboardHandler", { line: 0, type: "async", explanation: "Handler runs" });
    api.setRequestStage(req, "fan-out (3 parallel)", { line: 1 });
    let done = 0;
    const total = 3;
    function finish(name) {
      done += 1;
      if (done === total) {
        api.setRequestStage(req, "responding", { line: 4 });
        api.call("res.json", { line: 4, type: "completed", explanation: "All three done — send response" });
        api.return({ line: 4 });
        api.setRequestStage(req, "completed", { line: 4 });
      }
    }
    api.startIO({ ioType: "db", label: "query: stats", line: 2, turns: 1,
      explanation: "Parallel query 1 dispatched", onComplete: () => finish("stats") });
    api.startIO({ ioType: "db", label: "query: sales", line: 2, turns: 2,
      explanation: "Parallel query 2 dispatched", onComplete: () => finish("sales") });
    api.startIO({ ioType: "cache", label: "cache: widgets", line: 2, turns: 1,
      explanation: "Parallel cache lookup dispatched", onComplete: () => finish("widgets") });
    api.setRequestStage(req, "awaiting 3 parallel tasks", { line: 1,
      explanation: "Handler returns; three tasks run on the thread pool at once" });
    api.return({ line: 5, explanation: "Handler returns" });
    api.mark("event loop start");
    api.runLoop();
  },
};
```

`src/scenarios/route-login.js`:
```js
// src/scenarios/route-login.js
export default {
  id: "route-login",
  category: "route",
  title: "POST /api/login — DB + bcrypt",
  route: "POST /api/login",
  description:
    "Look up the user (DB I/O), then verify the password with bcrypt. bcrypt is CPU-heavy " +
    "but Node runs it on the libuv thread pool, so the event loop stays responsive.",
  tags: ["DB", "crypto", "thread-pool"],
  watchFor: "bcrypt appears as a crypto task on the thread pool — not blocking the main thread.",
  code: [
    "app.post('/api/login', async (req, res) => {",          // 0
    "  const user = await db.query('SELECT ... WHERE email'); ", // 1
    "  const ok = await bcrypt.compare(pw, user.hash);",      // 2
    "  res.json({ ok });",                                     // 3
    "});",                                                      // 4
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "POST /api/login", label: "POST /api/login", line: 0,
      explanation: "Incoming login request" });
    api.call("loginHandler", { line: 0, type: "async", explanation: "Handler runs" });
    api.setRequestStage(req, "looking up user", { line: 1 });
    api.startIO({ ioType: "db", label: "SELECT user", line: 1, turns: 1,
      explanation: "DB lookup dispatched",
      onComplete: () => {
        api.setRequestStage(req, "verifying password", { line: 2 });
        api.startIO({ ioType: "crypto", label: "bcrypt.compare", line: 2, turns: 2,
          explanation: "bcrypt runs on the libuv thread pool (CPU-heavy, but off the main thread)",
          onComplete: () => {
            api.setRequestStage(req, "responding", { line: 3 });
            api.call("res.json", { line: 3, type: "completed", explanation: "Password verified — respond" });
            api.return({ line: 3 });
            api.setRequestStage(req, "completed", { line: 3 });
          } });
      } });
    api.setRequestStage(req, "waiting (DB then bcrypt)", { line: 1, explanation: "Handler returns" });
    api.return({ line: 4, explanation: "Handler returns" });
    api.mark("event loop start");
    api.runLoop();
  },
};
```

- [ ] **Step 4: Register the three in `src/scenarios/index.js`**

Add imports after the existing import lines:
```js
import routeOrders from "./route-orders.js";
import routeDashboard from "./route-dashboard.js";
import routeLogin from "./route-login.js";
```
Add them to the `scenarios` array (after `httpUsersDb,`):
```js
  routeOrders,
  routeDashboard,
  routeLogin,
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test tests/scenarios.test.mjs`
Expected: PASS — the three behavioral tests plus the metadata/shape tests covering the new scenarios.

- [ ] **Step 6: Commit**

```bash
git add src/scenarios/route-orders.js src/scenarios/route-dashboard.js src/scenarios/route-login.js src/scenarios/index.js tests/scenarios.test.mjs
git commit -m "feat: add orders, dashboard, login route scenarios"
```

---

## Task 7: Route scenarios batch B — upload, reports, export

**Files:**
- Create: `src/scenarios/route-upload.js`
- Create: `src/scenarios/route-reports.js`
- Create: `src/scenarios/route-export.js`
- Modify: `src/scenarios/index.js`
- Modify: `tests/scenarios.test.mjs`

- [ ] **Step 1: Append behavioral tests to `tests/scenarios.test.mjs`**

```js
test("route-upload: streams the file as multiple file I/O chunks", () => {
  const s = scenarios.find((x) => x.id === "route-upload");
  assert.ok(s);
  const { frames } = simulate(s);
  const fileFrames = frames.filter((f) => f.io.some((t) => t.type === "file"));
  assert.ok(fileFrames.length >= 2, "upload should stream multiple file chunks");
});

test("route-reports: CPU-bound report generation blocks the event loop", () => {
  const s = scenarios.find((x) => x.id === "route-reports");
  assert.ok(s);
  const { frames } = simulate(s);
  assert.ok(frames.some((f) => f.blocking && f.callStack.some((t) => t.type === "cpu")));
});

test("route-export: produces both a db query and streamed file output", () => {
  const s = scenarios.find((x) => x.id === "route-export");
  assert.ok(s);
  const { frames } = simulate(s);
  assert.ok(frames.some((f) => f.io.some((t) => t.type === "db")), "export should query the DB");
  const fileFrames = frames.filter((f) => f.io.some((t) => t.type === "file"));
  assert.ok(fileFrames.length >= 2, "export should stream CSV output");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/scenarios.test.mjs`
Expected: FAIL — `route-upload` not found.

- [ ] **Step 3: Create the three scenario files**

`src/scenarios/route-upload.js`:
```js
// src/scenarios/route-upload.js
export default {
  id: "route-upload",
  category: "route",
  title: "POST /api/upload — streamed write",
  route: "POST /api/upload",
  description:
    "A large upload is written to disk in chunks rather than all at once. Each chunk is a " +
    "separate thread-pool write; the next chunk starts only after the previous one finishes " +
    "(backpressure), keeping memory bounded.",
  tags: ["file", "streaming", "backpressure"],
  watchFor: "File chunks are written one at a time — sequential thread-pool writes, not a single huge one.",
  code: [
    "app.post('/api/upload', (req, res) => {",                // 0
    "  req.pipe(fs.createWriteStream('big.bin'))",            // 1
    "     .on('finish', () => res.send('ok'));",              // 2
    "});",                                                      // 3
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "POST /api/upload", label: "POST /api/upload", line: 0,
      explanation: "Incoming upload" });
    api.call("uploadHandler", { line: 0, type: "async", explanation: "Handler pipes the stream" });
    api.setRequestStage(req, "receiving + writing", { line: 1 });
    const chunks = 3;
    function writeNext(i) {
      if (i >= chunks) {
        api.setRequestStage(req, "responding", { line: 2 });
        api.call("res.send", { line: 2, type: "completed", explanation: "All chunks written — respond" });
        api.return({ line: 2 });
        api.setRequestStage(req, "completed", { line: 2 });
        return;
      }
      api.startIO({ ioType: "file", label: `write chunk ${i + 1}/${chunks}`, line: 1, turns: 1,
        explanation: `Writing chunk ${i + 1} to disk (thread pool)`,
        onComplete: () => writeNext(i + 1) });
    }
    writeNext(0);
    api.setRequestStage(req, "streaming to disk", { line: 1, explanation: "Handler returns; chunks stream out" });
    api.return({ line: 3, explanation: "Handler returns" });
    api.mark("event loop start");
    api.runLoop();
  },
};
```

`src/scenarios/route-reports.js`:
```js
// src/scenarios/route-reports.js
export default {
  id: "route-reports",
  category: "route",
  title: "GET /api/reports — CPU blocking",
  route: "GET /api/reports",
  description:
    "After fetching data, the handler builds a heavy report synchronously on the main thread. " +
    "This CPU-bound work BLOCKS the event loop: nothing else can run until it finishes — the " +
    "classic Node performance trap.",
  tags: ["CPU-bound", "blocking", "anti-pattern"],
  watchFor: "While the report is generated, the call stack is stuck and everything else waits.",
  code: [
    "app.get('/api/reports', (req, res) => {",                // 0
    "  db.query('SELECT ...', (rows) => {",                   // 1
    "    const report = buildHeavyReport(rows); // CPU!",      // 2
    "    res.send(report);",                                   // 3
    "  });",                                                    // 4
    "});",                                                      // 5
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "GET /api/reports", label: "GET /api/reports", line: 0,
      explanation: "Incoming reports request" });
    api.call("reportsHandler", { line: 0, type: "async", explanation: "Handler runs" });
    api.setRequestStage(req, "fetching data", { line: 1 });
    api.startIO({ ioType: "db", label: "SELECT report data", line: 1, turns: 1,
      explanation: "Fetch the data (non-blocking)",
      onComplete: () => {
        api.setRequestStage(req, "generating report (CPU)", { line: 2 });
        api.cpuWork({ label: "buildHeavyReport", line: 2, steps: 5,
          explanation: "Building the report on the main thread — the event loop is BLOCKED" });
        api.setRequestStage(req, "responding", { line: 3 });
        api.call("res.send", { line: 3, type: "completed", explanation: "Report built — respond" });
        api.return({ line: 3 });
        api.setRequestStage(req, "completed", { line: 3 });
      } });
    api.setRequestStage(req, "waiting on data", { line: 1, explanation: "Handler returns" });
    api.return({ line: 5, explanation: "Handler returns" });
    api.mark("event loop start");
    api.runLoop();
  },
};
```

`src/scenarios/route-export.js`:
```js
// src/scenarios/route-export.js
export default {
  id: "route-export",
  category: "route",
  title: "GET /api/export — CSV stream",
  route: "GET /api/export",
  description:
    "Query rows from the DB, then stream them out as a CSV in chunks. The query is one I/O; " +
    "the CSV is written incrementally so a huge result set never sits fully in memory.",
  tags: ["DB", "file", "streaming", "CSV"],
  watchFor: "One DB query, then several incremental CSV writes — output streams out as it's produced.",
  code: [
    "app.get('/api/export', (req, res) => {",                 // 0
    "  db.query('SELECT * FROM orders', (rows) => {",         // 1
    "    streamCsv(rows, res); // write in chunks",           // 2
    "  });",                                                    // 3
    "});",                                                      // 4
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "GET /api/export", label: "GET /api/export", line: 0,
      explanation: "Incoming export request" });
    api.call("exportHandler", { line: 0, type: "async", explanation: "Handler runs" });
    api.setRequestStage(req, "querying", { line: 1 });
    api.startIO({ ioType: "db", label: "SELECT orders", line: 1, turns: 2,
      explanation: "Query the rows to export",
      onComplete: () => {
        api.setRequestStage(req, "streaming CSV", { line: 2 });
        const chunks = 3;
        function writeCsv(i) {
          if (i >= chunks) {
            api.setRequestStage(req, "completed", { line: 2 });
            return;
          }
          api.startIO({ ioType: "file", label: `CSV chunk ${i + 1}/${chunks}`, line: 2, turns: 1,
            explanation: `Writing CSV chunk ${i + 1}`,
            onComplete: () => writeCsv(i + 1) });
        }
        writeCsv(0);
      } });
    api.setRequestStage(req, "waiting on query", { line: 1, explanation: "Handler returns" });
    api.return({ line: 4, explanation: "Handler returns" });
    api.mark("event loop start");
    api.runLoop();
  },
};
```

- [ ] **Step 4: Register the three in `src/scenarios/index.js`**

Add imports:
```js
import routeUpload from "./route-upload.js";
import routeReports from "./route-reports.js";
import routeExport from "./route-export.js";
```
Add to the `scenarios` array (after `routeLogin,`):
```js
  routeUpload,
  routeReports,
  routeExport,
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test tests/scenarios.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scenarios/route-upload.js src/scenarios/route-reports.js src/scenarios/route-export.js src/scenarios/index.js tests/scenarios.test.mjs
git commit -m "feat: add upload, reports, export route scenarios"
```

---

## Task 8: Route scenarios batch C — analytics, products, payment

**Files:**
- Create: `src/scenarios/route-analytics.js`
- Create: `src/scenarios/route-products.js`
- Create: `src/scenarios/route-payment.js`
- Modify: `src/scenarios/index.js`
- Modify: `tests/scenarios.test.mjs`

- [ ] **Step 1: Append behavioral tests to `tests/scenarios.test.mjs`**

```js
test("route-analytics: makes an external network call", () => {
  const s = scenarios.find((x) => x.id === "route-analytics");
  assert.ok(s);
  const { frames } = simulate(s);
  assert.ok(frames.some((f) => f.io.some((t) => t.type === "network")));
});

test("route-products: does a cache lookup", () => {
  const s = scenarios.find((x) => x.id === "route-products");
  assert.ok(s);
  const { frames } = simulate(s);
  assert.ok(frames.some((f) => f.io.some((t) => t.type === "cache")));
});

test("route-payment: external API then DB write run sequentially (network before db)", () => {
  const s = scenarios.find((x) => x.id === "route-payment");
  assert.ok(s);
  const { frames } = simulate(s);
  const firstNetwork = frames.findIndex((f) => f.io.some((t) => t.type === "network"));
  const firstDb = frames.findIndex((f) => f.io.some((t) => t.type === "db"));
  assert.ok(firstNetwork >= 0 && firstDb >= 0);
  assert.ok(firstNetwork < firstDb, "the card charge (network) starts before the DB write");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/scenarios.test.mjs`
Expected: FAIL — `route-analytics` not found.

- [ ] **Step 3: Create the three scenario files**

`src/scenarios/route-analytics.js`:
```js
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
```

`src/scenarios/route-products.js`:
```js
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
```

`src/scenarios/route-payment.js`:
```js
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
```

- [ ] **Step 4: Register the three in `src/scenarios/index.js`**

Add imports:
```js
import routeAnalytics from "./route-analytics.js";
import routeProducts from "./route-products.js";
import routePayment from "./route-payment.js";
```
Add to the `scenarios` array (after `routeExport,`):
```js
  routeAnalytics,
  routeProducts,
  routePayment,
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test tests/scenarios.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scenarios/route-analytics.js src/scenarios/route-products.js src/scenarios/route-payment.js src/scenarios/index.js tests/scenarios.test.mjs
git commit -m "feat: add analytics, products, payment route scenarios"
```

---

## Task 9: Route scenarios batch D — search, documents + full catalog assertion

**Files:**
- Create: `src/scenarios/route-search.js`
- Create: `src/scenarios/route-documents.js`
- Modify: `src/scenarios/index.js`
- Modify: `tests/scenarios.test.mjs`

- [ ] **Step 1: Append behavioral + catalog tests to `tests/scenarios.test.mjs`**

```js
test("route-search: queries indexes one at a time (sequential, single slot)", () => {
  const s = scenarios.find((x) => x.id === "route-search");
  assert.ok(s);
  const { frames } = simulate(s);
  // never more than one db slot busy at once (sequential await-in-loop)
  const maxBusy = Math.max(...frames.map((f) => f.threadPool.filter((slot) => slot !== null).length));
  assert.equal(maxBusy, 1, "search runs queries sequentially, not in parallel");
  // but it does run several db queries in total
  const dbFrames = frames.filter((f) => f.io.some((t) => t.type === "db"));
  assert.ok(dbFrames.length >= 2);
});

test("route-documents: CPU-bound processing blocks the event loop", () => {
  const s = scenarios.find((x) => x.id === "route-documents");
  assert.ok(s);
  const { frames } = simulate(s);
  assert.ok(frames.some((f) => f.blocking && f.callStack.some((t) => t.type === "cpu")));
});

test("all 12 route ids are registered", () => {
  const routeIds = scenarios.filter((s) => s.category === "route").map((s) => s.id).sort();
  assert.deepEqual(routeIds, [
    "http-users-db",
    "route-analytics",
    "route-dashboard",
    "route-documents",
    "route-export",
    "route-login",
    "route-orders",
    "route-payment",
    "route-products",
    "route-reports",
    "route-search",
    "route-upload",
  ]);
});

test("catalog has 4 concepts and 12 routes (16 total)", () => {
  assert.equal(scenarios.filter((s) => s.category === "concept").length, 4);
  assert.equal(scenarios.filter((s) => s.category === "route").length, 12);
  assert.equal(scenarios.length, 16);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/scenarios.test.mjs`
Expected: FAIL — `route-search` not found / route count is 10 not 12.

- [ ] **Step 3: Create the two scenario files**

`src/scenarios/route-search.js`:
```js
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
```

`src/scenarios/route-documents.js`:
```js
// src/scenarios/route-documents.js
export default {
  id: "route-documents",
  category: "route",
  title: "POST /api/documents/process — CPU bound",
  route: "POST /api/documents/process",
  description:
    "Read an uploaded document, then render/transform it (PDF or image processing) on the " +
    "main thread. The transform is CPU-bound and BLOCKS the event loop — a candidate for a " +
    "Worker Thread (shown in Phase 3).",
  tags: ["file", "CPU-bound", "blocking"],
  watchFor: "After the file read, heavy processing freezes the loop until it completes.",
  code: [
    "app.post('/api/documents/process', (req, res) => {",     // 0
    "  fs.readFile(req.file, (err, buf) => {",                // 1
    "    const out = renderPdf(buf); // CPU-heavy",            // 2
    "    res.send(out);",                                      // 3
    "  });",                                                    // 4
    "});",                                                      // 5
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "POST /api/documents/process", label: "POST /api/documents/process",
      line: 0, explanation: "Incoming document-processing request" });
    api.call("processHandler", { line: 0, type: "async", explanation: "Handler runs" });
    api.setRequestStage(req, "reading file", { line: 1 });
    api.startIO({ ioType: "file", label: "readFile document", line: 1, turns: 1,
      explanation: "Read the uploaded document (non-blocking)",
      onComplete: () => {
        api.setRequestStage(req, "processing (CPU)", { line: 2 });
        api.cpuWork({ label: "renderPdf", line: 2, steps: 6,
          explanation: "PDF/image processing on the main thread — the event loop is BLOCKED" });
        api.setRequestStage(req, "responding", { line: 3 });
        api.call("res.send", { line: 3, type: "completed", explanation: "Processing done — respond" });
        api.return({ line: 3 });
        api.setRequestStage(req, "completed", { line: 3 });
      } });
    api.setRequestStage(req, "waiting on file read", { line: 1, explanation: "Handler returns" });
    api.return({ line: 5, explanation: "Handler returns" });
    api.mark("event loop start");
    api.runLoop();
  },
};
```

- [ ] **Step 4: Register the two in `src/scenarios/index.js`**

Add imports:
```js
import routeSearch from "./route-search.js";
import routeDocuments from "./route-documents.js";
```
Add to the `scenarios` array (after `routePayment,`):
```js
  routeSearch,
  routeDocuments,
```

- [ ] **Step 5: Run to verify it passes (full suite)**

Run: `node --test`
Expected: PASS — all engine + scenario tests, including the two new behavioral tests, the
"all 12 route ids" assertion, and the "16 total" catalog assertion.

- [ ] **Step 6: Commit**

```bash
git add src/scenarios/route-search.js src/scenarios/route-documents.js src/scenarios/index.js tests/scenarios.test.mjs
git commit -m "feat: add search and documents route scenarios, complete the catalog"
```

---

## Task 10: Final verification + README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run the full test suite**

Run: `node --test`
Expected: PASS — all engine and scenario tests green.

- [ ] **Step 2: Headless renderer smoke test (catches runtime errors the syntax check can't)**

Create a temporary file **at the repo root** named `_smoke.mjs` (so the relative imports
resolve), with this exact content:

```js
// _smoke.mjs — temporary headless render check; delete after running
import { scenarios } from "./src/scenarios/index.js";
import { simulate } from "./src/engine/scheduler.js";
import { renderCodePanel } from "./src/ui/codePanel.js";
import { renderCallStack } from "./src/ui/callStack.js";
import { renderExplainPanel } from "./src/ui/explainPanel.js";
import { renderEventLoop } from "./src/ui/eventLoop.js";
import { renderQueues } from "./src/ui/queues.js";
import { renderThreadPool } from "./src/ui/threadPool.js";
import { renderRequestLane } from "./src/ui/requestLane.js";
import { renderScenarioInfo } from "./src/ui/scenarioInfo.js";
function el(){return{children:[],dataset:{},style:{},set className(v){this._c=v},get className(){return this._c},set textContent(v){this._t=v},get textContent(){return this._t},set innerHTML(v){this._h=v;this.children=[]},get innerHTML(){return this._h},appendChild(c){this.children.push(c);return c},addEventListener(){},getBoundingClientRect(){return{left:0,top:0,width:10,height:10}}}}
global.document={createElement:()=>el(),getElementById:()=>el(),querySelectorAll:()=>[]};
let fail=0;
for(const s of scenarios){
  renderScenarioInfo(el(), s);
  const {frames}=simulate(s);
  for(const f of frames){
    for(const fn of [()=>renderCodePanel(el(),s,f),()=>renderCallStack(el(),f),()=>renderExplainPanel(el(),f),()=>renderEventLoop(el(),f),()=>renderQueues(el(),f),()=>renderThreadPool(el(),f),()=>renderRequestLane(el(),f)]){
      try{fn();}catch(e){fail++;console.error(s.id,e.message);}
    }
  }
  console.log(`OK ${s.id}: ${frames.length} frames`);
}
console.log(fail===0?"ALL RENDER CLEANLY":`${fail} FAILURES`);
process.exit(fail===0?0:1);
```

Run it from the repo root, then delete it (do NOT commit it):
`node _smoke.mjs && rm -f _smoke.mjs`
Expected: every scenario prints "OK", then "ALL RENDER CLEANLY", exit 0.

- [ ] **Step 3: Manual browser checklist**

Serve (`python3 -m http.server 8000`) and confirm:
- Picker has "Concepts" (4) and "API Routes" (12) groups.
- Each route scenario shows route, description, tag chips, and a 👀 watch-for line.
- `/api/dashboard` visibly fills multiple thread-pool slots; `/api/reports` and
  `/api/documents/process` show a red BLOCKING badge during CPU work; `/api/search` uses one
  slot at a time; `/api/products` shows a cache lookup then a DB query.
- New token colors (cache/crypto/compress/cpu) render distinctly; theme toggle still works.

- [ ] **Step 4: Update `README.md` scenarios section**

Replace the existing `## Scenarios (Phase 1)` section with:

```markdown
## Scenarios

**Concepts:** nextTick vs Promise · Promise vs setTimeout · setTimeout vs setImmediate ·
sync vs async fs.

**API Routes:** GET /api/users (fast DB) · GET /api/orders (slow DB) · GET /api/dashboard
(parallel queries) · POST /api/login (DB + bcrypt) · POST /api/upload (streamed write) ·
GET /api/reports (CPU blocking) · GET /api/export (CSV stream) · GET /api/analytics
(external API) · GET /api/products (cache + DB fallback) · POST /api/payment (sequential
awaits) · GET /api/search (await-in-loop) · POST /api/documents/process (CPU bound).

Pick a scenario from the grouped dropdown; the scenario-info panel explains its workload
and what to watch for.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: update README scenario catalog for Phase 2"
```

---

## Self-review notes for the implementing engineer

- **Engine contract is stable.** Only `cpuWork` is added. Scenario files use only the
  documented authoring API; no scheduler changes are needed beyond Task 1.
- **Nested I/O chains are supported.** Calling `startIO`/`cpuWork`/`call`/`return` inside an
  `onComplete` callback works because completion callbacks run during the poll phase with the
  callback token on the stack (verified in Phase 1). Sequential chains (login, payment,
  products, upload, export, search) advance across loop turns correctly.
- **Determinism.** Renderers never mutate frames. `renderScenarioInfo` reads the scenario,
  not a frame, and is called once per load — keep it out of the per-frame `render()` path.
- **TDD.** Tasks 1, 4, 6–9 are test-first. Tasks 2, 3, 5, 10 are UI/wiring verified by
  serving the page + the headless smoke test.
- **Git note:** the repo is initialized; commit steps will work as written.
```
