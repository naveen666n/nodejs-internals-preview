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

(A static server is required — ES module imports won't load over `file://`.)

## Test the engine

```bash
node --test
```

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

## Controls

Play / Pause · Next / Prev (step) · Speed (0.25–4×) · Restart · Scrubber · Jump-to-event.

## Architecture

`scenario.run(api)` → `simulate()` produces an immutable array of `frames` (full state
snapshots). The UI is a pure function of `frames[index]`; playback just moves the index,
so stepping backward and scrubbing are free and deterministic. Tokens animate between
panels via FLIP.

Adding a scenario = drop a file in `src/scenarios/` exporting
`{ id, title, route, description, code, run(api), category, tags, watchFor }` and register
it in `index.js`. The authoring API (`call`, `return`, `nextTick`, `promiseThen`,
`queueMicrotask`, `setTimeout`, `setImmediate`, `startIO`, `cpuWork`, `httpRequest`,
`setRequestStage`, `runLoop`, `drainMicrotasks`, `mark`) is the stable contract — no engine
or renderer changes needed.

See `docs/superpowers/specs/` and `docs/superpowers/plans/` for the design and plan docs.
Phase 1 built the core engine + MVP; Phase 2 added the full route catalog (CPU-blocking,
crypto, caching, streaming, parallel vs sequential I/O). Phase 3 (planned) adds concurrent
requests, a live timeline, comparison mode, and Worker Threads.
