// Closes only the headless browser on the given port, never the user's own browser windows.
// Usage: node close_browser.js [--port 9333]
const { args, connect } = require('./lib');
const o = args({ port: 9333 });
connect(o.port).then(cdp => {
  cdp.ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
  setTimeout(() => { console.log('Headless browser closed'); process.exit(0); }, 800);
}).catch(() => { console.log('No headless browser on port', o.port); });
