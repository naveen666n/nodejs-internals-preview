# Node.js Internals Simulator — Phase 1 Design (Core Engine + MVP)

**Date:** 2026-06-13
**Status:** Approved for planning
**Scope:** Phase 1 of a multi-phase project.

## Project context & decomposition

The overall goal is a highly interactive, visually rich educational simulator that
explains Node.js internals: the Event Loop, async execution, request handling, libuv /
thread pool, queues, and real-world production workloads. The full request describes
several independent subsystems and is too large for a single spec. It is decomposed into
three phases, each with its own spec → plan → implementation cycle:

- **Phase 1 (this doc):** Core simulation engine + foundational UI + 5 starter scenarios.
  Proves out the architecture (scenario format, engine→renderer sync, playback controls).
- **Phase 2:** Expanded scenario library — the full route catalog (users, orders,
  dashboard, login, upload, reports, export, analytics, products, payment, search,
  documents/process) with realistic workload combinations. Pure content; no engine change.
- **Phase 3:** Concurrency (multiple simultaneous requests), the live request timeline,
  side-by-side blocking-vs-non-blocking comparison mode, Worker Threads visualization,
  and final responsiveness/polish.

## Phase 1 objectives

Deliver a working single-page simulator that lets a developer step through, frame by
frame, how Node.js processes execution: the call stack, all six event-loop phases, the
microtask queues (nextTick + promises), macrotask structures (timers, pending, poll,
check, close), and libuv thread-pool I/O — with code highlighting, plain-English
explanations, and full playback controls.

## Tech & constraints

- Vanilla HTML / CSS / JavaScript, ES modules. **No build step, no backend.**
- Runs by opening `index.html` locally (served or via file). ES module imports must work
  from a simple static context.
- **Theme system:** CSS custom properties keyed off a `data-theme` attribute on the root.
  Ships with a default **technical dark** theme and a **clean light** theme. Theme choice
  persists to `localStorage`. Structured so additional themes are drop-in.

## Core architectural decision: precomputed frames

A scenario does **not** animate live. Instead:

```
scenario.run(api)  →  scheduler simulates deterministically  →  frames[]  →  renderer shows frames[i]
```

The scheduler runs the entire scenario up front and emits an ordered array of immutable
**frames**. Each frame is a complete snapshot of simulation state plus presentation
metadata:

- `callStack` — ordered stack frames.
- `microtasks` — `{ nextTick: [...], promises: [...] }`.
- `macro` — `{ timers: [...], pending: [...], poll: [...], check: [...], close: [...] }`.
- `threadPool` — fixed-size worker slots, each idle or running a task.
- `io` — in-flight I/O operations not yet completed.
- `requests` — active HTTP requests and their lifecycle stage.
- `activePhase` — which event-loop phase is currently executing (or `null` for top-level
  script / between phases).
- `activeLine` — the source line index currently "executing" (for code highlighting).
- `explanation` — plain-English "what just happened / why / which phase / blocking vs
  non-blocking" text for this frame.
- `changed` — list of containers/tokens that changed since the previous frame (renderer
  hint; not authoritative).

Playback is an index into `frames[]`. Consequently **next / prev / scrub / jump / restart
are trivial and perfectly deterministic** — backward stepping (normally the hardest part)
comes for free.

## Module breakdown

Each module has one clear purpose, a defined interface, and is independently testable.

### Engine (pure logic, no DOM)

- **`engine/state.js`** — state shape definitions, snapshot/clone helpers, token id
  allocation.
- **`engine/scheduler.js`** — the hybrid event-loop scheduler. Authors describe *intent*
  via a high-level API; the scheduler enforces correct Node.js semantics:
  - `process.nextTick` queue drains fully **before** the promise microtask queue.
  - The microtask queues drain completely **between every macrotask** (and after the
    top-level script).
  - Phase order: timers → pending callbacks → poll → check → close callbacks, looping.
  - libuv thread-pool completions route their callbacks back into the appropriate phase
    (poll / pending) on a subsequent loop turn.
  - **Authoring API:** `call(label, {line})`, `return()`, `setTimeout(cb, delay)`,
    `setImmediate(cb)`, `nextTick(cb)`, `queueMicrotask(cb)`, `promiseThen(cb)`,
    `startIO({type})` (type ∈ file/db/network; consumes a thread-pool slot where libuv
    would), `httpRequest({route})`, and `mark(label)` to tag a key frame.
  - Output: `simulate(scenario) → { frames, keyFrames }`.

### Scenarios (data + authoring)

- **`scenarios/<id>.js`** — each exports
  `{ id, title, route, description, code (string), keyFrames, run(api) }`.
  `code` is the displayed source; the engine maps `activeLine` to it via `{line}` hints.
- **`scenarios/index.js`** — registry array; the picker reads from it.

Phase 1 scenarios (chosen so collectively they exercise every engine feature):

1. **Sync vs async fs** — `readFileSync` blocking the call stack vs `readFile` dispatched
   to the thread pool with a poll-phase callback.
2. **setTimeout vs setImmediate** — timers phase vs check phase ordering.
3. **process.nextTick vs Promise** — nextTick queue priority over promise microtasks.
4. **Promise vs callback** — microtask vs macrotask scheduling.
5. **HTTP GET /api/users + DB query** — full request lifecycle: client → server →
   request queue → handler → DB I/O via thread pool → callback → response. This is the
   template Phase 2 builds upon.

### UI / renderer (DOM + animation; reads frames, never mutates engine)

- **`ui/layout.js`** — overall responsive grid scaffold.
- **`ui/codePanel.js`** — source listing + active-line highlight.
- **`ui/callStack.js`** — animated stack frames.
- **`ui/eventLoop.js`** — the six phases as a sequence/ring; highlights `activePhase`.
- **`ui/queues.js`** — renders microtask (nextTick + promises) and macro
  (timers/pending/poll/check/close) containers and their tokens.
- **`ui/threadPool.js`** — libuv worker slots + in-flight I/O.
- **`ui/requestLane.js`** — incoming HTTP clients → server → request queue.
- **`ui/controls.js`** — play / pause / next / prev / speed / restart / scrubber / jump.
- **`ui/explainPanel.js`** — the per-frame explanation text + blocking/non-blocking badge.
- **`ui/theme.js`** — theme toggle + persistence.

### App

- **`app.js`** — wires scenario picker → `simulate()` → renderer → controls; owns the
  current frame index and the playback clock.

## Data flow

1. User picks a scenario.
2. `simulate(scenario)` runs the scheduler and returns `frames[]` + `keyFrames`.
3. `app.js` sets `index = 0` and renders `frames[0]`.
4. Controls mutate `index` (clamped to bounds); Play advances `index` on an interval
   scaled by the speed multiplier.
5. On each render, the renderer places every token (stable id) into its current container
   and uses **FLIP** (First–Last–Invert–Play) to animate tokens that moved between panels
   since the previous frame. Color-coded by type: sync / async / blocking / db / file /
   timer / promise / completed / waiting.

## Animation approach

Declarative: the renderer is a pure function of `frames[index]`. It never maintains its
own imperative timeline. Tokens carry stable ids so they can be tracked across frames;
FLIP handles smooth movement. This keeps animation correct under arbitrary scrubbing and
backward stepping.

## Controls behavior

- **Play / Pause:** advance `index` on `setInterval` whose period = base / speedMultiplier.
  Auto-pause at the last frame.
- **Next / Prev:** `index ± 1`, clamped.
- **Speed:** 0.25× / 0.5× / 1× / 2× / 4×.
- **Restart:** `index = 0`.
- **Scrubber:** range input bound to `index`, shows `index / frames.length`.
- **Jump:** dropdown built from the scenario's `keyFrames` (label → frame index).

## Error handling

- Authoring/simulation errors are caught in `simulate()` and surfaced in the UI rather
  than crashing the page.
- Frame `index` is always clamped to `[0, frames.length - 1]`.
- Missing/empty scenario fields fail loudly at registry load with a clear message.

## Testing

Engine correctness is the educational value, so the scheduler is unit-tested.

- **`tests/engine.test.mjs`** — runnable with `node --test`. Asserts the ordering
  guarantees: nextTick drains before promise microtasks; microtasks drain between
  macrotasks; setImmediate (check) vs setTimeout(0) (timers) ordering; thread-pool I/O
  completion routes its callback back via poll. Tests target the pure engine modules,
  which import cleanly under Node with no DOM.
- UI is verified by running the page and stepping a scenario.

## Extensibility (sets up Phase 2)

Adding a scenario is: create `scenarios/<id>.js` with the standard shape and register it
in `scenarios/index.js`. The authoring API and renderer already cover file / db / network
/ cpu / timer workloads, so Phase 2 is pure content with no engine or renderer changes.

## Out of scope for Phase 1 (deferred to later phases)

- Multiple concurrent requests animating simultaneously (Phase 3).
- The full live request timeline view (Phase 3).
- Side-by-side blocking-vs-non-blocking comparison mode (Phase 3).
- Worker Threads visualization (Phase 3).
- The full 12-route catalog and the long workload list (Phase 2).
- Memory/heap visualization (optional, later).
