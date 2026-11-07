#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const [packageDir, manifestPath, resultPath, language, cachePath] = process.argv.slice(2);
  const { createWorker } = require(packageDir);
  const jobs = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  fs.mkdirSync(cachePath, { recursive: true });
  const worker = await createWorker(language, 1, { cachePath });
  const results = [];
  try {
    await worker.setParameters({ preserve_interword_spaces: "1" });
    for (const job of jobs) {
      try {
        const result = await worker.recognize(path.resolve(job.image));
        const text = (result.data.text || "").trim();
        results.push({ page: job.page, status: text ? "ok" : "empty", text, error: null });
        console.error("Page " + job.page + ": " + text.length + " characters");
      } catch (error) {
        results.push({ page: job.page, status: "error", text: "", error: String(error.stack || error) });
      }
    }
  } finally {
    await worker.terminate();
  }
  fs.writeFileSync(resultPath, JSON.stringify(results), "utf8");
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
