// src/ui/eventLoop.js
const PHASES = [
  ["timers", "setTimeout / setInterval callbacks whose time has elapsed"],
  ["pending", "I/O callbacks deferred from a previous loop iteration"],
  ["poll", "Retrieve new I/O events; execute I/O-related callbacks"],
  ["check", "setImmediate() callbacks run here"],
  ["close", "close event callbacks, e.g. socket.on('close')"],
];

export function renderEventLoop(el, frame) {
  el.innerHTML = "<h2>Event Loop Phases</h2>";
  PHASES.forEach(([name, purpose]) => {
    const div = document.createElement("div");
    div.className = "phase" + (frame.activePhase === name ? " active" : "");
    const count = frame.macro[name] ? frame.macro[name].length : 0;
    div.innerHTML = `<strong>${name}</strong> <span style="color:var(--text-dim)">(${count})</span>` +
      `<div style="font-size:11px;color:var(--text-dim);margin-top:2px">${purpose}</div>`;
    el.appendChild(div);
  });
}
