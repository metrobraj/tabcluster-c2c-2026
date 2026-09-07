// server/server.js
// ONE server, ONE URL: serves the tabCluster static site (index.html + js/)
// AND relays messages for native (non-browser) workers over WebSocket at
// /ws on the same port. Previously these were two separate things to run
// and remember - now there's a single address to share and a single
// process to start.
//
//   node server.js
//   -> open http://<this-machine-ip>:8000/          (host or worker, browser)
//   -> native workers connect to  ws://<this-machine-ip>:8000/ws
//
// The host page's "Relay URL" field auto-fills with the second one as
// long as the page itself was loaded from this server (see hostui.js).
//
// Env: PORT (default 8000)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8000;
const ROOT = path.join(__dirname, '..'); // project root: index.html, js/, etc.

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

// --- Static file serving ---
function serveStatic(req, res) {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';

  const filePath = path.join(ROOT, reqPath);
  // Don't allow escaping the project root.
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/ws')) {
    // WebSocket upgrades are handled below, not here - anything else
    // hitting /ws over plain HTTP is a mistake (e.g. pasted into a
    // browser tab instead of the Relay URL field).
    res.writeHead(400);
    res.end('This is a WebSocket endpoint, not a page - use ws:// via the app, not a browser tab.');
    return;
  }
  serveStatic(req, res);
});

// --- Native worker relay, mounted at /ws on the same port ---
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

// roomCode -> { host: ws|null, workers: Map<peerId, ws> }
const rooms = new Map();

function getRoom(code) {
  if (!rooms.has(code)) rooms.set(code, { host: null, workers: new Map() });
  return rooms.get(code);
}

function randomPeerId() {
  return 'native-' + Math.random().toString(36).slice(2, 10);
}

wss.on('connection', (ws) => {
  let room = null;
  let role = null;
  let peerId = null;

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    if (data.kind === 'join') {
      role = data.role;
      room = getRoom(data.room);

      if (role === 'host') {
        room.host = ws;
        peerId = 'host';
        ws.send(JSON.stringify({ kind: 'joined', peerId }));
        for (const wId of room.workers.keys()) {
          ws.send(JSON.stringify({ kind: 'peer-join', peerId: wId }));
        }
      } else {
        peerId = randomPeerId();
        room.workers.set(peerId, ws);
        ws.send(JSON.stringify({ kind: 'joined', peerId }));
        if (room.host) room.host.send(JSON.stringify({ kind: 'peer-join', peerId }));
      }
      console.log(`[relay] ${role} joined room ${data.room} as ${peerId}`);
      return;
    }

    if (data.kind === 'msg' && room) {
      const envelope = JSON.stringify({ kind: 'msg', from: peerId, message: data.message });

      if (role !== 'host' && (data.to === 'host' || data.to === 'broadcast')) {
        if (room.host) room.host.send(envelope);
      }
      if (data.to === 'broadcast') {
        for (const [wId, wsW] of room.workers.entries()) {
          if (wId !== peerId) wsW.send(envelope);
        }
      } else if (data.to && data.to !== 'host' && data.to !== 'broadcast') {
        const target = room.workers.get(data.to);
        if (target) target.send(envelope);
      }
    }
  });

  ws.on('close', () => {
    if (!room) return;
    if (role === 'host') {
      room.host = null;
      console.log('[relay] host disconnected');
    } else if (peerId) {
      room.workers.delete(peerId);
      if (room.host) room.host.send(JSON.stringify({ kind: 'peer-leave', peerId }));
      console.log(`[relay] worker ${peerId} disconnected`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[tabcluster] serving the app AND the native-worker relay on:`);
  console.log(`  http://localhost:${PORT}/         (open this - or your LAN IP - to host or join)`);
  console.log(`  ws://localhost:${PORT}/ws         (auto-filled for you on the host page)`);
});
