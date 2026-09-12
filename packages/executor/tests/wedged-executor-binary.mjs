#!/usr/bin/env node
// A stand-in for a wedged runtime: it consumes stdin forever and never answers
// a single envelope, but stays alive. Used to prove RustExecutor's client-side
// backstop fires and frees the concurrency slot instead of hanging forever.
process.stdin.resume();
process.stdin.on("data", () => {});
setInterval(() => {}, 1000);
