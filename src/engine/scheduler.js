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
    cpuWork(meta = {}) {
      const steps = meta.steps || 4;
      const token = makeToken("cpu", meta.label || "CPU work");
      state.callStack.push(token);
      const base = meta.explanation || `${token.label}: CPU-bound work blocking the event loop`;
      for (let i = 1; i <= steps; i++) {
        emit({ activeLine: meta.line, blocking: true,
               explanation: `${base} (${i}/${steps})`, changed: ["callStack"] });
      }
      state.callStack.pop();
      emit({ activeLine: meta.line, explanation: `${token.label} finished — event loop free again`,
             changed: ["callStack"] });
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
      const id = makeToken("network", meta.label || "request").id;
      const req = { id, route: meta.route || "/", stage: meta.stage || "received" };
      state.requests.push(req);
      emit({ activeLine: meta.line, explanation: meta.explanation || `Incoming HTTP request ${meta.route || ""}`,
             changed: ["requests"] });
      return id; // scenarios use this handle to advance the request's lifecycle stage
    },
    setRequestStage(id, stage, meta = {}) {
      const req = state.requests.find((r) => r.id === id);
      if (req) req.stage = stage;
      emit({ activeLine: meta.line,
             explanation: meta.explanation || `Request ${req ? req.route : ""} → ${stage}`,
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
        // queue its completion callback into poll. I/O completions are detected when the
        // loop reaches the poll phase, so reflect that in the active-phase highlight.
        state.activePhase = "poll";
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
      const before = frames.length;
      for (const phase of PHASES) {
        if (phase === "poll") completeReadyIO(); // I/O completions surface in poll
        runPhase(phase);
      }
      // Note: completeReadyIO() runs once per turn (in the poll phase above), so each
      // loop turn advances in-flight I/O by exactly one `turn` — `turns:N` maps 1:1 to N
      // visible loop cycles. (A second call here would double-count and make `turns`
      // render as half as many cycles.)
      // If this turn produced no frames but I/O is still pending, show the loop cycling in
      // the poll phase, waiting for I/O — otherwise slow I/O would be invisible.
      if (frames.length === before && ioPending()) {
        state.activePhase = "poll";
        emit({ explanation: "poll phase: waiting for I/O to complete (the event loop is free, not blocked)",
               changed: [] });
        state.activePhase = null;
      }
    }
  }

  // initial frame (empty state) so playback has a clean starting point
  emit({ explanation: "Program start", changed: [] });

  scenario.run(api);

  return { frames, keyFrames };
}
