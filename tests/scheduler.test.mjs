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
