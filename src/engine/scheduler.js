// src/engine/scheduler.js
import { initialState, snapshot, makeToken } from "./state.js";

// The scheduler runs a scenario's run(api) function. Authoring calls mutate `state`
// and emit frames. Async scheduling (timers/macro/io) is added in a later task.
export function simulate(scenario) {
  const state = initialState();
  const frames = [];
  const keyFrames = [];

  // microtask callbacks paired with their display tokens
  const nextTickCbs = [];   // { token, cb }
  const promiseCbs = [];    // { token, cb }

  // emit a frame after a state change
  function emit(meta) {
    frames.push(snapshot(state, meta));
  }

  const api = {
    call(label, meta = {}) {
      state.callStack.push(makeToken(meta.type || "sync", label));
      emit({ activeLine: meta.line, explanation: meta.explanation || `Call ${label}()`,
             blocking: !!meta.blocking, changed: ["callStack"] });
    },
    return(meta = {}) {
      state.callStack.pop();
      emit({ activeLine: meta.line, explanation: meta.explanation || "Function returns",
             changed: ["callStack"] });
    },
    nextTick(cb, meta = {}) {
      const token = makeToken("nexttick", meta.label || "nextTick cb");
      state.microtasks.nextTick.push(token);
      nextTickCbs.push({ token, cb });
      emit({ activeLine: meta.line, explanation: meta.explanation || "process.nextTick() queued",
             changed: ["microtasks"] });
    },
    promiseThen(cb, meta = {}) {
      const token = makeToken("promise", meta.label || "promise.then");
      state.microtasks.promises.push(token);
      promiseCbs.push({ token, cb });
      emit({ activeLine: meta.line, explanation: meta.explanation || "Promise callback queued (microtask)",
             changed: ["microtasks"] });
    },
    queueMicrotask(cb, meta = {}) {
      return api.promiseThen(cb, { ...meta, label: meta.label || "queueMicrotask cb" });
    },
    drainMicrotasks(meta = {}) {
      drainMicrotasks(meta);
    },
    mark(label) {
      // points at the NEXT frame to be emitted
      keyFrames.push({ label, index: frames.length });
    },
  };

  // Drain microtasks: the nextTick queue has priority and is fully drained (including
  // newly added nextTicks) before moving to the promise queue. After each promise
  // callback, the nextTick queue is re-checked. Loop until both are empty.
  function drainMicrotasks() {
    while (state.microtasks.nextTick.length || state.microtasks.promises.length) {
      while (state.microtasks.nextTick.length) {
        const token = state.microtasks.nextTick.shift();
        const entry = nextTickCbs.shift();
        state.callStack.push(token);
        emit({ explanation: `Run nextTick: ${token.label}`, changed: ["microtasks", "callStack"] });
        if (entry && entry.cb) entry.cb();
        state.callStack.pop();
        emit({ explanation: `${token.label} returns`, changed: ["callStack"] });
      }
      if (state.microtasks.promises.length) {
        const token = state.microtasks.promises.shift();
        const entry = promiseCbs.shift();
        state.callStack.push(token);
        emit({ explanation: `Run promise microtask: ${token.label}`, changed: ["microtasks", "callStack"] });
        if (entry && entry.cb) entry.cb();
        state.callStack.pop();
        emit({ explanation: `${token.label} returns`, changed: ["callStack"] });
      }
    }
  }

  // initial frame (empty state) so playback has a clean starting point
  emit({ explanation: "Program start", changed: [] });

  scenario.run(api);

  return { frames, keyFrames };
}
