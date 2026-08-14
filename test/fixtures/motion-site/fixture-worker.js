// §6.9 ground truth: a real Web Worker, so Chromium reports a `worker` target that no page-level
// CDP session can see. Its output is irrelevant — existing during capture is the whole point.
let ticks = 0;
setInterval(() => {
  ticks += 1;
  postMessage(ticks);
}, 200);
