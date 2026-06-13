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

test("http-users-db: request lifecycle stage advances beyond 'received'", () => {
  const s = scenarios.find((x) => x.id === "http-users-db");
  const { frames } = simulate(s);
  const stages = new Set();
  for (const f of frames) for (const r of f.requests) stages.add(r.stage);
  assert.ok(stages.has("received"));
  assert.ok(stages.has("completed"), "request should reach the completed stage");
  assert.ok(stages.size >= 3, "request should pass through multiple lifecycle stages");
});

test("http-users-db: the I/O completion frame is highlighted in the poll phase", () => {
  const s = scenarios.find((x) => x.id === "http-users-db");
  const { frames } = simulate(s);
  const completion = frames.find((f) => f.explanation.includes("completed in thread pool"));
  assert.ok(completion, "should have an I/O completion frame");
  assert.equal(completion.activePhase, "poll");
});

test("every scenario has a valid category, tags array, and watchFor string", () => {
  for (const s of scenarios) {
    assert.ok(["concept", "route"].includes(s.category), `${s.id} category invalid: ${s.category}`);
    assert.ok(Array.isArray(s.tags) && s.tags.length > 0, `${s.id} must have non-empty tags`);
    assert.equal(typeof s.watchFor, "string", `${s.id} watchFor must be a string`);
    assert.ok(s.watchFor.length > 0, `${s.id} watchFor must be non-empty`);
  }
});

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
