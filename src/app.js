// src/app.js
import { scenarios } from "./scenarios/index.js";
import { simulate } from "./engine/scheduler.js";
import { initTheme } from "./ui/theme.js";
import { renderCodePanel } from "./ui/codePanel.js";
import { renderCallStack } from "./ui/callStack.js";
import { renderExplainPanel } from "./ui/explainPanel.js";
import { renderEventLoop } from "./ui/eventLoop.js";
import { renderQueues } from "./ui/queues.js";
import { renderThreadPool } from "./ui/threadPool.js";
import { renderRequestLane } from "./ui/requestLane.js";
import { renderControls, updateControls } from "./ui/controls.js";
import { renderScenarioInfo } from "./ui/scenarioInfo.js";

const els = {
  picker: document.getElementById("scenario-picker"),
  themeToggle: document.getElementById("theme-toggle"),
  code: document.getElementById("code-panel"),
  callstack: document.getElementById("callstack-panel"),
  eventloop: document.getElementById("eventloop-panel"),
  queues: document.getElementById("queues-panel"),
  threadpool: document.getElementById("threadpool-panel"),
  request: document.getElementById("request-panel"),
  explain: document.getElementById("explain-panel"),
  scenarioInfo: document.getElementById("scenario-info-panel"),
  controls: document.getElementById("controls"),
};

initTheme(els.themeToggle);

let state = { scenario: null, frames: [], keyFrames: [], index: 0, playing: false, speed: 1, timer: null };

// Populate scenario picker, grouped by category
const GROUP_LABELS = { concept: "Concepts", route: "API Routes" };
const groupEls = {};
Object.entries(GROUP_LABELS).forEach(([key, label]) => {
  const og = document.createElement("optgroup");
  og.label = label;
  groupEls[key] = og;
  els.picker.appendChild(og);
});
const otherGroup = document.createElement("optgroup");
otherGroup.label = "Other";
scenarios.forEach((s) => {
  const o = document.createElement("option");
  o.value = s.id;
  o.textContent = `${s.title}`;
  (groupEls[s.category] || otherGroup).appendChild(o);
});
if (otherGroup.children.length) els.picker.appendChild(otherGroup);
els.picker.addEventListener("change", () => loadScenario(els.picker.value));

// --- FLIP animation: record token positions before re-render, animate after ---
function recordPositions() {
  const map = new Map();
  document.querySelectorAll(".token[data-id]").forEach((el) => {
    map.set(el.dataset.id, el.getBoundingClientRect());
  });
  return map;
}
function playFlip(prevPositions) {
  document.querySelectorAll(".token[data-id]").forEach((el) => {
    const prev = prevPositions.get(el.dataset.id);
    if (!prev) return;
    const next = el.getBoundingClientRect();
    const dx = prev.left - next.left;
    const dy = prev.top - next.top;
    if (dx === 0 && dy === 0) return;
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    el.style.transition = "none";
    requestAnimationFrame(() => {
      el.style.transition = "transform 0.25s ease";
      el.style.transform = "";
    });
  });
}

function render() {
  const frame = state.frames[state.index];
  const prev = recordPositions();
  renderCodePanel(els.code, state.scenario, frame);
  renderCallStack(els.callstack, frame);
  renderEventLoop(els.eventloop, frame);
  renderQueues(els.queues, frame);
  renderThreadPool(els.threadpool, frame);
  renderRequestLane(els.request, frame);
  renderExplainPanel(els.explain, frame);
  playFlip(prev);
  updateControls({ index: state.index, frameCount: state.frames.length, playing: state.playing });
}

function goto(i) {
  state.index = Math.max(0, Math.min(state.frames.length - 1, i));
  render();
}

function stopTimer() {
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
}
function play() {
  if (state.index >= state.frames.length - 1) goto(0);
  state.playing = true;
  stopTimer();
  state.timer = setInterval(() => {
    if (state.index >= state.frames.length - 1) { pause(); return; }
    goto(state.index + 1);
  }, 700 / state.speed);
  updateControls({ index: state.index, frameCount: state.frames.length, playing: true });
}
function pause() {
  state.playing = false;
  stopTimer();
  updateControls({ index: state.index, frameCount: state.frames.length, playing: false });
}

const handlers = {
  prev: () => { pause(); goto(state.index - 1); },
  next: () => { pause(); goto(state.index + 1); },
  togglePlay: () => (state.playing ? pause() : play()),
  restart: () => { pause(); goto(0); },
  setSpeed: (s) => { state.speed = s; if (state.playing) play(); },
  jump: (i) => { pause(); goto(i); },
  scrub: (i) => { pause(); goto(i); },
};

function loadScenario(id) {
  pause();
  const scenario = scenarios.find((s) => s.id === id) || scenarios[0];
  let result;
  try {
    result = simulate(scenario);
  } catch (err) {
    els.explain.innerHTML = `<h2>Error</h2><p style="color:var(--c-blocking)">Failed to simulate: ${err.message}</p>`;
    return;
  }
  state.scenario = scenario;
  renderScenarioInfo(els.scenarioInfo, scenario);
  state.frames = result.frames;
  state.keyFrames = result.keyFrames;
  state.index = 0;
  renderControls(els.controls, {
    frameCount: state.frames.length,
    keyFrames: state.keyFrames,
    handlers,
  });
  render();
}

// boot
loadScenario(scenarios[0].id);
