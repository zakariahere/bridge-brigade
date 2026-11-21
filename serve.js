// Tiny zero-dependency static server for local play.
//   node serve.js   ->   http://localhost:8765
// Sends no-store headers so edits show up on a plain reload.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8765;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function handle(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  // Refuse anything that resolves outside the game folder.
  if (path.relative(ROOT, file).startsWith('..')) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

// Loopback only (never exposed to the LAN), on both IPv4 and IPv6 so "localhost" works either way.
http.createServer(handle).listen(PORT, '127.0.0.1', () => {
  console.log('Bridge Brigade running at http://localhost:' + PORT);
});
http.createServer(handle).on('error', () => {}).listen(PORT, '::1');
