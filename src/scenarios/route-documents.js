// src/scenarios/route-documents.js
export default {
  id: "route-documents",
  category: "route",
  title: "POST /api/documents/process — CPU bound",
  route: "POST /api/documents/process",
  description:
    "Read an uploaded document, then render/transform it (PDF or image processing) on the " +
    "main thread. The transform is CPU-bound and BLOCKS the event loop — a candidate for a " +
    "Worker Thread (shown in Phase 3).",
  tags: ["file", "CPU-bound", "blocking"],
  watchFor: "After the file read, heavy processing freezes the loop until it completes.",
  code: [
    "app.post('/api/documents/process', (req, res) => {",     // 0
    "  fs.readFile(req.file, (err, buf) => {",                // 1
    "    const out = renderPdf(buf); // CPU-heavy",            // 2
    "    res.send(out);",                                      // 3
    "  });",                                                    // 4
    "});",                                                      // 5
  ].join("\n"),
  run(api) {
    const req = api.httpRequest({ route: "POST /api/documents/process", label: "POST /api/documents/process",
      line: 0, explanation: "Incoming document-processing request" });
    api.call("processHandler", { line: 0, type: "async", explanation: "Handler runs" });
    api.setRequestStage(req, "reading file", { line: 1 });
    api.startIO({ ioType: "file", label: "readFile document", line: 1, turns: 1,
      explanation: "Read the uploaded document (non-blocking)",
      onComplete: () => {
        api.setRequestStage(req, "processing (CPU)", { line: 2 });
        api.cpuWork({ label: "renderPdf", line: 2, steps: 6,
          explanation: "PDF/image processing on the main thread — the event loop is BLOCKED" });
        api.setRequestStage(req, "responding", { line: 3 });
        api.call("res.send", { line: 3, type: "completed", explanation: "Processing done — respond" });
        api.return({ line: 3 });
        api.setRequestStage(req, "completed", { line: 3 });
      } });
    api.setRequestStage(req, "waiting on file read", { line: 1, explanation: "Handler returns" });
    api.return({ line: 5, explanation: "Handler returns" });
    api.mark("event loop start");
    api.runLoop();
  },
};
