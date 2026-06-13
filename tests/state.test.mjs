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
