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

## Scenarios (Phase 1)

- process.nextTick() vs Promise
- Promise (microtask) vs setTimeout (macrotask)
- setTimeout(0) vs setImmediate()
- fs.readFileSync (blocking) vs fs.readFile (non-blocking)
- HTTP GET /api/users + DB query

## Controls

Play / Pause · Next / Prev (step) · Speed (0.25–4×) · Restart · Scrubber · Jump-to-event.

## Architecture

`scenario.run(api)` → `simulate()` produces an immutable array of `frames` (full state
snapshots). The UI is a pure function of `frames[index]`; playback just moves the index,
so stepping backward and scrubbing are free and deterministic. Tokens animate between
panels via FLIP.

Adding a scenario = drop a file in `src/scenarios/` exporting
`{ id, title, route, description, code, run(api) }` and register it in `index.js`. The
authoring API (`call`, `return`, `nextTick`, `promiseThen`, `queueMicrotask`, `setTimeout`,
`setImmediate`, `startIO`, `httpRequest`, `runLoop`, `drainMicrotasks`, `mark`) is the
stable contract — no engine or renderer changes needed.

See `docs/superpowers/specs/` and `docs/superpowers/plans/` for the design and plan docs.
This is Phase 1 (core engine + MVP); Phase 2 expands the scenario library and Phase 3 adds
concurrent requests, a live timeline, comparison mode, and Worker Threads.
