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
