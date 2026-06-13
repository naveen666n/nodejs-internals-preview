// src/engine/state.js
export const THREAD_POOL_SIZE = 4;

let _id = 0;
export function makeToken(type, label) {
  _id += 1;
  return { id: `t${_id}`, type, label };
}

export function initialState() {
  return {
    callStack: [],
    microtasks: { nextTick: [], promises: [] },
    macro: { timers: [], pending: [], poll: [], check: [], close: [] },
    threadPool: Array(THREAD_POOL_SIZE).fill(null),
    io: [],
    requests: [],
    activePhase: null,
  };
}

// Deep clone of mutable state + merge presentation metadata into a frame.
export function snapshot(state, meta) {
  const clone = (arr) => arr.map((t) => (t ? { ...t } : null));
  return {
    callStack: clone(state.callStack),
    microtasks: {
      nextTick: clone(state.microtasks.nextTick),
      promises: clone(state.microtasks.promises),
    },
    macro: {
      timers: clone(state.macro.timers),
      pending: clone(state.macro.pending),
      poll: clone(state.macro.poll),
      check: clone(state.macro.check),
      close: clone(state.macro.close),
    },
    threadPool: clone(state.threadPool),
    io: clone(state.io),
    requests: state.requests.map((r) => ({ ...r })),
    activePhase: state.activePhase,
    activeLine: meta.activeLine ?? null,
    explanation: meta.explanation ?? "",
    blocking: meta.blocking ?? false,
    changed: meta.changed ?? [],
  };
}
