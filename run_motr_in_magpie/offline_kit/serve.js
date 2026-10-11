// Minimal offline lab server: node serve.js <folder> <port>
// Serves the built app and saves results POSTed to /offline-save into ./Results (never online).
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, process.argv[2] || 'SONA');
const port = Number(process.argv[3] || 8080);
const resultsRoot = path.join(__dirname, 'Results');
const MAX_BODY_BYTES = 500 * 1024 * 1024;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.txt': 'text/plain',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// Keep names to a single safe path segment so a request can't write outside Results.
function safeName(value, fallback) {
  const s = String(value || '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return s || fallback;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function handleSave(req, res) {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      sendJson(res, 413, { ok: false, error: 'Too large' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const dir = path.join(resultsRoot, safeName(body.folderName, 'motr_results'), safeName(body.label, 'checkpoint'));
      fs.mkdirSync(dir, { recursive: true });
      const files = Array.isArray(body.files) ? body.files : [];
      for (const file of files) {
        if (!file || file.content == null) continue;
        fs.writeFileSync(path.join(dir, safeName(file.name, 'data.txt')), String(file.content), 'utf8');
      }
      console.log(`[${new Date().toLocaleTimeString()}] Saved ${files.length} file(s) -> ${dir}`);
      sendJson(res, 200, { ok: true, dir });
    } catch (err) {
      console.error('Save failed:', err.message);
      sendJson(res, 500, { ok: false, error: err.message });
    }
  });
}

function handleRequest(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST' && urlPath === '/offline-save') return handleSave(req, res);
  let file = path.join(root, urlPath);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) file = path.join(root, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`ERROR: ${root}\\index.html not found. Extract the whole ZIP first (right-click > Extract All).`);
  process.exit(1);
}

// 127.0.0.1, not localhost: with WebLink running, Firefox's 'localhost' can reach another service
// on IPv6 ::1 and show an unbypassable security warning (seen in the 2026-10-07 pilot).
const url = `http://127.0.0.1:${port}/?offline=1`;
http.createServer(handleRequest)
  .on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`ERROR: port ${port} is already in use - the app is probably already running in another`);
      console.error(`black window. Use that one (or close it and try again), then open ${url}`);
    } else {
      console.error('ERROR: could not start server:', err.message);
    }
    process.exit(1);
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`Serving ${root}`);
    console.log(`Open ${url}`);
    console.log(`Backups (every 5 passages + end of session) are saved to ${resultsRoot}`);
    console.log('Keep this window open during the session. Close it to stop.');
    // Open the browser only now that the server is ready (avoids "Unable to connect").
    if (process.argv.includes('--open') && process.platform === 'win32') {
      require('child_process').exec(`start "" "${url}"`);
    }
  });

// Some browsers (e.g. Firefox) try IPv6 ::1 for "localhost" first; answer there too if available.
http.createServer(handleRequest).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Note: another program is using port ${port} on IPv6 (::1), so "localhost" may not reach`);
    console.log(`this app. Always use ${url}`);
  }
}).listen(port, '::1');
