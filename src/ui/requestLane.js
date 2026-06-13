// src/ui/requestLane.js
// Renders incoming HTTP requests and their lifecycle stage.
export function renderRequestLane(el, frame) {
  el.innerHTML = "<h2>HTTP Requests</h2>";
  if (frame.requests.length === 0) {
    const empty = document.createElement("div");
    empty.style.color = "var(--text-dim)";
    empty.style.fontSize = "12px";
    empty.textContent = "(no active requests)";
    el.appendChild(empty);
    return;
  }
  frame.requests.forEach((r) => {
    const div = document.createElement("div");
    div.className = "token";
    div.dataset.type = "network";
    div.dataset.id = r.id; // stable id so the request stays FLIP-consistent across frames
    div.textContent = `${r.route} — ${r.stage}`;
    el.appendChild(div);
  });
}
