# Node.js Internals Simulator — Phase 2 Design (Expanded Scenario Library)

**Date:** 2026-06-13
**Status:** Approved for planning
**Scope:** Phase 2 of a multi-phase project. Builds on the Phase 1 engine + renderer.

## Project context

Phase 1 delivered the core simulation engine (a deterministic scheduler that precomputes
an immutable array of frames), the full panel UI (call stack, six event-loop phases,
micro/macro queues, libuv thread pool, request lane), playback controls, dark/light
theming, and 5 foundational *concept* scenarios. All engine behavior is unit-tested.

Phase 2 expands the scenario library to a realistic API-route catalog so a developer can
see how different production workloads (DB queries, file I/O, CPU-bound work, crypto,
caching, external calls) move through the same event loop. It also adds light UI structure
to keep the larger catalog navigable and to give each route real teaching context.

Phases 1 and 3 are unchanged by this spec. Phase 3 (deferred) covers concurrent
multi-request animation, the live request timeline, side-by-side blocking-vs-non-blocking
comparison mode, and Worker Threads.

## Phase 2 objectives

- Add 12 route scenarios, each demonstrating one signature production workload and a
  distinct event-loop lesson.
- Retrofit the 5 existing concept scenarios with the new metadata so the whole catalog is
  consistent.
- Make the catalog navigable (grouped picker) and instructive (per-scenario info panel
  with workload tags and a "what to watch for" hint).
- Keep the engine changes minimal, additive, and fully backward compatible.

## Engine delta (small, additive, non-breaking)

Phase 1's spec optimistically predicted "pure content, no engine change." Teaching
CPU-blocking and crypto/compression accurately requires a small additive extension. No
existing API changes; no rewrites.

1. **New authoring verb `cpuWork(meta)`** — models synchronous CPU-bound work that holds
   the call stack and blocks the event loop. It pushes a token (type `cpu`) onto the call
   stack, emits `meta.steps` (default 4) intermediate frames each labelled
   "still computing (n/m)" with `blocking: true`, then pops and returns. Educational point:
   while this runs, nothing else on the stack/queues can progress. Signature:
   `cpuWork({ label, line, steps, explanation })`.

2. **Three new I/O token types: `cache`, `crypto`, `compress`** — recognized `ioType`
   values for `startIO`. They reuse the *existing* thread-pool I/O mechanic unchanged
   (this is accurate: Node runs `crypto` and `zlib` on the libuv thread pool). The only
   additions are display labels and theme colors. `network` (already present) covers
   external API calls; `cache` is for Redis-style lookups.

3. **Streaming is authored, not built in.** Chunked file streaming is expressed in a
   scenario's `run()` as a loop of `startIO` chunk operations — no new engine verb.

4. **Loop-waiting frames in `runLoop`.** When a loop turn does no macrotask work but I/O is
   still in flight, the scheduler emits a single "poll phase: waiting for I/O to complete
   (the event loop is free, not blocked)" frame with `activePhase: "poll"`. Without this,
   slow I/O is invisible — the loop turns over instantly with no frames, so a slow query
   looks identical to a fast one. This frame is what makes the central non-blocking lesson
   (e.g. `/api/orders`) visible: the user watches the loop cycle while the query runs. It
   does not change behavior for fast (1-turn) I/O, which still completes on the first poll.

That is the complete engine surface change for Phase 2: the `cpuWork` verb, loop-waiting
frames, three I/O token-type strings (`cache`/`crypto`/`compress`) plus the `cpu` type, and
their theme colors.

## The 12 route scenarios

Each route maps to one signature workload chosen so the catalog covers every important
workload mechanic exactly once (no repetition).

| id | Route | Signature workload | Core lesson |
|----|-------|--------------------|-------------|
| `route-users` | `GET /api/users` | Fast DB SELECT | Baseline request lifecycle |
| `route-orders` | `GET /api/orders` | Slow DB query (`turns` high) | Loop stays free while one request waits on I/O |
| `route-dashboard` | `GET /api/dashboard` | Parallel DB queries (`Promise.all`) | Multiple thread-pool slots fill simultaneously |
| `route-login` | `POST /api/login` | DB lookup + bcrypt | Crypto runs on the thread pool, not the main thread |
| `route-upload` | `POST /api/upload` | Huge file write, chunked | Streaming via repeated thread-pool I/O |
| `route-reports` | `GET /api/reports` | CPU-intensive report generation | Blocking — freezes the event loop (cautionary) |
| `route-export` | `GET /api/export` | CSV generation, streamed | Chunked incremental output |
| `route-analytics` | `GET /api/analytics` | External API call | Network I/O behaviour |
| `route-products` | `GET /api/products` | Redis cache hit + DB fallback | Cache lookup is fast non-blocking I/O |
| `route-payment` | `POST /api/payment` | External API + DB write (sequential `await`) | Sequential awaits add latency |
| `route-search` | `GET /api/search` | Sequential awaits that could be parallel | The await-in-a-loop pitfall |
| `route-documents` | `POST /api/documents/process` | Image/PDF processing | CPU-bound blocking; sets up Phase 3 worker-thread contrast |

Each scenario file exports the standard shape (see below) and uses only the authoring API
(`call`, `return`, `nextTick`, `promiseThen`, `queueMicrotask`, `setTimeout`,
`setImmediate`, `startIO`, `cpuWork`, `httpRequest`, `setRequestStage`, `runLoop`,
`drainMicrotasks`, `mark`).

## Scenario format extension (backward compatible)

Each scenario gains three fields:

- `category`: `"concept"` | `"route"` — drives picker grouping.
- `tags`: `string[]` — short workload labels, e.g. `["parallel", "DB", "non-blocking"]`.
- `watchFor`: `string` — one-line hint, e.g. "Watch three queries occupy the thread pool
  at once, then complete out of order."

These are additive; existing required fields (`id`, `title`, `route`, `description`,
`code`, `run`) are unchanged. The 5 concept scenarios are retrofitted with
`category: "concept"` and appropriate `tags`/`watchFor`.

## UI additions

- **Grouped picker:** `app.js` builds `<optgroup label="Concepts">` and
  `<optgroup label="API Routes">` from each scenario's `category`. Scenarios with no
  category fall back to an "Other" group (defensive; should not occur).
- **New renderer `src/ui/scenarioInfo.js`:** pure `(el, scenario) => void`. Renders the
  route, the description, the `tags` as colored chips, and the `watchFor` hint. Called on
  scenario load (not per frame — it is scenario-level, not frame-level).
- **New panel in `index.html`:** a `scenario-info` panel placed in the CSS grid (e.g. above
  or beside the code panel). `layout.css` updated to position it; responsive stacking rule
  extended to include it.
- **New theme colors:** `--c-cache`, `--c-crypto`, `--c-compress`, `--c-cpu` added to both
  `[data-theme="dark"]` and `[data-theme="light"]` blocks in `theme.css`, plus matching
  `.token[data-type="..."]` rules and a `.tag` chip style in `layout.css`.

## Module changes

**New files:**
- 12 × `src/scenarios/route-*.js`
- `src/ui/scenarioInfo.js`

**Modified (all additive):**
- `src/engine/scheduler.js` — add the `cpuWork` verb.
- `src/engine/state.js` — no structural change; new token types are plain strings, no enum
  to update (token `type` is already a free string).
- `src/scenarios/index.js` — import and register the 12 route scenarios.
- `src/scenarios/*` (the 5 concept files) — add `category`/`tags`/`watchFor`.
- `src/app.js` — build optgroups by category; render the scenario-info panel on load.
- `index.html` — add the scenario-info panel element.
- `styles/theme.css`, `styles/layout.css` — new token/tag colors and panel positioning.

## Data flow (unchanged core)

`scenario.run(api)` → `simulate()` → immutable `frames[]` → renderer indexed by frame.
The only new wiring: on scenario load, `app.js` additionally calls
`renderScenarioInfo(el, scenario)` once (scenario-level), separate from the per-frame
`render()` path. Frame rendering is untouched.

## Error handling

Unchanged from Phase 1: `simulate()` is wrapped in try/catch in `loadScenario`, surfacing
failures into the explain panel. Frame index stays clamped. The picker's optgroup builder
tolerates a missing `category`. `scenarioInfo` tolerates missing `tags`/`watchFor`
(renders nothing for absent fields).

## Testing

Same discipline as Phase 1 — engine verbs are unit-tested; scenarios are validated for
shape and key behaviors; renderers are exercised headlessly.

- **`tests/scheduler.test.mjs`** (extend): `cpuWork` pushes a `cpu` token, emits the
  configured number of blocking frames (each `blocking === true`), and leaves an empty
  call stack after it returns.
- **`tests/scenarios.test.mjs`** (extend):
  - Every scenario has a valid `category` (`"concept"` or `"route"`), an array `tags`, and
    a string `watchFor`.
  - All 17 scenarios simulate to non-empty frame arrays without throwing; ids unique.
  - All 12 expected route ids are registered.
  - Targeted behavioral assertions: `route-dashboard` occupies ≥2 thread-pool slots in some
    frame; `route-reports` produces at least one `blocking` frame; `route-upload` emits
    multiple `file` I/O chunks; `route-products` produces a `cache`-type I/O.
- **Renderer smoke test:** a headless DOM-stub harness renders all panels (including
  `scenarioInfo`) across every frame of all 17 scenarios with no runtime error. (Run as a
  one-off verification step during implementation, mirroring Phase 1.)

## Extensibility (sets up Phase 3)

The `/reports` and `/documents/process` scenarios deliberately show the blocking,
main-thread version of CPU work. Phase 3 can add a Worker-Threads contrast and concurrent
multi-request views on top of these without changing Phase 2 content. The scenario format
and authoring API remain the stable contract.

## Out of scope for Phase 2 (deferred to Phase 3)

- Concurrent multi-request animation (multiple requests in flight at once).
- The live request timeline view.
- Side-by-side blocking-vs-non-blocking comparison mode.
- Worker Threads visualization.
- Memory/heap visualization.
