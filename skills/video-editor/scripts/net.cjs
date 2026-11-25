// HTTP GET shared by sfx.cjs and find-image.cjs. Node's fetch uses its own CA bundle, so behind a TLS
// proxy or with a missing intermediate it fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE; then curl is used,
// which on Windows (Schannel) trusts the system certificate store. TLS verification is never disabled.
const {spawnSync} = require("node:child_process");

const USER_AGENT = "video-editor-skill/1.0 (Remotion editing skill; local use)";

const viaCurl = (url) => {
  const run = spawnSync(process.platform === "win32" ? "curl.exe" : "curl", ["-sSfL", "--max-time", "60", "-A", USER_AGENT, url], {maxBuffer: 256 * 1024 * 1024});
  if (run.error) throw new Error(`curl not available: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`curl ${url}: ${run.stderr.toString().trim()}`);
  return run.stdout;
};

// Returns a Buffer; throws with the real error of both attempts.
const get = async (url) => {
  try {
    const response = await fetch(url, {headers: {"User-Agent": USER_AGENT}});
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (/^HTTP \d+/.test(error.message)) throw error;
    try { return viaCurl(url); }
    catch (curlError) { throw new Error(`fetch failed (${error.cause?.code ?? error.message}); ${curlError.message}`); }
  }
};

const getJson = async (url) => JSON.parse((await get(url)).toString("utf8"));

module.exports = {get, getJson};
