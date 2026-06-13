// src/engine/scheduler.js
import { initialState, snapshot, makeToken } from "./state.js";

// The scheduler runs a scenario's run(api) function. Authoring calls mutate `state`
// and emit frames. Async scheduling (timers/micro/macro/io) is added in later tasks.
export function simulate(scenario) {
  const state = initialState();
  const frames = [];
  const keyFrames = [];

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
    mark(label) {
      // points at the NEXT frame to be emitted
      keyFrames.push({ label, index: frames.length });
    },
  };

  // initial frame (empty state) so playback has a clean starting point
  emit({ explanation: "Program start", changed: [] });

  scenario.run(api);

  return { frames, keyFrames };
}
