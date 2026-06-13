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
