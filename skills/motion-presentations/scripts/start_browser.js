// Starts a headless Edge/Chrome with remote debugging for check, render and palette extraction.
// Usage: node start_browser.js [--port 9333] [--browser <command or path>]
// Idempotent: does nothing if a browser already answers on the port.
const { spawn } = require('child_process');
const path = require('path');
const { args } = require('./lib');
const o = args({ port: 9333 });

const profile = path.join(__dirname, '..', '.cache', 'browser-profile');
const flags = ['--headless=new', `--remote-debugging-port=${o.port}`, `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--mute-audio', '--no-first-run', 'about:blank'];
const candidates = o.browser ? [o.browser]
  : process.platform === 'win32' ? ['msedge', 'chrome']
  : process.platform === 'darwin' ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  : ['microsoft-edge', 'google-chrome', 'chromium', 'chromium-browser'];

const alive = async () => { try { return (await fetch(`http://127.0.0.1:${o.port}/json/version`)).ok; } catch { return false; } };
const waitAlive = async ms => { for (const t0 = Date.now(); Date.now() - t0 < ms;) { if (await alive()) return true; await new Promise(r => setTimeout(r, 300)); } return false; };

function launch(cmd) {
  // On Windows, "start" resolves App Paths entries such as msedge, which are usually not on PATH.
  const child = process.platform === 'win32'
    ? spawn('cmd', ['/c', 'start', '""', cmd, ...flags], { detached: true, stdio: 'ignore', windowsVerbatimArguments: false })
    : spawn(cmd, flags, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

(async () => {
  if (await alive()) { console.log(JSON.stringify({ ok: true, port: o.port, started: false })); return; }
  for (const cmd of candidates) {
    launch(cmd);
    if (await waitAlive(10000)) { console.log(`Headless browser on port ${o.port} (${path.basename(cmd)})`); console.log(JSON.stringify({ ok: true, port: o.port, started: true, browser: path.basename(cmd) })); return; }
  }
  console.error(`No browser answered on port ${o.port}. Tried: ${candidates.join(', ')}. Pass --browser <path>.`);
  process.exit(1);
})();
