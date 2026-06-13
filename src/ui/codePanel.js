// src/ui/codePanel.js
// Renders the scenario source with the active line highlighted.
export function renderCodePanel(el, scenario, frame) {
  const lines = scenario.code.split("\n");
  el.innerHTML = "<h2>Source</h2>";
  lines.forEach((line, i) => {
    const div = document.createElement("div");
    div.className = "code-line" + (frame.activeLine === i ? " active" : "");
    div.textContent = line === "" ? " " : line;
    el.appendChild(div);
  });
}
