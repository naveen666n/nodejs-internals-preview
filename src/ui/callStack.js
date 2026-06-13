// src/ui/callStack.js
// Renders the call stack, top frame last. Tokens carry data-id for FLIP.
export function renderCallStack(el, frame) {
  el.innerHTML = "<h2>Call Stack</h2>";
  // render top-of-stack first (visually on top)
  [...frame.callStack].reverse().forEach((t) => {
    const div = document.createElement("div");
    div.className = "token";
    div.dataset.type = t.type;
    div.dataset.id = t.id;
    div.textContent = t.label;
    el.appendChild(div);
  });
  if (frame.callStack.length === 0) {
    const empty = document.createElement("div");
    empty.style.color = "var(--text-dim)";
    empty.style.fontSize = "12px";
    empty.textContent = "(empty — nothing executing)";
    el.appendChild(empty);
  }
}
