// src/ui/explainPanel.js
// Renders the per-frame explanation + blocking/non-blocking badge + active phase.
export function renderExplainPanel(el, frame) {
  el.innerHTML = "<h2>What's happening</h2>";
  const badge = document.createElement("span");
  badge.className = "badge " + (frame.blocking ? "blocking" : "nonblocking");
  badge.textContent = frame.blocking ? "BLOCKING" : "non-blocking";
  el.appendChild(badge);

  if (frame.activePhase) {
    const phase = document.createElement("span");
    phase.className = "badge";
    phase.style.marginLeft = "8px";
    phase.style.background = "var(--accent)";
    phase.style.color = "#fff";
    phase.textContent = "phase: " + frame.activePhase;
    el.appendChild(phase);
  }

  const p = document.createElement("p");
  p.style.marginTop = "10px";
  p.style.fontSize = "14px";
  p.style.lineHeight = "1.5";
  p.textContent = frame.explanation;
  el.appendChild(p);
}
