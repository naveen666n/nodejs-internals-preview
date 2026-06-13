// src/ui/threadPool.js
// Renders libuv thread-pool slots and the list of in-flight I/O.
export function renderThreadPool(el, frame) {
  el.innerHTML = "<h2>libuv Thread Pool</h2>";
  const slots = document.createElement("div");
  frame.threadPool.forEach((slot, i) => {
    const div = document.createElement("div");
    div.className = "slot" + (slot ? " busy" : "");
    if (slot) {
      div.dataset.type = slot.type;
      div.dataset.id = slot.id;
      div.style.color = "#fff";
      div.style.background = `var(--c-${slot.type})`;
      div.textContent = slot.label;
    } else {
      div.style.color = "var(--text-dim)";
      div.textContent = `slot ${i + 1}`;
    }
    slots.appendChild(div);
  });
  el.appendChild(slots);

  const io = document.createElement("div");
  io.className = "queue-group";
  const lbl = document.createElement("div");
  lbl.className = "queue-label";
  lbl.textContent = `in-flight I/O (${frame.io.length})`;
  io.appendChild(lbl);
  frame.io.forEach((t) => {
    const d = document.createElement("div");
    d.className = "token";
    d.dataset.type = t.type;
    // No data-id here: the same I/O token is already FLIP-tracked on its thread-pool
    // slot above. This list is a secondary readout, so it stays out of FLIP to avoid
    // two DOM nodes claiming one token id.
    d.textContent = t.label;
    io.appendChild(d);
  });
  el.appendChild(io);
}
