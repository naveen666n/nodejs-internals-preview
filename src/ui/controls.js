// src/ui/controls.js
// Builds playback controls. Callbacks are supplied by app.js; this module owns no state.
export function renderControls(el, { frameCount, keyFrames, handlers }) {
  el.innerHTML = "";

  const mk = (label, onClick) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  };

  el.appendChild(mk("⏮ Prev", handlers.prev));
  const playBtn = mk("▶ Play", handlers.togglePlay);
  playBtn.id = "play-btn";
  el.appendChild(playBtn);
  el.appendChild(mk("⏭ Next", handlers.next));
  el.appendChild(mk("🔄 Restart", handlers.restart));

  const speed = document.createElement("select");
  [0.25, 0.5, 1, 2, 4].forEach((s) => {
    const o = document.createElement("option");
    o.value = String(s);
    o.textContent = `${s}x`;
    if (s === 1) o.selected = true;
    speed.appendChild(o);
  });
  speed.addEventListener("change", () => handlers.setSpeed(parseFloat(speed.value)));
  el.appendChild(speed);

  if (keyFrames.length) {
    const jump = document.createElement("select");
    const def = document.createElement("option");
    def.textContent = "🎯 Jump to…";
    def.value = "";
    jump.appendChild(def);
    keyFrames.forEach((kf) => {
      const o = document.createElement("option");
      o.value = String(kf.index);
      o.textContent = kf.label;
      jump.appendChild(o);
    });
    jump.addEventListener("change", () => {
      if (jump.value !== "") handlers.jump(parseInt(jump.value, 10));
    });
    el.appendChild(jump);
  }

  const scrubber = document.createElement("input");
  scrubber.type = "range";
  scrubber.min = "0";
  scrubber.max = String(frameCount - 1);
  scrubber.value = "0";
  scrubber.id = "scrubber";
  scrubber.addEventListener("input", () => handlers.scrub(parseInt(scrubber.value, 10)));
  el.appendChild(scrubber);

  const counter = document.createElement("span");
  counter.id = "frame-counter";
  counter.style.fontSize = "12px";
  counter.style.color = "var(--text-dim)";
  el.appendChild(counter);
}

// Called by app.js on every frame change to sync scrubber + counter + play button label.
export function updateControls({ index, frameCount, playing }) {
  const scrubber = document.getElementById("scrubber");
  if (scrubber) scrubber.value = String(index);
  const counter = document.getElementById("frame-counter");
  if (counter) counter.textContent = `${index + 1} / ${frameCount}`;
  const playBtn = document.getElementById("play-btn");
  if (playBtn) playBtn.textContent = playing ? "⏸ Pause" : "▶ Play";
}
