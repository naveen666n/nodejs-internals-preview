// src/scenarios/route-upload.js
export default {
  id: "route-upload",
  category: "route",
  title: "POST /api/upload — streamed write",
  route: "POST /api/upload",
  description:
    "A large upload is written to disk in chunks rather than all at once. Each chunk is a " +
    "separate thread-pool write; the next chunk starts only after the previous one finishes " +
    "(backpressure), keeping memory bounded.",
  tags: ["file", "streaming", "backpressure"],
  watchFor: "File chunks are written one at a time — sequential thread-pool writes, not a single huge one.",
  code: [
    "app.post('/api/upload', (req, res) => {",                // 0
    "  req.pipe(fs.createWriteStream('big.bin'))",            // 1
    "     .on('finish', () => res.send('ok'));",              // 2
    "});",                                                      // 3
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "POST /api/upload", label: "POST /api/upload", line: 0,
      explanation: "Incoming upload" });
    api.call("uploadHandler", { line: 0, type: "async", explanation: "Handler pipes the stream" });
    api.setRequestStage(req, "receiving + writing", { line: 1 });
    const chunks = 3;
    function writeNext(i) {
      if (i >= chunks) {
        api.setRequestStage(req, "responding", { line: 2 });
        api.call("res.send", { line: 2, type: "completed", explanation: "All chunks written — respond" });
        api.return({ line: 2 });
        api.setRequestStage(req, "completed", { line: 2 });
        return;
      }
      api.startIO({ ioType: "file", label: `write chunk ${i + 1}/${chunks}`, line: 1, turns: 1,
        explanation: `Writing chunk ${i + 1} to disk (thread pool)`,
        onComplete: () => writeNext(i + 1) });
    }
    writeNext(0);
    api.setRequestStage(req, "streaming to disk", { line: 1, explanation: "Handler returns; chunks stream out" });
    api.return({ line: 3, explanation: "Handler returns" });
    api.mark("event loop start");
    api.runLoop();
  },
};
