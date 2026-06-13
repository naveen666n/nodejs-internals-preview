// src/ui/queues.js
// Renders microtask queues (nextTick + promises) and macrotask queues.
function renderGroup(parent, label, tokens) {
  const group = document.createElement("div");
  group.className = "queue-group";
  const lbl = document.createElement("div");
  lbl.className = "queue-label";
  lbl.textContent = `${label} (${tokens.length})`;
  group.appendChild(lbl);
  tokens.forEach((t) => {
    const div = document.createElement("div");
    div.className = "token";
    div.dataset.type = t.type;
    div.dataset.id = t.id;
    div.textContent = t.label;
    group.appendChild(div);
  });
  parent.appendChild(group);
}

export function renderQueues(el, frame) {
  el.innerHTML = "<h2>Queues</h2>";
  renderGroup(el, "nextTick queue", frame.microtasks.nextTick);
  renderGroup(el, "promise microtasks", frame.microtasks.promises);
  renderGroup(el, "timers", frame.macro.timers);
  renderGroup(el, "pending", frame.macro.pending);
  renderGroup(el, "poll", frame.macro.poll);
  renderGroup(el, "check", frame.macro.check);
  renderGroup(el, "close", frame.macro.close);
}
