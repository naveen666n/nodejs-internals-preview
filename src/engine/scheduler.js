// src/engine/scheduler.js
import { initialState, snapshot, makeToken } from "./state.js";

// The scheduler runs a scenario's run(api) function. Authoring calls mutate `state`
// and emit frames. The scheduler enforces correct Node.js semantics: nextTick drains
// before promise microtasks, microtasks drain between every macrotask, phase order is
// timers -> pending -> poll -> check -> close, and thread-pool I/O completions route
// their callbacks back into the poll phase.
export function simulate(scenario) {
  const state = initialState();
  const frames = [];
  const keyFrames = [];

  // microtask callbacks paired with their display tokens
  const nextTickCbs = [];   // { token, cb }
  const promiseCbs = [];    // { token, cb }

  const PHASES = ["timers", "pending", "poll", "check", "close"];
  // macrotask callbacks paired with tokens, keyed per phase
  const macroCbs = { timers: [], pending: [], poll: [], check: [], close: [] }; // {token, cb}
  // I/O in flight: each has a token + onComplete; completes after `turnsRemaining` turns
  const ioCbs = []; // { token, onComplete, slotIndex, turnsRemaining }

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
    setTimeout(cb, _delay, meta = {}) {
      const token = makeToken("timer", meta.label || "setTimeout cb");
      state.macro.timers.push(token);
      macroCbs.timers.push({ token, cb });
      emit({ activeLine: meta.line, explanation: meta.explanation || "setTimeout() registered (timers phase)",
             changed: ["macro"] });
    },
    setImmediate(cb, meta = {}) {
      const token = makeToken("timer", meta.label || "setImmediate cb");
      state.macro.check.push(token);
      macroCbs.check.push({ token, cb });
      emit({ activeLine: meta.line, explanation: meta.explanation || "setImmediate() registered (check phase)",
             changed: ["macro"] });
    },
    startIO(meta = {}) {
      const type = meta.ioType || "file";
      const token = makeToken(type, meta.label || `${type} I/O`);
      // occupy first free thread-pool slot (libuv); if none, slotIndex stays -1
      const slotIndex = state.threadPool.indexOf(null);
      if (slotIndex >= 0) state.threadPool[slotIndex] = token;
      state.io.push(token);
      ioCbs.push({ token, onComplete: meta.onComplete, slotIndex, turnsRemaining: meta.turns || 1 });
      emit({ activeLine: meta.line,
             explanation: meta.explanation || `${type} I/O dispatched to libuv thread pool (non-blocking)`,
             changed: ["threadPool", "io"] });
    },
    httpRequest(meta = {}) {
      const req = { id: makeToken("network", meta.label || "request").id, route: meta.route || "/", stage: "received" };
      state.requests.push(req);
      emit({ activeLine: meta.line, explanation: meta.explanation || `Incoming HTTP request ${meta.route || ""}`,
             changed: ["requests"] });
    },
    runLoop(meta = {}) {
      runLoop();
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

  function ioPending() { return ioCbs.length > 0; }
  function macroPending() { return PHASES.some((p) => state.macro[p].length > 0); }

  function completeReadyIO() {
    // advance I/O; those that finish move their callback into the poll phase
    for (let i = ioCbs.length - 1; i >= 0; i--) {
      ioCbs[i].turnsRemaining -= 1;
      if (ioCbs[i].turnsRemaining <= 0) {
        const done = ioCbs.splice(i, 1)[0];
        // free the thread-pool slot
        if (done.slotIndex >= 0) state.threadPool[done.slotIndex] = null;
        // remove from in-flight io
        const ioIdx = state.io.findIndex((t) => t.id === done.token.id);
        if (ioIdx >= 0) state.io.splice(ioIdx, 1);
        // queue its completion callback into poll
        const cbToken = makeToken("completed", `${done.token.label} callback`);
        state.macro.poll.push(cbToken);
        macroCbs.poll.push({ token: cbToken, cb: done.onComplete });
        emit({ explanation: `${done.token.label} completed in thread pool -> callback queued in poll phase`,
               changed: ["threadPool", "io", "macro"] });
      }
    }
  }

  function runPhase(phase) {
    state.activePhase = phase;
    while (state.macro[phase].length) {
      const token = state.macro[phase].shift();
      const entry = macroCbs[phase].shift();
      state.callStack.push(token);
      emit({ explanation: `${phase} phase: run ${token.label}`, changed: ["macro", "callStack"] });
      if (entry && entry.cb) entry.cb();
      state.callStack.pop();
      emit({ explanation: `${token.label} returns`, changed: ["callStack"] });
      drainMicrotasks(); // microtasks drain between every macrotask
    }
    state.activePhase = null;
  }

  function runLoop() {
    // drain microtasks left from top-level script first
    drainMicrotasks();
    let guard = 0;
    while ((macroPending() || ioPending()) && guard < 1000) {
      guard += 1;
      for (const phase of PHASES) {
        if (phase === "poll") completeReadyIO(); // I/O completions surface in poll
        runPhase(phase);
      }
      // if only I/O remains in flight, advance it on the next turn
      if (!macroPending() && ioPending()) completeReadyIO();
    }
  }

  // initial frame (empty state) so playback has a clean starting point
  emit({ explanation: "Program start", changed: [] });

  scenario.run(api);

  return { frames, keyFrames };
}
