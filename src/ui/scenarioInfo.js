// src/ui/scenarioInfo.js
// Renders scenario-level context: route, description, workload tags, and a watch-for hint.
// Pure function of the scenario object; called once on scenario load (not per frame).
export function renderScenarioInfo(el, scenario) {
  el.innerHTML = "<h2>Scenario</h2>";

  const route = document.createElement("div");
  route.className = "scenario-route";
  route.textContent = scenario.route;
  el.appendChild(route);

  const desc = document.createElement("p");
  desc.className = "scenario-desc";
  desc.textContent = scenario.description;
  el.appendChild(desc);

  if (scenario.tags && scenario.tags.length) {
    const row = document.createElement("div");
    row.className = "tag-row";
    scenario.tags.forEach((t) => {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.textContent = t;
      row.appendChild(chip);
    });
    el.appendChild(row);
  }

  if (scenario.watchFor) {
    const watch = document.createElement("p");
    watch.className = "scenario-watch";
    watch.textContent = "👀 " + scenario.watchFor;
    el.appendChild(watch);
  }
}
